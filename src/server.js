require('dotenv').config();

const app = require('./app');
const { connectDb } = require('./config/db');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await connectDb();
    app.listen(PORT, () => {
      console.info(`Servidor iniciado en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('No se pudo iniciar la aplicación:', error.message);
    process.exit(1);
  }
}

start();
