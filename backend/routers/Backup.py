import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, BackgroundTasks, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from services.library_config import _load_config, _save_config, get_library_path

router = APIRouter(prefix="/api/data")

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
BACKUP_DIR = os.path.join(PROJECT_ROOT, "backups")
FORMAT_VERSION = 1
_jobs = {}
_uploads = {}
_lock = threading.Lock()

DATA_TYPES = {"artists", "albums", "playlists", "settings", "music"}


class JobCancelled(Exception):
    pass


def _job(job_id):
    with _lock:
        return dict(_jobs.get(job_id) or {})


def _set_job(job_id, **changes):
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(changes)


def _check_cancel(job_id):
    if _job(job_id).get("cancel_requested"):
        raise JobCancelled()


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_rel(value):
    path = PurePosixPath(str(value).replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("备份包包含不安全的文件路径")
    return path


def _iter_files(root):
    if not os.path.isdir(root):
        return []
    return [p for p in Path(root).rglob("*") if p.is_file()]


def _selected_data_files(selected):
    paths = []
    mapping = {
        "artists": ("artists.json", "artists_img"),
        "albums": ("picture", "metadata", "Lyrics"),
        "playlists": ("playlists.json",),
    }
    for kind, entries in mapping.items():
        if kind not in selected:
            continue
        for entry in entries:
            path = Path(DATA_DIR, entry)
            if path.is_file():
                paths.append(path)
            elif path.is_dir():
                paths.extend(_iter_files(path))
    return paths


def _load_json_dict(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            value = json.load(f)
            return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _album_export_payload(library_path):
    """构建不含音频的专辑曲目清单、参与艺人资料和对应艺人图片。"""
    catalog = _load_json_dict(os.path.join(library_path, ".manifest.json"))
    artist_names = set()
    for entry in catalog.values():
        if not isinstance(entry, dict):
            continue
        for name in (entry.get("artist"), entry.get("album_artist")):
            if isinstance(name, str) and name.strip():
                artist_names.add(name.strip())

    all_artists = _load_json_dict(os.path.join(DATA_DIR, "artists.json"))
    artist_records = {name: all_artists[name] for name in artist_names if name in all_artists}
    image_files = []
    for name in artist_names:
        safe_name = re.sub(r'[<>:"/\\|?*]', "", name).strip() or "unknown"
        image_dir = Path(DATA_DIR, "artists_img", safe_name)
        if image_dir.is_dir():
            image_files.extend(_iter_files(image_dir))
    return catalog, artist_records, image_files


def _write_archive(archive_path, library_path, selected=None, progress=None, cancel=None):
    selected = set(selected or DATA_TYPES) & DATA_TYPES
    lib_files = _iter_files(library_path) if "music" in selected else []
    data_files = _selected_data_files(selected)
    album_catalog, album_artists, album_artist_images = ({}, {}, [])
    if "albums" in selected:
        album_catalog, album_artists, album_artist_images = _album_export_payload(library_path)
    album_artist_export_files = album_artist_images if "artists" not in selected else []
    extra_count = 1 + (1 if "settings" in selected else 0) + (2 if "albums" in selected else 0)
    data_files = data_files + album_artist_export_files
    total = len(lib_files) + len(data_files) + extra_count
    done = 0
    manifest = {
        "format": "WebMusicPlayer-backup",
        "version": FORMAT_VERSION,
        "exported_at": int(time.time() * 1000),
        "types": sorted(selected),
        "library_files": len(lib_files),
        "data_files": len(data_files),
    }
    config = _load_config()
    exported_config = {"app_settings": config.get("app_settings", {})}
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("backup.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        done += 1
        if "settings" in selected:
            archive.writestr("data/config.json", json.dumps(exported_config, ensure_ascii=False, indent=2))
            done += 1
        if "albums" in selected:
            archive.writestr("data/albums_manifest.json", json.dumps(album_catalog, ensure_ascii=False, indent=2))
            archive.writestr("data/album_artists.json", json.dumps(album_artists, ensure_ascii=False, indent=2))
            done += 2
        for path in lib_files:
            if cancel:
                cancel()
            archive.write(path, Path("library") / path.relative_to(library_path))
            done += 1
            if progress:
                progress(done, total)
        for path in data_files:
            if cancel:
                cancel()
            if path in album_artist_export_files:
                archive.write(path, Path("data/album_artists_img") / path.relative_to(Path(DATA_DIR, "artists_img")))
            else:
                archive.write(path, Path("data") / path.relative_to(DATA_DIR))
            done += 1
            if progress:
                progress(done, total)
    return total


def _export_worker(job_id, selected):
    temp_dir = tempfile.mkdtemp(prefix="webmusic-export-")
    archive_path = os.path.join(temp_dir, "WebMusicPlayer-backup.zip")
    try:
        _set_job(job_id, status="running", message="正在整理数据")
        _check_cancel(job_id)
        total = _write_archive(
            archive_path, get_library_path(), selected,
            lambda done, all_: _set_job(job_id, done=done, total=all_),
            lambda: _check_cancel(job_id),
        )
        _check_cancel(job_id)
        _set_job(job_id, status="done", done=total, total=total, path=archive_path, cancellable=False, message="导出完成")
    except JobCancelled:
        _remove_file(archive_path)
        _set_job(job_id, status="cancelled", ongoing=False, message="已取消导出")
    except Exception as exc:
        _set_job(job_id, status="error", error=str(exc), message="导出失败")


@router.post("/export")
def start_export(payload: dict = Body(...)):
    selected = set(payload.get("types") or []) & DATA_TYPES
    if not selected:
        raise HTTPException(status_code=400, detail="请至少选择一种导出数据")
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {"kind": "export", "status": "queued", "done": 0, "total": 0, "message": "等待导出", "cancellable": True, "cancel_requested": False}
    threading.Thread(target=_export_worker, args=(job_id, selected), daemon=True).start()
    return {"status": "started", "job_id": job_id}


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    result = _job(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="任务不存在")
    result.pop("path", None)
    return result


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="任务不存在")
        if job.get("status") not in {"queued", "running"}:
            return {"status": job.get("status")}
        if not job.get("cancellable", True):
            return {"status": "locked", "msg": "恢复数据已经开始，当前阶段不能取消"}
        job["cancel_requested"] = True
        job["message"] = "正在取消…"
    return {"status": "cancelling"}


def _remove_file(path):
    try:
        os.remove(path)
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)
    except Exception:
        pass


@router.get("/export/{job_id}/download")
def download_export(job_id: str, background_tasks: BackgroundTasks):
    result = _job(job_id)
    path = result.get("path") if result else None
    if result.get("status") != "done" or not path or not os.path.isfile(path):
        raise HTTPException(status_code=409, detail="导出文件尚未准备好")
    background_tasks.add_task(_remove_file, path)
    return FileResponse(path, media_type="application/zip", filename="WebMusicPlayer-backup.zip")


def _extract_checked(archive_path, target_dir):
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        if len(infos) > 20000:
            raise ValueError("备份包文件数量过多")
        for info in infos:
            rel = _safe_rel(info.filename)
            if not rel.parts:
                continue
            if rel.parts[0] not in {"library", "data", "backup.json"}:
                raise ValueError("备份包包含未知内容")
            if info.file_size > 4 * 1024 * 1024 * 1024:
                raise ValueError("备份包内存在过大的文件")
            dest = Path(target_dir, *rel.parts)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not info.is_dir():
                with archive.open(info) as source, open(dest, "wb") as output:
                    shutil.copyfileobj(source, output)
    manifest_path = os.path.join(target_dir, "backup.json")
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception as exc:
        raise ValueError("备份包缺少有效的 backup.json") from exc
    if manifest.get("format") != "WebMusicPlayer-backup" or manifest.get("version") != FORMAT_VERSION:
        raise ValueError("不支持的备份包版本")
    return manifest


def _inspect_archive(archive_path):
    with zipfile.ZipFile(archive_path) as archive:
        try:
            manifest = json.loads(archive.read("backup.json").decode("utf-8"))
        except Exception as exc:
            raise ValueError("备份包缺少有效的 backup.json") from exc
    if manifest.get("format") != "WebMusicPlayer-backup" or manifest.get("version") != FORMAT_VERSION:
        raise ValueError("不支持的备份包版本")
    declared = set(manifest.get("types") or []) & DATA_TYPES
    if not declared:
        # 兼容第一版全量备份包。
        declared = set(DATA_TYPES)
    return sorted(declared)


def _copy_with_unique_name(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        shutil.copy2(source, destination)
        return destination, False
    if _sha256(source) == _sha256(destination):
        return destination, True
    stem, suffix = destination.stem, destination.suffix
    index = 1
    while True:
        candidate = destination.with_name(f"{stem} ({index}){suffix}")
        if not candidate.exists():
            shutil.copy2(source, candidate)
            return candidate, False
        if _sha256(source) == _sha256(candidate):
            return candidate, True
        index += 1


def _copy_tree_merge(source, destination):
    for file_path in _iter_files(source):
        relative = file_path.relative_to(source)
        target = Path(destination, relative)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file_path, target)


def _merge_json_records(source, target, imported_wins=True):
    imported = _load_json_dict(source)
    if not imported:
        return
    current = _load_json_dict(target)
    if imported_wins:
        current.update(imported)
    else:
        current.update({key: value for key, value in imported.items() if key not in current})
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")


def _restore_album_catalog(source_data, library, imported_wins=True):
    """恢复专辑曲目清单；音频不存在时由音乐列表接口标记为缺失。"""
    source = Path(source_data, "albums_manifest.json")
    if source.is_file():
        _merge_json_records(source, Path(library, ".manifest.json"), imported_wins)
    _merge_json_records(Path(source_data, "album_artists.json"), Path(DATA_DIR, "artists.json"), imported_wins)
    _copy_tree_merge(Path(source_data, "album_artists_img"), Path(DATA_DIR, "artists_img"))


def _merge_playlists(imported, path_map):
    current_path = os.path.join(DATA_DIR, "playlists.json")
    try:
        with open(current_path, "r", encoding="utf-8") as f:
            current = json.load(f)
    except Exception:
        current = []
    if not isinstance(current, list):
        current = []
    used_ids = {item.get("id") for item in current if isinstance(item, dict)}
    for playlist in imported if isinstance(imported, list) else []:
        if not isinstance(playlist, dict):
            continue
        item = dict(playlist)
        original_id = item.get("id") or f"pl_{int(time.time() * 1000)}"
        item["songs"] = [
            {**song, "file_path": path_map.get(song.get("file_path"), song.get("file_path"))}
            for song in (item.get("songs") or []) if isinstance(song, dict) and song.get("file_path")
        ]

        # liked / recent 是固定 ID 的系统播放列表。合并导入时合并歌曲，
        # 不能像普通播放列表一样因 ID 冲突而重命名。
        if original_id in {"liked", "recent"}:
            system_name = "我喜欢的音乐" if original_id == "liked" else "最近播放"
            existing = next((entry for entry in current if isinstance(entry, dict) and entry.get("id") == original_id), None)
            if existing is None:
                item["id"] = original_id
                item["name"] = system_name
                item["pinned"] = False
                current.append(item)
                used_ids.add(original_id)
                continue

            combined = []
            seen = set()
            for song in [*item["songs"], *(existing.get("songs") or [])]:
                if not isinstance(song, dict):
                    continue
                identity = song.get("file_path") or song.get("hash") or song.get("url") or (song.get("title"), song.get("artist"), song.get("album"))
                if identity in seen:
                    continue
                seen.add(identity)
                combined.append(song)
            existing["name"] = system_name
            existing["songs"] = combined
            existing["pinned"] = False
            continue

        item["id"] = original_id
        sequence = 1
        while item["id"] in used_ids:
            item["id"] = f"{original_id}-imported-{sequence}"
            sequence += 1
        used_ids.add(item["id"])
        current.append(item)
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(current_path, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)


def _import_worker(job_id, archive_path, mode, keep_backup, selected):
    work_dir = tempfile.mkdtemp(prefix="webmusic-import-")
    try:
        _set_job(job_id, status="running", message="正在验证备份包")
        manifest = _extract_checked(archive_path, work_dir)
        available = set(manifest.get("types") or DATA_TYPES) & DATA_TYPES
        selected = set(selected) & available
        if not selected:
            raise ValueError("没有选择可恢复的数据")
        _check_cancel(job_id)
        source_lib = Path(work_dir, "library")
        source_data = Path(work_dir, "data")
        source_lib.mkdir(parents=True, exist_ok=True)
        source_data.mkdir(parents=True, exist_ok=True)
        library = Path(get_library_path())
        library.mkdir(parents=True, exist_ok=True)
        if mode == "replace":
            if keep_backup:
                os.makedirs(BACKUP_DIR, exist_ok=True)
                backup_path = os.path.join(BACKUP_DIR, f"pre-import-{int(time.time())}.zip")
                _write_archive(backup_path, str(library), DATA_TYPES)
            _check_cancel(job_id)
            # 开始替换后锁定取消，避免留下半完成资料库。
            _set_job(job_id, cancellable=False)
            _set_job(job_id, message="正在恢复数据", done=0, total=1)
            current_config = _load_config()
            if "music" in selected:
                shutil.rmtree(library, ignore_errors=True)
                shutil.copytree(source_lib, library, dirs_exist_ok=True)
            if "artists" in selected:
                for entry in ("artists.json", "artists_img"):
                    target = Path(DATA_DIR, entry)
                    if target.is_dir(): shutil.rmtree(target, ignore_errors=True)
                    elif target.exists(): target.unlink()
                    source = source_data / entry
                    if source.is_dir(): shutil.copytree(source, target, dirs_exist_ok=True)
                    elif source.is_file(): target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, target)
            if "albums" in selected:
                for entry in ("picture", "metadata", "Lyrics"):
                    target = Path(DATA_DIR, entry)
                    shutil.rmtree(target, ignore_errors=True)
                    source = source_data / entry
                    if source.is_dir(): shutil.copytree(source, target, dirs_exist_ok=True)
                _restore_album_catalog(source_data, library, imported_wins=True)
            if "playlists" in selected:
                source = source_data / "playlists.json"; target = Path(DATA_DIR, "playlists.json")
                if target.exists(): target.unlink()
                if source.is_file(): target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, target)
            if "settings" in selected:
                try:
                    imported_settings = json.loads((source_data / "config.json").read_text(encoding="utf-8")).get("app_settings", {})
                    current_config["app_settings"] = imported_settings if isinstance(imported_settings, dict) else {}
                except Exception:
                    current_config["app_settings"] = {}
            current_config["music_library"] = str(library)
            _save_config(current_config)
            _set_job(job_id, done=1, total=1)
        else:
            _set_job(job_id, message="正在合并音乐", done=0, total=max(1, len(_iter_files(source_lib))))
            path_map = {}
            done = 0
            for file_path in _iter_files(source_lib):
                _check_cancel(job_id)
                rel = file_path.relative_to(source_lib)
                if rel.as_posix() == ".manifest.json":
                    continue
                if "music" not in selected:
                    continue
                target, duplicate = _copy_with_unique_name(file_path, library / rel)
                path_map[rel.as_posix()] = target.relative_to(library).as_posix()
                done += 1
                _set_job(job_id, done=done)
            _set_job(job_id, message="正在合并资料", done=0, total=max(1, len(_iter_files(source_data))))
            _check_cancel(job_id)
            if "albums" in selected:
                _copy_tree_merge(source_data / "picture", Path(DATA_DIR, "picture"))
                _copy_tree_merge(source_data / "Lyrics", Path(DATA_DIR, "Lyrics"))
                _copy_tree_merge(source_data / "metadata", Path(DATA_DIR, "metadata"))
                _restore_album_catalog(source_data, library, imported_wins=False)
            if "artists" in selected:
                _copy_tree_merge(source_data / "artists_img", Path(DATA_DIR, "artists_img"))
            _check_cancel(job_id)
            imported_manifest = {}
            try:
                with open(source_lib / ".manifest.json", "r", encoding="utf-8") as f:
                    imported_manifest = json.load(f)
            except Exception:
                pass
            manifest_path = library / ".manifest.json"
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    current_manifest = json.load(f)
            except Exception:
                current_manifest = {}
            for old_path, entry in ((imported_manifest or {}).items() if "music" in selected else []):
                new_path = path_map.get(old_path, old_path)
                if new_path not in current_manifest:
                    current_manifest[new_path] = {**entry, "file_path": new_path}
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(current_manifest, f, ensure_ascii=False, indent=2)
            _check_cancel(job_id)
            try:
                if "playlists" not in selected:
                    raise FileNotFoundError()
                with open(source_data / "playlists.json", "r", encoding="utf-8") as f:
                    _merge_playlists(json.load(f), path_map)
            except Exception:
                pass
            _check_cancel(job_id)
            for name in (("artists.json",) if "artists" in selected else ()):
                source = source_data / name
                target = Path(DATA_DIR, name)
                if source.exists():
                    try:
                        imported = json.loads(source.read_text(encoding="utf-8"))
                        current = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}
                        if isinstance(imported, dict) and isinstance(current, dict):
                            current.update({key: value for key, value in imported.items() if key not in current})
                            target.parent.mkdir(parents=True, exist_ok=True)
                            target.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
                    except Exception:
                        pass
            _check_cancel(job_id)
            try:
                if "settings" not in selected:
                    raise FileNotFoundError()
                imported_settings = json.loads((source_data / "config.json").read_text(encoding="utf-8")).get("app_settings", {})
                if isinstance(imported_settings, dict):
                    config = _load_config()
                    config["app_settings"] = imported_settings
                    config["music_library"] = str(library)
                    _save_config(config)
            except Exception:
                pass
            _check_cancel(job_id)
            _set_job(job_id, done=1, total=1)
        _set_job(job_id, status="done", cancellable=False, message="导入完成")
    except JobCancelled:
        _set_job(job_id, status="cancelled", message="已取消导入，已完成的合并内容将保留")
    except Exception as exc:
        _set_job(job_id, status="error", error=str(exc), message="导入失败")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        try:
            os.remove(archive_path)
        except Exception:
            pass


