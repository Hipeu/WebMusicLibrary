import request from 'supertest';
import app from '../src/app';

const server = app.callback();

describe('GET /getSingerDesc', () => {
  it('正常流程: 缺少 singermid 时返回 400', async () => {
    const response = await request(server).get('/getSingerDesc');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: 400,
      response: 'no singermid',
    });
  });

  it('边界条件: 传入无关参数时仍返回 400', async () => {
    const response = await request(server).get('/getSingerDesc?limit=0&page=-1');
    expect(response.status).toBe(400);
  });

  it('异常输入: 传入错误字段名时返回 400', async () => {
    const response = await request(server).get('/getSingerDesc?id=invalid_!@#');
    expect(response.status).toBe(400);
  });
});
