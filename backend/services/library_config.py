import os
import json
import shutil
import threading

# backend/services/ 上溯到项目根目录
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")

DEFAULT_LIBRARY = os.path.join(os.path.expanduser("~"), "Music", "Music_Library")

# 迁移进度（后台线程更新）
_migration = {"running": False, "done": 0, "total": 0, "error": None}


def _load_config():
    """读取统一配置；损坏或不存在时返回空配置。"""
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_config(config):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def get_library_path():
    """返回当前资料库路径（读 data/config.json，缺省用默认路径）"""
    cfg = _load_config()
    p = cfg.get("music_library")
    if p and os.path.isabs(p):
        return p
    return DEFAULT_LIBRARY


def get_app_settings():
    """返回跨浏览器同步的应用设置；主题等本地偏好不在此处保存。"""
    settings = _load_config().get("app_settings", {})
    return settings if isinstance(settings, dict) else {}


def save_app_settings(settings):
    """合并保存应用设置，保留资料库路径和未涉及字段。"""
    if not isinstance(settings, dict):
        return False
    config = _load_config()
    current = config.get("app_settings", {})
    if not isinstance(current, dict):
        current = {}
    current.update({k: v for k, v in settings.items() if isinstance(k, str)})
    config["app_settings"] = current
    _save_config(config)
    return True


def _count_items(path):
    """统计资料库顶层条目数（用于迁移进度 total）"""
    if not os.path.isdir(path):
        return 0
    try:
        return len(os.listdir(path))
    except Exception:
        return 0


def _migrate_library_worker(old_path, new_path):
    """后台线程：迁移旧资料库内容到新路径（合并；跨盘符回退复制+删除）"""
    try:
        os.makedirs(new_path, exist_ok=True)
        if os.path.isdir(old_path):
            total = _count_items(old_path)
            _migration["total"] = total
            done = 0
            for name in os.listdir(old_path):
                src = os.path.join(old_path, name)
                dst = os.path.join(new_path, name)
                if not os.path.exists(dst):  # 合并：同名保留新路径的
                    try:
                        shutil.move(src, dst)
                    except Exception:
                        try:
                            if os.path.isdir(src):
                                shutil.copytree(src, dst)
                                shutil.rmtree(src)
                            else:
                                shutil.copy2(src, dst)
                                os.remove(src)
                        except Exception:
                            pass
                done += 1
                _migration["done"] = done
        # 写配置
        config = _load_config()
        config["music_library"] = new_path
        _save_config(config)
        _migration.update(running=False, done=_migration["done"], total=_migration["total"], error=None)
    except Exception as e:
        _migration.update(running=False, error=str(e))


def migration_status():
    """返回当前迁移进度状态"""
    return dict(_migration)


def start_library_migration(path):
    """校验并启动后台迁移线程（迁移 + 写配置）。

    返回 (new_path, error)；error 为 None 表示已启动迁移。
    """
    path = (path or "").strip().strip('"').strip("'")
    if not path:
        return None, "路径不能为空"
    if not os.path.isabs(path):
        return None, "请输入完整绝对路径"
    if _migration["running"]:
        return None, "已有迁移任务进行中"
    old = get_library_path()
    _migration.update(running=True, done=0, total=_count_items(old), error=None)
    t = threading.Thread(target=_migrate_library_worker, args=(old, path), daemon=True)
    t.start()
    return path, None
