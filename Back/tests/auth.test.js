const request = require('supertest');
const app = require('../src/app');
const { pool, connectDb } = require('../src/config/db');

describe('Auth routes (OTP Verification Flow)', () => {
  const testEmail = 'otptest@tamon.io';
  const testPassword = 'Password123!';
  const testName = 'OTP Tester';
  let verificationCode = '';

  beforeAll(async () => {
    await connectDb();
    // Limpiar usuario de prueba previo si existe
    await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
  });

  afterAll(async () => {
    // Limpiar después de las pruebas
    await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
  });

  test('POST /api/auth/register creates a pending user', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: testName,
        correo: testEmail,
        password: testPassword
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      mensaje: expect.any(String),
      requiereVerificacion: true,
      correo: testEmail
    }));

    // Obtener el código generado directamente de la base de datos para la prueba
    const dbRes = await pool.query('SELECT verification_code FROM users WHERE email = $1', [testEmail]);
    expect(dbRes.rows.length).toBe(1);
    verificationCode = dbRes.rows[0].verification_code;
    expect(verificationCode).toHaveLength(6);
  });

  test('POST /api/auth/login blocks pending user', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        correo: testEmail,
        password: testPassword
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({
      error: expect.stringContaining('verificar'),
      requiereVerificacion: true,
      correo: testEmail
    }));
  });

  test('POST /api/auth/verify-code rejects incorrect code', async () => {
    const response = await request(app)
      .post('/api/auth/verify-code')
      .send({
        correo: testEmail,
        codigo: '000000'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('incorrecto');
  });

  test('POST /api/auth/verify-code accepts correct code and activates user', async () => {
    // Obtener el código actual generado (puede haber cambiado debido a la prueba de login anterior)
    const dbRes = await pool.query('SELECT verification_code FROM users WHERE email = $1', [testEmail]);
    const currentCode = dbRes.rows[0].verification_code;

    const response = await request(app)
      .post('/api/auth/verify-code')
      .send({
        correo: testEmail,
        codigo: currentCode
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      mensaje: expect.stringContaining('éxito'),
      usuario: expect.objectContaining({
        correo: testEmail,
        plan: 'free',
        role: 'user'
      }),
      token: expect.any(String)
    }));

    // Verificar en BD que está activo
    const dbRes2 = await pool.query('SELECT user_status, verification_code FROM users WHERE email = $1', [testEmail]);
    expect(dbRes2.rows[0].user_status).toBe('active');
    expect(dbRes2.rows[0].verification_code).toBeNull();
  });

  test('POST /api/auth/login allows active user to log in', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        correo: testEmail,
        password: testPassword
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      mensaje: 'Login exitoso',
      usuario: expect.objectContaining({
        correo: testEmail
      }),
      token: expect.any(String)
    }));
  });
});
