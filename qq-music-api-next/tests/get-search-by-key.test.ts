const mockGetSearchByKey = jest.fn();

jest.mock('../src/services', () => {
  const actual = jest.requireActual('../src/services');
  return {
    __esModule: true,
    default: {
      ...actual.default,
      getSearchByKey: mockGetSearchByKey,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

const server = app.callback();

describe('GET /getSearchByKey', () => {
  beforeEach(() => {
    mockGetSearchByKey.mockReset();
    mockGetSearchByKey.mockImplementation(async ({ params }) => ({
      status: 200,
      body: {
        response: {
          code: 0,
          keyword: params?.w ?? null,
          pagination: {
            limit: params?.n ?? null,
            page: params?.p ?? null,
          },
        },
      },
    }));
  });

  it('正常流程: 验证接口能否正确返回业务数据', async () => {
    const response = await request(server).get('/getSearchByKey?key=周杰伦&limit=20&page=1');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('response');
    expect(response.body.response.code).toBe(0);
    expect(mockGetSearchByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          w: '周杰伦',
          n: 20,
          p: 1,
          catZhida: 1,
          remoteplace: 'txt.yqq.song',
        }),
      }),
    );
  });

  it('边界条件: 极限值 page=99999 或 limit=0', async () => {
    const response = await request(server).get('/getSearchByKey?key=周杰伦&limit=0&page=99999');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('response');
    expect(mockGetSearchByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          n: 10,
          p: 99999,
        }),
      }),
    );
  });

  it('异常输入: 传入类型错误的值', async () => {
    const response = await request(server).get('/getSearchByKey?key=周杰伦&limit=abc&page=xyz');
    expect(response.status).toBe(200);
    // 即使类型错误，通常也会由后端处理为默认值，或者返回特定的错误码，但不会崩溃返回500
    expect(response.body).toBeDefined();
    expect(mockGetSearchByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          n: 10,
          p: 1,
        }),
      }),
    );
  });

  it('性能压力: 100并发请求', async () => {
    const requests = Array.from({ length: 100 }, () =>
      request(server).get('/getSearchByKey?key=test'),
    );
    const responses = await Promise.all(requests);
    responses.forEach((res) => {
      expect(res.status).toBe(200);
    });
    expect(mockGetSearchByKey).toHaveBeenCalledTimes(100);
  });

  it('安全测试: 验证接口是否抵御常见注入或跨站攻击', async () => {
    const response = await request(server).get('/getSearchByKey?key=<script>alert(1)</script>');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(typeof response.body).toBe('object');
    expect(mockGetSearchByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          w: '<script>alert(1)</script>',
        }),
      }),
    );
  });
});
