const { Pool } = require('pg');

// Forzar a Node.js a aceptar certificados auto-firmados en las cadenas de conexión SSL (Supabase / Render)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let connectionString = process.env.DATABASE_URL;
if (connectionString) {
  // Limpiamos sslmode de la URL para que no sobrescriba la opción ssl de pg
  connectionString = connectionString.replace(/[?&]sslmode=[^&]+/g, '');
}

const pool = new Pool(
  connectionString 
    ? {
        connectionString: connectionString,
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
    console.info('Intentando conectar a PostgreSQL...');
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
        plan VARCHAR(20) DEFAULT 'free',
        role VARCHAR(20) DEFAULT 'user',
        mensajes_hoy INTEGER DEFAULT 0,
        ultima_fecha_chat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        username VARCHAR(100) UNIQUE,
        avatar_url TEXT,
        user_status VARCHAR(20) DEFAULT 'active'
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS user_status VARCHAR(20) DEFAULT 'active';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100) UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS chibis_count INTEGER DEFAULT 0;
      ALTER TABLE translation_history ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE translation_history ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT DEFAULT 0;

      CREATE TABLE IF NOT EXISTS translation_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        original_file_name VARCHAR(255),
        file_type VARCHAR(50),
        source_language VARCHAR(20),
        target_language VARCHAR(20),
        project VARCHAR(120),
        domain VARCHAR(120),
        source_text_hash VARCHAR(255),
        translated_text_cache TEXT,
        source_text_length INTEGER,
        translated_text_length INTEGER,
        status VARCHAR(50),
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        file_size_bytes BIGINT DEFAULT 0
      );
       
      CREATE TABLE IF NOT EXISTS tamon_feedback (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        bot_message TEXT,
        user_comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS glossary_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        project VARCHAR(120),
        source_language VARCHAR(20),
        target_language VARCHAR(20),
        source_term VARCHAR(255) NOT NULL,
        target_term VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS project VARCHAR(120);
      ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS source_language VARCHAR(20);
      ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS target_language VARCHAR(20);
      ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
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

const mongoose = require('mongoose');
async function connectMongo() {
  const mongoUri = process.env.MONGO_URI || 'mongodb+srv://Tatsu:Alastor_24@translatetamon.qj7mfik.mongodb.net/';
  try {
    console.info('Intentando conectar a MongoDB...');
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000
    });
    console.info('¡MongoDB conectado con éxito!');
    return true;
  } catch (e) {
    console.error('Error al conectar a MongoDB:', e.message);
    return false;
  }
}

module.exports = {
  connectDb,
  isDbReady,
  connectMongo,
  pool 
};