@router.post("/import/inspect")
async def inspect_import(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="请选择 ZIP 备份文件")
    fd, archive_path = tempfile.mkstemp(prefix="webmusic-upload-", suffix=".zip")
    os.close(fd)
    try:
        with open(archive_path, "wb") as output:
            while True:
                block = await file.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
        available = _inspect_archive(archive_path)
    except Exception as exc:
        try: os.remove(archive_path)
        except Exception: pass
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = uuid.uuid4().hex
    with _lock:
        _uploads[token] = {"path": archive_path, "types": available, "created_at": time.time()}
    return {"status": "ok", "token": token, "types": available}


@router.post("/import")
async def start_import(token: str = Form(...), mode: str = Form("merge"), keep_backup: str = Form("true"), types: str = Form("[]")):
    if mode not in {"merge", "replace"}:
        raise HTTPException(status_code=400, detail="未知的导入模式")
    with _lock:
        upload = _uploads.pop(token, None)
    if not upload or not os.path.isfile(upload.get("path", "")):
        raise HTTPException(status_code=404, detail="导入包已失效，请重新选择")
    archive_path = upload["path"]
    try:
        selected = set(json.loads(types)) & set(upload.get("types") or []) & DATA_TYPES
    except Exception as exc:
        raise HTTPException(status_code=400, detail="恢复类型格式错误") from exc
    if not selected:
        raise HTTPException(status_code=400, detail="请至少选择一种恢复数据")
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {"kind": "import", "status": "queued", "done": 0, "total": 0, "message": "等待导入", "cancellable": True, "cancel_requested": False}
    threading.Thread(target=_import_worker, args=(job_id, archive_path, mode, keep_backup == "true", selected), daemon=True).start()
    return {"status": "started", "job_id": job_id}
