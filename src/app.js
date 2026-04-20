const express = require('express');
const path = require('path');
const translationRoutes = require('./routes/translationRoutes');
const memoryRoutes = require('./routes/memoryRoutes');
const authRoutes = require('./routes/authRoutes'); 
const adminRoutes = require('./routes/adminRoutes'); 
const uploadRoutes = require('./routes/uploadRoutes'); 
const adminChatRoutes = require('./routes/adminChatRoutes'); 
const userChatRoutes = require('./routes/userChatRoutes'); 
const userProfileRoutes = require('./routes/userProfileRoutes'); 

const {
  APP_NAME,
  SYSTEM_ICON_PATH,
  BRAND_COLORS,
  HYPERAUTOMATION_FLOW,
  ASSISTANT_TAGLINE
} = require('./config/appInfo');

const { isDbReady, pool } = require('./config/db'); // <-- Importamos isDbReady y el pool de Postgres

const app = express();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '25mb';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
      try {
        // Consultamos cuotas en Postgres
        const clientIp = req.ip || req.connection.remoteAddress;
        const quotaResult = await pool.query('SELECT count, last_used FROM client_quotas WHERE ip = $1', [clientIp]);
        const quota = quotaResult.rows[0];

        const today = new Date();
        if (quota) {
            const lastUsed = new Date(quota.last_used);
            // Si es del mismo día, calculamos lo que queda
            if (lastUsed.toDateString() === today.toDateString()) {
                remainingDocs = Math.max(10 - quota.count, 0);
            }
        }
        
        // (Nota: Cuando crees la tabla translation_history en Postgres, puedes habilitar esta consulta)
        /*
        const thResult = await pool.query("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful FROM translation_history");
        totalTranslations = parseInt(thResult.rows[0]?.total || 0);
        successfulTranslations = parseInt(thResult.rows[0]?.successful || 0);
        */
      } catch (e) {
        console.warn("Aviso en /status (posiblemente falten tablas):", e.message);
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
    return next(error);
  }
});

// --- INYECTAR USUARIO (ADMIN/PRO/GRATIS) PARA PRUEBAS ---
const userInject = require('./middleware/userInject');
app.use(userInject);
// --- AQUÍ CONECTAMOS TODAS LAS RUTAS ---
app.use('/api', translationRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/auth', authRoutes); 
app.use('/api/admin', adminChatRoutes); 
app.use('/api/upload', uploadRoutes); 
app.use('/api/user', userChatRoutes); 
app.use('/api/user/profile', userProfileRoutes); 

// Crear automáticamente el admin principal en Postgres si no existe
(async () => {
  try {
    const adminCorreo = 'tatsu@admin.com';
    const adminNombre = 'Tatsu';
    const adminPassword = '$2b$10$Nn802A3zkKrAsgCcdgWeMuNnw6LfpInPTmFuMPQykhm3uyCubgMeO'; // Zhenya_26
    
    // Verificamos si Tatsu ya existe en Postgres (usamos "email" que es la columna en SQL)
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [adminCorreo]);
    
    if (result.rows.length === 0) {
      await pool.query(
        `INSERT INTO users (nombre, email, password, plan, role) VALUES ($1, $2, $3, $4, $5)`,
        [adminNombre, adminCorreo, adminPassword, 'pro_plus', 'admin']
      );
      console.log('Admin principal (Tatsu) creado automáticamente en PostgreSQL.');
    }
  } catch (e) {
    console.error('Error creando admin principal (¿Ejecutaste el ALTER TABLE en pgAdmin?):', e.message);
  }
})();

app.use((error, req, res, next) => {
  console.error("🚨 ERROR SILENCIOSO ATRAPADO EN LA RUTA:", req.originalUrl);
  console.error("Detalle del problema:", error);
  const status = error.status || 500;
  res.status(status).json({ error: error.message || 'Error interno del servidor.' });
});

module.exports = app;