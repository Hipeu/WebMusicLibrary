import json
import tempfile
import sys
import types
import unittest
import zipfile
from pathlib import Path

try:
    import fastapi  # noqa: F401
except ModuleNotFoundError:
    fastapi = types.ModuleType("fastapi")
    class _Router:
        def __init__(self, *args, **kwargs): pass
        def __getattr__(self, _name): return lambda *args, **kwargs: lambda function: function
    fastapi.APIRouter = _Router
    fastapi.BackgroundTasks = object
    fastapi.Body = fastapi.File = fastapi.Form = lambda *args, **kwargs: None
    fastapi.HTTPException = RuntimeError
    fastapi.UploadFile = object
    responses = types.ModuleType("fastapi.responses")
    responses.FileResponse = object
    sys.modules["fastapi"] = fastapi
    sys.modules["fastapi.responses"] = responses

from routers import Backup


class VideoBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.library = root / "library"
        self.data = root / "data"
        (self.library / "Artist" / "Album").mkdir(parents=True)
        (self.library / "Artist" / "Album" / "song.mp3").write_bytes(b"audio")
        (self.library / "_videos").mkdir()
        (self.library / "_videos" / "local.mp4").write_bytes(b"video")
        manifest = {"Artist/Album/song.mp3": {"file_path": "Artist/Album/song.mp3", "hash": "song-hash", "artist": "Artist", "album": "Album"}}
        (self.library / ".manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        covers = self.data / "videos" / "covers"
        covers.mkdir(parents=True)
        for name in ("local.jpg", "online.jpg", "orphan.jpg"):
            (covers / name).write_bytes(name.encode())
        videos = [
            {"id": "local", "source": "local", "file_path": "_videos/local.mp4", "song_ids": ["Artist/Album/song.mp3"], "cover_path": "videos/covers/local.jpg"},
            {"id": "online", "source": "youtube", "website_url": "https://example.test/video", "song_ids": ["song-hash"], "cover_path": "videos/covers/online.jpg"},
            {"id": "orphan", "source": "bilibili", "website_url": "https://example.test/orphan", "song_ids": [], "cover_path": "videos/covers/orphan.jpg"},
        ]
        (self.data / "videos" / "videos.json").write_text(json.dumps(videos), encoding="utf-8")
        self.old_data_dir = Backup.DATA_DIR
        Backup.DATA_DIR = str(self.data)

    def tearDown(self):
        Backup.DATA_DIR = self.old_data_dir
        self.temp.cleanup()

    def archive(self, selected, include_video_files=False):
        path = Path(self.temp.name) / f"{'-'.join(sorted(selected))}-{include_video_files}.zip"
        Backup._write_archive(path, str(self.library), selected, include_video_files=include_video_files)
        return zipfile.ZipFile(path)

    def test_albums_include_only_linked_video_information(self):
        with self.archive({"albums"}) as archive:
            names = set(archive.namelist())
            records = json.loads(archive.read("data/videos/videos.json"))
        self.assertEqual({item["id"] for item in records}, {"local", "online"})
        self.assertIn("data/videos/covers/local.jpg", names)
        self.assertIn("data/videos/covers/online.jpg", names)
        self.assertNotIn("data/videos/covers/orphan.jpg", names)
        self.assertFalse(any(name.startswith("library/_videos/") for name in names))

    def test_video_information_does_not_include_files_by_default(self):
        with self.archive({"videos"}) as archive:
            names = set(archive.namelist())
            records = json.loads(archive.read("data/videos/videos.json"))
            manifest = json.loads(archive.read("backup.json"))
        self.assertEqual(len(records), 3)
        self.assertFalse(manifest["include_video_files"])
        self.assertFalse(any(name.startswith("library/_videos/") for name in names))

    def test_video_files_are_opt_in_and_music_never_includes_them(self):
        with self.archive({"videos"}, True) as archive:
            self.assertIn("library/_videos/local.mp4", archive.namelist())
        with self.archive({"music"}, True) as archive:
            self.assertNotIn("library/_videos/local.mp4", archive.namelist())
            self.assertIn("library/Artist/Album/song.mp3", archive.namelist())

    def test_video_merge_remaps_song_and_file_paths(self):
        target = self.data / "videos" / "videos.json"
        target.write_text(json.dumps([{"id": "existing", "song_ids": []}]), encoding="utf-8")
        source = Path(self.temp.name) / "source" / "videos"
        source.mkdir(parents=True)
        source.joinpath("videos.json").write_text(json.dumps([{"id": "local", "file_path": "_videos/local.mp4", "song_ids": ["Artist/Album/song.mp3"]}]), encoding="utf-8")
        Backup._restore_video_metadata(source.parent, {"Artist/Album/song.mp3": "Artist/Album/song (1).mp3", "_videos/local.mp4": "_videos/local (1).mp4"}, imported_wins=False)
        records = {item["id"]: item for item in json.loads(target.read_text(encoding="utf-8"))}
        self.assertEqual(records["local"]["song_ids"], ["Artist/Album/song (1).mp3"])
        self.assertEqual(records["local"]["file_path"], "_videos/local (1).mp4")


if __name__ == "__main__":
    unittest.main()
