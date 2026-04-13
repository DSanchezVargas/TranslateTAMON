const mongoose = require('mongoose');

async function connectDb() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn('MONGO_URI no configurado. La aplicación correrá sin persistencia.');
    return;
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000
  });
  console.info('MongoDB conectado.');
}

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectDb,
  isDbReady
};
