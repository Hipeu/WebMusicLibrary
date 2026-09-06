import asyncio
import unittest

from services.match import MusicMatcher


class StubNeteaseMatcher(MusicMatcher):
    def __init__(self):
        super().__init__(rate="fast")
        self.requested_album_ids = []

    async def ncm_search(self, _session, _song_name, _artist_name, limit=10):
        return [{
            "title": "月如歌",
            "artist": "Tank",
            "album": "月如歌",
            "album_artist": "Tank",
            "ncm_id": 2086016022,
            "ncm_album_id": 175730326,
            "year": "2023",
            "cover_url": "https://example.test/cover.jpg",
        }]

    async def ncm_album_description(self, _session, album_id):
        self.requested_album_ids.append(album_id)
        return "专辑简介"


class NeteaseMatchTests(unittest.TestCase):
    def test_search_result_keeps_album_id(self):
        matcher = MusicMatcher(rate="fast")

        async def fake_get(_session, _path, _params=None):
            return {"result": {"songs": [{
                "id": 2086016022,
                "name": "月如歌",
                "ar": [{"name": "Tank"}],
                "al": {"id": 175730326, "name": "月如歌", "picUrl": "https://example.test/a.jpg"},
            }]}}

        matcher._ncm_get = fake_get
        results = asyncio.run(matcher.ncm_search(object(), "月如歌", "Tank"))

        self.assertEqual(results[0]["ncm_id"], 2086016022)
        self.assertEqual(results[0]["ncm_album_id"], 175730326)

    def test_song_match_fetches_description_with_album_id(self):
        matcher = StubNeteaseMatcher()
        sources = {"qq": False, "netease": True, "itunes": False, "musicbrainz": False}
        fields = {
            "title": True, "artist": True, "album": True, "album_artist": True,
            "year": True, "description": True, "track_disc": False, "genre": False,
            "lyric": False, "composer": False, "lyricist": False,
            "publisher": False, "arranger": False, "producer": False,
        }

        result = asyncio.run(matcher.get_song_metadata(object(), "月如歌", "Tank", sources=sources, fields=fields))

        self.assertEqual(matcher.requested_album_ids, [175730326])
        self.assertEqual(result["description"], "专辑简介")


if __name__ == "__main__":
    unittest.main()
