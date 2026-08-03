from fastapi import APIRouter, UploadFile, File
import os
import shutil

router = APIRouter(prefix="/api/music")

MUSIC_DIR = "music_library"

@router.post("/upload")
async def upload_music(file: UploadFile = File(...)):
    # 确保目录存在
    os.makedirs(MUSIC_DIR, exist_ok=True)

    # 保存文件到永久库
    file_path = os.path.join(MUSIC_DIR, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"status": "ok", "filename": file.filename}
