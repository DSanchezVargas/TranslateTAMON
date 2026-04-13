const request = require('supertest');
const app = require('../src/app');

describe('app routes', () => {
  test('GET /health responds ok', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  test('POST /api/translate requires file', async () => {
    const response = await request(app)
      .post('/api/translate')
      .field('sourceLanguage', 'en')
      .field('targetLanguage', 'es');

    expect(response.status).toBe(400);
  });
});
