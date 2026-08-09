import os
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from routers.musicload import router as music_router
from routers.MusicEdit import router as music_edit_router
from routers.Playlists import router as playlists_router
from routers.Reset import router as reset_router
from routers.Settings import router as settings_router
from services.library_config import get_library_path

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
app.include_router(playlists_router)
app.include_router(reset_router)
app.include_router(settings_router)

# 数据备份目录（封面 / 歌词 / 元信息）
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

@app.on_event("startup")
def startup():
    os.makedirs(get_library_path(), exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)


# 动态资料库文件服务：逐请求读取配置路径，改路径后无需重启
@app.get("/library/{file_path:path}")
def serve_library_file(file_path: str):
    lib = os.path.normpath(get_library_path())
    full = os.path.normpath(os.path.join(lib, file_path))
    if full != lib and not full.startswith(lib + os.sep):
        raise HTTPException(status_code=404, detail="Not Found")
    if os.path.isfile(full):
        return FileResponse(full)
    raise HTTPException(status_code=404, detail="Not Found")


# 静态数据目录（封面 / 歌词 / 元信息，固定于项目 data/）
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")

@app.get("/api/hello")
def hello():
    return {"message": "Hello from Python backend!"}

@app.get("/api/test")
def test():
    return {"msg": "Python backend is running!"}
