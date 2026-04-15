const express = require('express');
const path = require('path');
const translationRoutes = require('./routes/translationRoutes');
const memoryRoutes = require('./routes/memoryRoutes');
const authRoutes = require('./routes/authRoutes'); // <-- Aquí importamos la nueva ruta de registro
const adminRoutes = require('./routes/adminRoutes'); // <-- Aquí importamos la nueva ruta de administración
const uploadRoutes = require('./routes/uploadRoutes'); // <-- Aquí importamos la nueva ruta de subida de archivos
const adminChatRoutes = require('./routes/adminChatRoutes'); // <-- Aquí importamos la nueva ruta de chat especial para admin
const userChatRoutes = require('./routes/userChatRoutes'); // <-- Aquí importamos la nueva ruta de chat para usuarios normales
const userProfileRoutes = require('./routes/userProfileRoutes'); // <-- Aquí importamos la nueva ruta de perfil de usuario

const {
  APP_NAME,
  SYSTEM_ICON_PATH,
  BRAND_COLORS,
  HYPERAUTOMATION_FLOW,
  ASSISTANT_TAGLINE
} = require('./config/appInfo');
const { isDbReady } = require('./config/db');
const TranslationHistory = require('./models/TranslationHistory');
const ClientQuota = require('./models/ClientQuota'); 
const User = require('./models/User');

const app = express();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '25mb';

app.use(express.json({ limit: requestBodyLimit }));
// Ajustamos la ruta pública porque ahora app.js está dentro de src/
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    system: APP_NAME,
    systemIconPath: SYSTEM_ICON_PATH,
    assistantTagline: ASSISTANT_TAGLINE,
    branding: { colors: BRAND_COLORS },
    learning: { adminContributes: true, automaticReuse: true }
  });
});

app.get('/api/assistant/status', async (req, res, next) => {
  try {
    let totalTranslations = 0;
    let successfulTranslations = 0;
    let remainingDocs = 10; 

    if (isDbReady()) {
      [totalTranslations, successfulTranslations] = await Promise.all([
        TranslationHistory.countDocuments({}),
        TranslationHistory.countDocuments({ status: 'success' })
      ]);

      const clientIp = req.ip || req.connection.remoteAddress;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const quota = await ClientQuota.findOne({ ip: clientIp });
      if (quota && quota.lastUsed >= today) {
        remainingDocs = Math.max(10 - quota.count, 0);
      }
    }

    const learningProgressPercent = totalTranslations > 0
      ? Math.min(Math.round((successfulTranslations / totalTranslations) * 100), 100)
      : 0;

    return res.json({
      status: 'ready',
      system: APP_NAME,
      assistantTagline: ASSISTANT_TAGLINE,
      hyperautomationFlow: HYPERAUTOMATION_FLOW,
      branding: { iconPath: SYSTEM_ICON_PATH, colors: BRAND_COLORS },
      learning: {
        mode: 'progressive', automaticReuse: true, adminContributes: true,
        autonomousWhenAdminOffline: true, totalTranslations, successfulTranslations, learningProgressPercent
      },
      serviceCommitment: {
        maxEstimatedTurnaround: 'menos de 1 día',
        dailyLimits: `¡Hola! Soy Tamon. Te quedan ${remainingDocs} de 10 documentos gratuitos por hoy.`,
        remainingDocs: remainingDocs 
      }
    });
  } catch (error) {
    //return console.log(error);//Error : return next(error);
    return next=error;
  }
});

// --- AQUÍ CONECTAMOS TODAS LAS RUTAS ---
app.use('/api', translationRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/auth', authRoutes); // <-- Aquí activamos las rutas de registro y login
app.use('/api/admin', adminChatRoutes); // <-- Aquí activamos las rutas de administración
app.use('/api/upload', uploadRoutes); // <-- Aquí activamos las rutas de subida de archivos
app.use('/api/user', userChatRoutes); // <-- Aquí activamos las rutas de chat para usuarios normales
app.use('/api/user/profile', userProfileRoutes); // <-- Aquí activamos la ruta de perfil de usuario

// Crear automáticamente el admin principal si no existe
(async () => {
  try {
    const adminCorreo = 'tatsu@admin.com';
    const adminNombre = 'Tatsu';
    const adminPassword = '$2b$10$Nn802A3zkKrAsgCcdgWeMuNnw6LfpInPTmFuMPQykhm3uyCubgMeO'; // Zhenya_26
    const existe = await User.findOne({ correo: adminCorreo });
    if (!existe) {
      await User.create({
        nombre: adminNombre,
        correo: adminCorreo,
        password: adminPassword,
        plan: 'pro_plus',
        role: 'admin',
        fechaRegistro: new Date()
      });
      console.log('Admin principal creado automáticamente.');
    }
  } catch (e) {
    console.error('Error creando admin principal:', e);
  }
})();

app.use((error, req, res, next) => {
  void req;
  void next;
  const status = error.status || 500;
  res.status(status).json({ error: error.message || 'Error interno del servidor.' });
});

module.exports = app;
