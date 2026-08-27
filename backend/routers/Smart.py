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
        "web_search": bool(item.get("web_search")), "output_length": item.get("output_length") or "medium",
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
    data["providers"][kind] = {
        "api_key": api_key,
        "model": model,
        "connected": bool(payload.get("connected")),
        "enabled": bool(payload.get("enabled", True)),
        "web_search": bool(payload.get("web_search", old.get("web_search", False))),
        "output_length": str(payload.get("output_length") or old.get("output_length") or "medium"),
    }
    if data["providers"][kind]["enabled"]:
        for other_kind, other_item in data["providers"].items():
            if other_kind != kind:
                other_item["enabled"] = False
        data["default"] = kind
    elif payload.get("make_default") or not data.get("default"):
        data["default"] = kind
    _save_providers(data)
    return {"status": "ok", "provider": _public_provider(kind, data["providers"][kind], data.get("default"))}


@router.post("/providers/{kind}/default")
def set_default_provider(kind: str):
    kind = _safe_provider(kind)
    data = _load_providers()
    if kind not in data.get("providers", {}):
        raise HTTPException(status_code=404, detail="供应商未添加")
    data["default"] = kind
    _save_providers(data)
    return {"status": "ok"}


@router.post("/providers/{kind}/toggle")
def toggle_provider(kind: str, payload: dict = Body(...)):
    kind = _safe_provider(kind)
    data = _load_providers()
    item = data.get("providers", {}).get(kind)
    if not item:
        raise HTTPException(status_code=404, detail="供应商未添加")
    enabled = bool(payload.get("enabled"))
    item["enabled"] = enabled
    if enabled:
        # 智能任务一次仅使用一个服务；启用新的服务时自动停用其余服务。
        for other_kind, other_item in data.get("providers", {}).items():
            if other_kind != kind:
                other_item["enabled"] = False
        data["default"] = kind
    elif data.get("default") == kind:
        data["default"] = next((other_kind for other_kind, other_item in data.get("providers", {}).items() if other_item.get("enabled")), None)
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


def _instructions(kind, payload, output_length="medium"):
    if kind == "playlist":
        return "根据用户描述和本地曲目目录推荐播放列表。只返回 JSON：{description:string,song_ids:string[]}。song_ids 必须来自目录，不能虚构歌曲。"
    if kind == "playlist_description":
        length_requirement = {
            "short": "简介控制在 60 至 100 个中文字符，表达精炼。",
            "medium": "简介控制在 120 至 180 个中文字符，信息完整但不冗长。",
            "long": "简介控制在 220 至 320 个中文字符，提供更丰富的风格和听感描述。",
        }.get(output_length, "简介控制在 120 至 180 个中文字符，信息完整但不冗长。")
        return f"根据歌单名称和曲目目录写中文歌单简介。{length_requirement}只返回 JSON：{{description:string}}。"
    if kind == "song_suggestion":
        return "根据本地单曲资料补全可能缺失的文本元信息。只返回 JSON 对象，可用字段 title,artist,album,album_artist,year,genre,trackNo,discNo,composer,lyricist,publisher,comment。不要返回图片或 URL。"
    if kind == "album_suggestion":
        return "根据本地专辑与曲目资料补全专辑文本信息。只返回 JSON：{title,artist,album_artist,year,genre,publisher,description}。不要返回图片或 URL。"
    raise ValueError("不支持的智能任务")


def _max_output_tokens(kind, item):
    if kind != "playlist_description":
        return 500
    return {"short": 320, "medium": 560, "long": 900}.get(item.get("output_length"), 560)


def _parse_json(content):
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", (content or "").strip(), flags=re.I)
    if not content:
        raise ValueError("模型未返回最终内容，请重试")
    try:
        value = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError("模型返回的内容不是有效 JSON，请重试") from exc
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
    model = item.get("model") or PROVIDER_DEFAULTS[provider]["model"]
    web_search = provider == "deepseek" and model == "deepseek-v4-flash" and bool(item.get("web_search"))
    instructions = _instructions(kind, payload, item.get("output_length") or "medium")
    request = {
        "model": model,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
        "max_tokens": _max_output_tokens(kind, item),
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
    }
    # DeepSeek 默认开启高强度思考；本应用需要短的结构化结果，关闭它可确保返回正文。
    if provider == "deepseek":
        request["thinking"] = {"type": "disabled"}
    timeout = aiohttp.ClientTimeout(total=120)
    headers = {"Authorization": f"Bearer {item['api_key']}", "Content-Type": "application/json"}
    async with aiohttp.ClientSession(timeout=timeout) as session:
        if web_search:
            search_request = {
                "model": model,
                "instructions": instructions,
                "input": json.dumps(payload, ensure_ascii=False),
                "max_output_tokens": _max_output_tokens(kind, item),
                # 输出额度包含思考 token；关闭思考可避免搜索完成后没有留下 JSON 正文。
                "reasoning": {"effort": "none"},
                "tools": [{"type": "web_search"}],
                "tool_choice": {"type": "web_search"},
                "text": {"format": {"type": "json_object"}},
            }
            # DeepSeek 的 Responses API 不在 OpenAI 兼容的 /v1 路径下。
            endpoint = "https://api.deepseek.com/responses"
            async with session.post(endpoint, headers=headers, json=search_request) as resp:
                body = await resp.json(content_type=None)
                if resp.status >= 400:
                    raise ValueError(body.get("error", {}).get("message") or f"HTTP {resp.status}")

            # Responses API 无状态：搜索阶段仅返回 web_search_call 时，必须原样回传，
            # 服务端才会恢复检索结果并让模型生成最终内容。
            first_content = body.get("output_text") or ""
            if not first_content:
                first_content = "".join(part.get("text", "") for output_item in body.get("output", []) if output_item.get("type") == "message" for part in output_item.get("content", []) if part.get("type") == "output_text")
            if not first_content.strip():
                _set_job(job_id, message=f"正在整理 {provider_name} 联网搜索结果")
                continuation_request = {
                    "model": model,
                    "instructions": instructions,
                    "input": [
                        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                        *body.get("output", []),
                        {"role": "user", "content": "请根据以上联网搜索结果生成最终答案。只返回符合要求的 JSON 对象。"},
                    ],
                    "max_output_tokens": _max_output_tokens(kind, item),
                    "reasoning": {"effort": "none"},
                    "tool_choice": "none",
                    "text": {"format": {"type": "json_object"}},
                }
                async with session.post(endpoint, headers=headers, json=continuation_request) as resp:
                    body = await resp.json(content_type=None)
                    if resp.status >= 400:
                        raise ValueError(body.get("error", {}).get("message") or f"HTTP {resp.status}")
        else:
            endpoint = f"{base}/chat/completions"
            async with session.post(endpoint, headers=headers, json=request) as resp:
                body = await resp.json(content_type=None)
                if resp.status >= 400:
                    raise ValueError(body.get("error", {}).get("message") or f"HTTP {resp.status}")
    _set_job(job_id, message=f"正在接收 {provider_name} 数据")
    if web_search:
        content = body.get("output_text") or ""
        if not content:
            content = "".join(part.get("text", "") for item in body.get("output", []) if item.get("type") == "message" for part in item.get("content", []) if part.get("type") == "output_text")
        if not content.strip():
            reason = ((body.get("incomplete_details") or {}).get("reason") or body.get("status") or "未知原因")
            raise ValueError(f"联网搜索未生成最终内容（{reason}），请重试或选择更长的输出内容长度")
        return _parse_json(content)
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
