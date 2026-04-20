const { Pool } = require('pg');

// Configuramos la conexión a tu pgAdmin local
// Usamos process.env por si luego lo subes a un servidor, pero dejamos tus datos locales por defecto.
const pool = new Pool({
  user: process.env.PG_USER || 'postgres',   // Por defecto al instalar Postgres el usuario es 'postgres'
  host: process.env.PG_HOST || 'localhost',
  database: process.env.PG_DATABASE || 'tamon_db', // Tu base de datos de Tamon
  password: process.env.PG_PASSWORD || 'Alastor',  // Tu contraseña
  port: process.env.PG_PORT || 5432,         // El puerto por defecto de PostgreSQL
});

let isConnected = false;

async function connectDb() {
  try {
    // Intentamos conectar y hacer una consulta rápida para verificar
    const client = await pool.connect();
    console.info('¡PostgreSQL conectado a tamon_db con éxito!');
    
    // Liberamos el cliente para que el pool lo siga usando
    client.release(); 
    isConnected = true;
    return true;
  } catch (error) {
    console.warn(`No se pudo conectar a PostgreSQL. Verifica que pgAdmin esté corriendo: ${error.message}`);
    isConnected = false;
    return false;
  }
}

function isDbReady() {
  return isConnected;
}

// Exportamos el pool también, porque lo necesitarás en tus rutas para hacer las consultas SQL
module.exports = {
  connectDb,
  isDbReady,
  pool 
};