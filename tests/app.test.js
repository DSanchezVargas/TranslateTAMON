const request = require('supertest');
const app = require('../src/app');

describe('app routes', () => {
  const previousAdminToken = process.env.ADMIN_TOKEN;

  beforeAll(() => {
    process.env.ADMIN_TOKEN = 'test-admin-token';
  });

  afterAll(() => {
    process.env.ADMIN_TOKEN = previousAdminToken;
  });

  test('GET /health responds ok', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      system: "Tamon's Translator",
      learning: {
        adminContributes: true,
        automaticReuse: true
      }
    });
  });

  test('POST /api/translate requires file', async () => {
    const response = await request(app)
      .post('/api/translate')
      .field('sourceLanguage', 'en')
      .field('targetLanguage', 'es');

    expect(response.status).toBe(400);
  });

  test('POST /api/translate/preview requires file', async () => {
    const response = await request(app)
      .post('/api/translate/preview')
      .field('sourceLanguage', 'en')
      .field('targetLanguage', 'es');

    expect(response.status).toBe(400);
  });

  test('POST /api/memory/corrections rejects non-admin', async () => {
    const response = await request(app)
      .post('/api/memory/corrections')
      .send({
        project: 'default',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        originalTranslation: 'risk',
        correctedTranslation: 'riesgo'
      });

    expect(response.status).toBe(403);
  });

  test('POST /api/memory/glossary rejects non-admin', async () => {
    const response = await request(app)
      .post('/api/memory/glossary')
      .send({
        project: 'default',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        sourceTerm: 'risk',
        targetTerm: 'riesgo'
      });

    expect(response.status).toBe(403);
  });

  test('POST /api/memory/rules rejects non-admin', async () => {
    const response = await request(app)
      .post('/api/memory/rules')
      .send({
        project: 'default',
        domain: 'general',
        findText: 'risk',
        replaceText: 'exposure'
      });

    expect(response.status).toBe(403);
  });
});
