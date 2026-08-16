jest.mock('../src/services', () => ({
  __esModule: true,
  default: {
    UCommon: jest.fn(),
    songLists: jest.fn(),
  },
}));

jest.mock('../src/util/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import batchGetSongInfo from '../src/controllers/batchGetSongInfo';
import batchGetSongLists from '../src/controllers/batchGetSongLists';
import services from '../src/services';
import { logger } from '../src/util/logger';

const mockedServices = services as unknown as {
  UCommon: jest.Mock;
  songLists: jest.Mock;
};

const mockedLogger = logger as unknown as {
  debug: jest.Mock;
};

describe('batch controllers coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('应批量聚合歌曲详情并写入 ctx.body', async () => {
    mockedServices.UCommon.mockResolvedValueOnce({
      data: { songMid: 'mid-1' },
    }).mockResolvedValueOnce({ data: { songMid: 'mid-2' } });

    const ctx: any = {
      request: {
        body: {
          songs: [['mid-1', 'song-1'], ['mid-2']],
        },
      },
    };

    await batchGetSongInfo(ctx);

    expect(mockedServices.UCommon).toHaveBeenCalledTimes(2);
    expect(mockedServices.UCommon).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'get',
        params: expect.objectContaining({
          data: expect.objectContaining({
            songinfo: expect.objectContaining({
              param: expect.objectContaining({
                song_mid: 'mid-1',
                song_id: 'song-1',
              }),
            }),
          }),
        }),
      }),
    );
    expect(mockedServices.UCommon).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        params: expect.objectContaining({
          data: expect.objectContaining({
            songinfo: expect.objectContaining({
              param: expect.objectContaining({
                song_mid: 'mid-2',
                song_id: '',
              }),
            }),
          }),
        }),
      }),
    );
    expect(mockedLogger.debug).toHaveBeenCalledTimes(2);
    expect(ctx.body).toEqual({
      status: 200,
      data: [{ songMid: 'mid-1' }, { songMid: 'mid-2' }],
    });
  });

  it('应按分类聚合歌单并兼容成功与非成功响应', async () => {
    mockedServices.songLists
      .mockResolvedValueOnce({
        body: {
          response: {
            code: 0,
            data: { categoryId: '100', total: 10 },
          },
        },
      })
      .mockResolvedValueOnce({
        body: {
          response: {
            code: 1,
            message: 'fallback response',
          },
        },
      });

    const ctx: any = {
      request: {
        body: {
          limit: 39,
          page: 2,
          sortId: 7,
          categoryIds: ['100', '200'],
        },
      },
    };

    await batchGetSongLists(ctx);

    expect(mockedServices.songLists).toHaveBeenCalledTimes(2);
    expect(mockedServices.songLists).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'get',
        params: expect.objectContaining({
          ein: 39,
          sin: 2,
          sortId: 7,
          categoryId: '100',
        }),
      }),
    );
    expect(mockedServices.songLists).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        params: expect.objectContaining({
          categoryId: '200',
        }),
      }),
    );
    expect(ctx.body).toEqual({
      status: 200,
      data: [
        { code: 0, data: { categoryId: '100', total: 10 } },
        { code: 1, message: 'fallback response' },
      ],
    });
  });
});
