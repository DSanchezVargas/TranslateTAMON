require('dotenv').config();

const app = require('./app');
const { connectDb, connectMongo } = require('./config/db');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await connectDb();
    if (process.env.NODE_ENV !== 'test') {
      await connectMongo();
    }
    app.listen(PORT, () => {
      console.info(`Servidor iniciado en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('No se pudo iniciar la aplicación:', error.message);
    process.exit(1);
  }
}

start();
