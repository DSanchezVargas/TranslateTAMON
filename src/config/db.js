const mongoose = require('mongoose');

async function connectDb() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn('MONGO_URI no configurado. La aplicación correrá sin persistencia.');
    return false;
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000
    });
    console.info('MongoDB conectado.');
    return true;
  } catch (error) {
    console.warn(`No se pudo conectar a MongoDB. La app correrá sin persistencia: ${error.message}`);
    return false;
  }
}

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectDb,
  isDbReady
};
