import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from routers.musicload import router as music_router
from routers.MusicEdit import router as music_edit_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册音乐管理路由
app.include_router(music_router)
app.include_router(music_edit_router)

# 静态文件服务 — 让前端可以通过 URL 直接访问音乐库文件
MUSIC_LIBRARY = os.path.join(os.path.expanduser("~"), "Music", "Music_Library")
os.makedirs(MUSIC_LIBRARY, exist_ok=True)

# 数据备份目录（封面 / 歌词 / 元信息）
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

@app.on_event("startup")
def startup():
    os.makedirs(MUSIC_LIBRARY, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)

# 挂载静态文件目录（用于前端播放音频 / 加载封面）
app.mount("/library", StaticFiles(directory=MUSIC_LIBRARY), name="library")
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")

@app.get("/api/hello")
def hello():
    return {"message": "Hello from Python backend!"}

@app.get("/api/test")
def test():
    return {"msg": "Python backend is running!"}
