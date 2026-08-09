import os
import json
import shutil

# backend/services/ 上溯到项目根目录
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")

DEFAULT_LIBRARY = os.path.join(os.path.expanduser("~"), "Music", "Music_Library")


def get_library_path():
    """返回当前资料库路径（读 data/config.json，缺省用默认路径）"""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            p = cfg.get("music_library")
            if p and os.path.isabs(p):
                return p
        except Exception:
            pass
    return DEFAULT_LIBRARY


def _migrate_library(old_path, new_path):
    """将旧资料库内容迁移到新路径（合并；跨盘符回退复制+删除）"""
    if os.path.normcase(os.path.abspath(old_path)) == os.path.normcase(os.path.abspath(new_path)):
        return
    if not os.path.isdir(old_path):
        return
    os.makedirs(new_path, exist_ok=True)
    for name in os.listdir(old_path):
        src = os.path.join(old_path, name)
        dst = os.path.join(new_path, name)
        if os.path.exists(dst):
            continue  # 合并：同名保留新路径的
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


def set_library_path(path):
    """校验并设置资料库路径：迁移旧文件 → 创建新目录 → 写配置。
    返回 (new_path, error)；error 为 None 表示成功。
    """
    path = (path or "").strip().strip('"').strip("'")
    if not path:
        return None, "路径不能为空"
    if not os.path.isabs(path):
        return None, "请输入完整绝对路径"
    old = get_library_path()
    try:
        _migrate_library(old, path)
        os.makedirs(path, exist_ok=True)
    except Exception as e:
        return None, f"迁移失败: {e}"
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({"music_library": path}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        return None, f"保存配置失败: {e}"
    return path, None
