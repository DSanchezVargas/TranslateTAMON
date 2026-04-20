const { Pool } = require('pg');

// MAGIA DE CONEXIÓN: 
// Si existe process.env.DATABASE_URL (Render), usa esa conexión en la nube con SSL obligatorio.
// Si no existe, usa tus credenciales locales (localhost) para cuando programas en tu laptop.
const pool = new Pool(
  process.env.DATABASE_URL 
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Indispensable para que Render no rechaze la conexión
      }
    : {
        user: process.env.PG_USER || 'postgres',
        host: process.env.PG_HOST || 'localhost',
        database: process.env.PG_DATABASE || 'tamon_db',
        password: process.env.PG_PASSWORD || 'Alastor',
        port: process.env.PG_PORT || 5432,
      }
);

let isConnected = false;

async function connectDb() {
  try {
    const client = await pool.connect();
    console.info('¡PostgreSQL conectado con éxito!');
    
    // --- MAGIA: AUTO-CREAR TABLAS PRINCIPALES EN RENDER ---
    // Así no tendrás que entrar a ninguna consola a crear columnas nunca más.
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100),
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        plan VARCHAR(20) DEFAULT 'chill',
        role VARCHAR(20) DEFAULT 'user',
        mensajes_hoy INTEGER DEFAULT 0,
        ultima_fecha_chat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        username VARCHAR(100) UNIQUE
      );
      
      CREATE TABLE IF NOT EXISTS tamon_feedback (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        bot_message TEXT,
        user_comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    client.release(); 
    isConnected = true;
    return true;
  } catch (error) {
    console.warn(`No se pudo conectar a PostgreSQL: ${error.message}`);
    isConnected = false;
    return false;
  }
}

function isDbReady() {
  return isConnected;
}

module.exports = {
  connectDb,
  isDbReady,
  pool 
};