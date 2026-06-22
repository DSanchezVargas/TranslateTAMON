require('dotenv').config();

const app = require('./app');
const { connectDb, connectMongo } = require('./config/db');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    console.info(`[STARTUP] Iniciando arranque de TranslateTAMON Backend en puerto ${PORT}...`);
    await connectDb();
    if (process.env.NODE_ENV !== 'test') {
      await connectMongo();
    }
    console.info('[STARTUP] Conexiones de DB inicializadas. Levantando servidor Express...');
    app.listen(PORT, () => {
      console.info(`¡Servidor listo e iniciado en http://localhost:${PORT}!`);
    });
  } catch (error) {
    console.error('[STARTUP ERROR] No se pudo iniciar la aplicación:', error.message);
    process.exit(1);
  }
}

start();
