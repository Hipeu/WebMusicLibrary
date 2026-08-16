const mockYCommon = jest.fn();

jest.mock('../src/services/y_common', () => ({
  __esModule: true,
  default: mockYCommon,
}));

jest.mock('../src/util/logger', () => ({
  __esModule: true,
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import songListDetail from '../src/services/songLists/songListDetail';
import { logger } from '../src/util/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('services/songListDetail', () => {
  beforeEach(() => {
    mockYCommon.mockReset();
    jest.clearAllMocks();
  });

  it('应在成功时返回标准响应并记录请求/成功日志', async () => {
    mockYCommon.mockResolvedValue({
      data: {
        cdlist: [{ disstid: '7011264340' }],
      },
    });

    const result = await songListDetail({
      params: {
        disstid: '7011264340',
      },
    });

    expect(mockYCommon).toHaveBeenCalledWith({
      url: '/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg',
      method: 'get',
      options: {
        params: {
          disstid: '7011264340',
          format: 'json',
          outCharset: 'utf-8',
          type: 1,
          json: 1,
          utf8: 1,
          onlysong: 0,
          new_format: 1,
        },
      },
    });
    expect(result).toEqual({
      status: 200,
      body: {
        response: {
          cdlist: [{ disstid: '7011264340' }],
        },
      },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.requesting',
      expect.objectContaining({
        service: 'songListDetail',
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'service.succeeded',
      expect.objectContaining({
        service: 'songListDetail',
        disstid: '7011264340',
      }),
    );
  });

  it('应在底层请求失败时返回 500 并记录失败日志', async () => {
    const error = new Error('song list detail failed');
    mockYCommon.mockRejectedValue(error);

    const result = await songListDetail({});

    expect(result).toEqual({
      status: 500,
      body: {
        error,
      },
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'service.failed',
      expect.objectContaining({
        service: 'songListDetail',
        error: {
          name: 'Error',
          message: 'song list detail failed',
        },
      }),
    );
  });
});
