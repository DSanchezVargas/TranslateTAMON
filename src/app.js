const express = require('express');
const translationRoutes = require('./routes/translationRoutes');
const memoryRoutes = require('./routes/memoryRoutes');
const { APP_NAME } = require('./config/appInfo');

const app = express();

app.use(express.json({ limit: '2mb' }));

app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    system: APP_NAME,
    learning: {
      adminContributes: true,
      automaticReuse: true
    }
  });
});

app.use('/api', translationRoutes);
app.use('/api/memory', memoryRoutes);

app.use((error, req, res, next) => {
  void req;
  void next;
  const status = error.status || 500;
  res.status(status).json({ error: error.message || 'Error interno del servidor.' });
});

module.exports = app;
