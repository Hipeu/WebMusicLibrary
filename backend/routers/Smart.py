"""独立的智能功能网关：供应商配置、连通测试和可取消生成任务。"""
import asyncio
import json
import os
import re
import threading
import time
import uuid

import aiohttp
from fastapi import APIRouter, Body, HTTPException

router = APIRouter(prefix="/api/smart")

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
PROVIDERS_FILE = os.path.join(DATA_DIR, "smart_providers.json")

PROVIDER_DEFAULTS = {
    "openai": {"name": "ChatGPT", "base_url": "https://api.openai.com/v1", "model": "gpt-5.6-lunna"},
    "deepseek": {"name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "model": "deepseek-v4-flash"},
}
_jobs, _jobs_lock = {}, threading.Lock()


def _load_providers():
    try:
        with open(PROVIDERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {"providers": {}, "default": None}
    except Exception:
        return {"providers": {}, "default": None}


def _save_providers(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PROVIDERS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _safe_provider(value):
    if value not in PROVIDER_DEFAULTS:
        raise HTTPException(status_code=400, detail="不支持的智能供应商")
    return value


def _public_provider(kind, item, default):
    return {
        "id": kind, "name": PROVIDER_DEFAULTS[kind]["name"], "model": item.get("model"),
        "connected": bool(item.get("connected")), "enabled": bool(item.get("enabled")),
        "is_default": default == kind,
    }


async def _list_models(kind, api_key):
    base = PROVIDER_DEFAULTS[kind]["base_url"].rstrip("/")
    timeout = aiohttp.ClientTimeout(total=20)
    headers = {"Authorization": f"Bearer {api_key}"}
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(f"{base}/models", headers=headers) as resp:
            payload = await resp.json(content_type=None)
            if resp.status >= 400:
                raise ValueError(payload.get("error", {}).get("message") or f"HTTP {resp.status}")
    models = [item.get("id") for item in payload.get("data", []) if isinstance(item, dict) and item.get("id")]
    return sorted(models)


@router.get("/providers")
def get_providers():
    data = _load_providers()
    return {"providers": [_public_provider(kind, item, data.get("default")) for kind, item in data.get("providers", {}).items() if kind in PROVIDER_DEFAULTS], "default": data.get("default")}


@router.post("/providers/test")
async def test_provider(payload: dict = Body(...)):
    kind = _safe_provider(payload.get("provider"))
    api_key = str(payload.get("api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请输入 API Key")
    models = await _list_models(kind, api_key)
    requested = str(payload.get("model") or PROVIDER_DEFAULTS[kind]["model"])
    return {"status": "ok", "models": models, "model_available": requested in models}


@router.put("/providers/{kind}")
def save_provider(kind: str, payload: dict = Body(...)):
    kind = _safe_provider(kind)
    data = _load_providers()
    old = data.setdefault("providers", {}).get(kind, {})
    api_key = str(payload.get("api_key") or old.get("api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请输入 API Key")
    model = str(payload.get("model") or PROVIDER_DEFAULTS[kind]["model"]).strip()
    data["providers"][kind] = {"api_key": api_key, "model": model, "connected": bool(payload.get("connected")), "enabled": bool(payload.get("enabled", True))}
    if payload.get("make_default") or not data.get("default"):
        data["default"] = kind
    _save_providers(data)
    return {"status": "ok", "provider": _public_provider(kind, data["providers"][kind], data.get("default"))}


@router.post("/providers/{kind}/toggle")
def toggle_provider(kind: str, payload: dict = Body(...)):
    kind = _safe_provider(kind)
    data = _load_providers()
    item = data.get("providers", {}).get(kind)
    if not item:
        raise HTTPException(status_code=404, detail="供应商未添加")
    item["enabled"] = bool(payload.get("enabled"))
    _save_providers(data)
    return {"status": "ok"}


@router.delete("/providers/{kind}")
def delete_provider(kind: str):
    kind = _safe_provider(kind)
    data = _load_providers()
    data.get("providers", {}).pop(kind, None)
    if data.get("default") == kind:
        data["default"] = next(iter(data.get("providers", {})), None)
    _save_providers(data)
    return {"status": "ok"}


def _job(job_id):
    with _jobs_lock:
        return dict(_jobs.get(job_id) or {})


def _set_job(job_id, **changes):
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(changes)


def _instructions(kind, payload):
    if kind == "playlist":
        return "根据用户描述和本地曲目目录推荐播放列表。只返回 JSON：{description:string,song_ids:string[]}。song_ids 必须来自目录，不能虚构歌曲。"
    if kind == "playlist_description":
        return "根据歌单名称和曲目目录写一段简洁中文歌单简介。只返回 JSON：{description:string}。"
    if kind == "song_suggestion":
        return "根据本地单曲资料补全可能缺失的文本元信息。只返回 JSON 对象，可用字段 title,artist,album,album_artist,year,genre,trackNo,discNo,composer,lyricist,publisher,comment。不要返回图片或 URL。"
    if kind == "album_suggestion":
        return "根据本地专辑与曲目资料补全专辑文本信息。只返回 JSON：{title,artist,album_artist,year,genre,publisher,description}。不要返回图片或 URL。"
    raise ValueError("不支持的智能任务")


def _parse_json(content):
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", (content or "").strip(), flags=re.I)
    value = json.loads(content)
    if not isinstance(value, dict):
        raise ValueError("模型未返回 JSON 对象")
    return value


async def _run_chat(job_id, provider, kind, payload):
    data = _load_providers()
    item = data.get("providers", {}).get(provider)
    if not item or not item.get("enabled") or not item.get("connected"):
        raise ValueError("未找到可用的默认智能供应商")
    base = PROVIDER_DEFAULTS[provider]["base_url"].rstrip("/")
    provider_name = PROVIDER_DEFAULTS[provider]["name"]
    _set_job(job_id, message=f"正在向 {provider_name} 发送请求", provider_name=provider_name)
    request = {
        "model": item.get("model") or PROVIDER_DEFAULTS[provider]["model"],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _instructions(kind, payload)},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
    }
    timeout = aiohttp.ClientTimeout(total=120)
    headers = {"Authorization": f"Bearer {item['api_key']}", "Content-Type": "application/json"}
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(f"{base}/chat/completions", headers=headers, json=request) as resp:
            body = await resp.json(content_type=None)
            if resp.status >= 400:
                raise ValueError(body.get("error", {}).get("message") or f"HTTP {resp.status}")
    _set_job(job_id, message=f"正在接收 {provider_name} 数据")
    return _parse_json(((body.get("choices") or [{}])[0].get("message") or {}).get("content"))


def _worker(job_id, provider, kind, payload):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    task = loop.create_task(_run_chat(job_id, provider, kind, payload))
    _set_job(job_id, loop=loop, task=task, status="running", message="正在生成智能建议")
    try:
        result = loop.run_until_complete(task)
        if _job(job_id).get("cancel_requested"):
            _set_job(job_id, status="cancelled", message="已取消生成")
        else:
            _set_job(job_id, status="done", result=result, message="生成完成")
    except asyncio.CancelledError:
        _set_job(job_id, status="cancelled", message="已取消生成")
    except Exception as exc:
        _set_job(job_id, status="error", error=str(exc), message="生成失败")
    finally:
        loop.close()


@router.post("/jobs")
def start_job(payload: dict = Body(...)):
    kind = str(payload.get("kind") or "")
    data = _load_providers()
    provider = data.get("default")
    if not provider:
        raise HTTPException(status_code=400, detail="请先添加并启用默认智能供应商")
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {"status": "queued", "kind": kind, "message": "等待生成", "cancel_requested": False}
    threading.Thread(target=_worker, args=(job_id, provider, kind, payload.get("payload") or {}), daemon=True).start()
    return {"status": "started", "job_id": job_id}


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = _job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="智能任务不存在")
    return {key: value for key, value in job.items() if key not in {"loop", "task", "cancel_requested"}}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="智能任务不存在")
        if job.get("status") not in {"queued", "running"}:
            return {"status": job.get("status")}
        job["cancel_requested"] = True
        loop, task = job.get("loop"), job.get("task")
        if loop and task:
            loop.call_soon_threadsafe(task.cancel)
        job["message"] = "正在终止生成…"
    return {"status": "cancelling"}
