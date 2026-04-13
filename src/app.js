const express = require('express');
const path = require('path');
const translationRoutes = require('./routes/translationRoutes');
const memoryRoutes = require('./routes/memoryRoutes');
const {
  APP_NAME,
  SYSTEM_ICON_PATH,
  BRAND_COLORS,
  HYPERAUTOMATION_FLOW,
  ASSISTANT_TAGLINE
} = require('./config/appInfo');

const app = express();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '25mb';

app.use(express.json({ limit: requestBodyLimit }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    system: APP_NAME,
    systemIconPath: SYSTEM_ICON_PATH,
    assistantTagline: ASSISTANT_TAGLINE,
    branding: {
      colors: BRAND_COLORS
    },
    learning: {
      adminContributes: true,
      automaticReuse: true
    }
  });
});

app.get('/api/assistant/status', (_, res) => {
  res.json({
    status: 'ready',
    system: APP_NAME,
    assistantTagline: ASSISTANT_TAGLINE,
    hyperautomationFlow: HYPERAUTOMATION_FLOW,
    branding: {
      iconPath: SYSTEM_ICON_PATH,
      colors: BRAND_COLORS
    },
    learning: {
      mode: 'progressive',
      automaticReuse: true,
      adminContributes: true
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
