const mockGetHotKey = jest.fn();

jest.mock('../src/services', () => {
  const actual = jest.requireActual('../src/services');
  return {
    __esModule: true,
    default: {
      ...actual.default,
      getHotKey: mockGetHotKey,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

const server = app.callback();

describe('GET /getHotkey', () => {
  beforeEach(() => {
    mockGetHotKey.mockReset();
    mockGetHotKey.mockResolvedValue({
      status: 200,
      body: {
        response: {
          code: 0,
          hotkey: ['jay', 'jj', 'gem'],
        },
      },
    });
  });

  it('正常流程: 验证接口能否正确返回业务数据', async () => {
    const response = await request(server).get('/getHotkey');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('response');
    expect(response.body.response.code).toBe(0);
    expect(mockGetHotKey).toHaveBeenCalledWith({
      method: 'get',
      params: {},
      option: {},
    });
  });

  it('边界条件: 验证无参数情况下的表现', async () => {
    const response = await request(server).get('/getHotkey');
    expect(response.status).toBe(200);
    expect(response.body.response.code).toBe(0);
  });

  it('异常输入: 传入非法参数(多余参数)', async () => {
    const response = await request(server).get('/getHotkey?invalid=123');
    expect(response.status).toBe(200);
    expect(response.body.response.code).toBe(0);
  });

  it('性能压力: 分批并发请求', async () => {
    const concurrency = 20;
    const batches = 5;

    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      const requests = Array.from({ length: concurrency }, () => request(server).get('/getHotkey'));
      const responses = await Promise.all(requests);
      responses.forEach((res) => {
        expect(res.status).toBe(200);
      });
    }

    expect(mockGetHotKey).toHaveBeenCalledTimes(concurrency * batches);
  });

  it('安全测试: 注入攻击参数应被拦截或忽略', async () => {
    const response = await request(server).get('/getHotkey?inject=<script>alert(1)</script>');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
  });
});
