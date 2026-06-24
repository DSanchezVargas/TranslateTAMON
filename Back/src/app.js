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
const planRoutes = require('./routes/planRoutes');

const {
  APP_NAME,
  SYSTEM_ICON_PATH,
  BRAND_COLORS,
  HYPERAUTOMATION_FLOW,
  ASSISTANT_TAGLINE
} = require('./config/appInfo');

const { isDbReady, pool } = require('./config/db'); // <-- Importamos isDbReady y el pool de Postgres

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tamon-Trace-Id');
  res.setHeader('Access-Control-Expose-Headers', 'X-Tamon-Trace-Id, X-Tamon-Status, X-Tamon-Processing-Ms, X-Tamon-Assistant-Message');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '25mb';

app.use(express.json({ limit: requestBodyLimit }));

const fs = require('fs');
let publicPath = path.join(__dirname, '..', 'public');
if (!fs.existsSync(path.join(publicPath, 'index.html'))) {
  const siblingPublicPath = path.join(__dirname, '..', '..', 'Front', 'public');
  if (fs.existsSync(path.join(siblingPublicPath, 'index.html'))) {
    publicPath = siblingPublicPath;
  }
}
app.use(express.static(publicPath));

// Endpoint de warmup - solo para despertar el servidor Render del cold start
// El frontend usa /api/assistant/status para el ping real
app.get('/api/ping', (_, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/api/warmup', (_, res) => res.json({ ok: true, ts: Date.now() }));

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

app.get('/api/test-db', async (_, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'success',
      message: 'PostgreSQL connection is working!',
      time: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'PostgreSQL connection failed!',
      error: err.message,
      stack: err.stack
    });
  }
});

app.get('/api/test-python', async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.post('http://localhost:5002/convertir-texto-pdf', {
      texto: 'test',
      titulo: 'Test'
    }, { responseType: 'arraybuffer', timeout: 5000 });
    res.json({ status: 'online', bytes: response.data.length });
  } catch (err) {
    res.status(500).json({ status: 'offline', error: err.message, stack: err.stack });
  }
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
app.use('/api/plans', planRoutes);
app.use('/api/admin', adminRoutes); 
app.use('/api/admin', adminChatRoutes); 
app.use('/api/upload', uploadRoutes); 
app.use('/api/user', userChatRoutes); 
app.use('/api/user/profile', userProfileRoutes); 

// Cargar y sincronizar usuarios reales desde real_users.json si existe
(async () => {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') {
    return;
  }
  try {
    const fs = require('fs');
    const bcrypt = require('bcrypt');
    const { normalizePlan } = require('./utils/planCatalog');

    const realUsersPath = path.join(__dirname, '..', '..', 'real_users.json');
    if (fs.existsSync(realUsersPath)) {
      const data = fs.readFileSync(realUsersPath, 'utf8');
      const usersData = JSON.parse(data);
      
      for (const [key, userConfig] of Object.entries(usersData)) {
        if (!userConfig || !userConfig.email || !userConfig.password) continue;
        
        const email = userConfig.email.trim().toLowerCase();
        const rawPassword = userConfig.password;
        const rawPlan = userConfig.plan || (key === 'admin' ? 'pro_plus' : 'free');
        const plan = normalizePlan(rawPlan);
        const role = (key === 'admin' || userConfig.role === 'admin') ? 'admin' : 'user';
        const nombre = userConfig.nombre || userConfig.name || (key.charAt(0).toUpperCase() + key.slice(1));
        
        // --- SINCRONIZACIÓN CON POSTGRESQL ---
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(rawPassword, salt);
          
          await pool.query(
            `INSERT INTO users (nombre, email, password, plan, role, user_status) VALUES ($1, $2, $3, $4, $5, 'active')`,
            [nombre, email, hashedPassword, plan, role]
          );
          console.info(`Usuario real creado en PostgreSQL: ${nombre} (${email})`);
        } else {
          const existingUser = result.rows[0];
          const isPasswordSame = await bcrypt.compare(rawPassword, existingUser.password);
          const isPlanSame = existingUser.plan === plan;
          const isRoleSame = existingUser.role === role;
          const isNombreSame = existingUser.nombre === nombre;
          
          if (!isPasswordSame || !isPlanSame || !isRoleSame || !isNombreSame) {
            let hashedPassword = existingUser.password;
            if (!isPasswordSame) {
              const salt = await bcrypt.genSalt(10);
              hashedPassword = await bcrypt.hash(rawPassword, salt);
            }
            
            await pool.query(
              `UPDATE users SET nombre = $1, password = $2, plan = $3, role = $4, user_status = 'active' WHERE id = $5`,
              [nombre, hashedPassword, plan, role, existingUser.id]
            );
            console.info(`Usuario real actualizado en PostgreSQL: ${nombre} (${email})`);
          }
        }

        // --- SINCRONIZACIÓN CON MONGODB ---
        try {
          const MongoUser = require('./models/User');
          const mongoUser = await MongoUser.findOne({ correo: email });
          
          if (!mongoUser) {
            // Mongoose pre-save hook will hash the password automatically
            const newMongoUser = new MongoUser({
              nombre,
              correo: email,
              password: rawPassword,
              plan,
              role
            });
            await newMongoUser.save();
            console.info(`Usuario real creado en MongoDB desde real_users.json: ${nombre} (${email})`);
          } else {
            const isPasswordSame = await mongoUser.compararPassword(rawPassword);
            const isPlanSame = mongoUser.plan === plan;
            const isRoleSame = mongoUser.role === role;
            const isNombreSame = mongoUser.nombre === nombre;
            
            if (!isPasswordSame || !isPlanSame || !isRoleSame || !isNombreSame) {
              mongoUser.nombre = nombre;
              mongoUser.plan = plan;
              mongoUser.role = role;
              if (!isPasswordSame) {
                mongoUser.password = rawPassword; // Se volverá a encriptar con pre-save
              }
              await mongoUser.save();
              console.info(`Usuario real sincronizado/actualizado en MongoDB desde real_users.json: ${nombre} (${email})`);
            }
          }
        } catch (mongoErr) {
          console.error(`Error al sincronizar usuario ${email} en MongoDB:`, mongoErr.message);
        }
      }
    } else {
      // Fallback por si no existe el archivo (por ejemplo, en producción si no se sube real_users.json)
      const adminCorreo = 'tatsu@admin.com';
      const adminNombre = 'Tatsu';
      const adminPassword = '$2b$10$Nn802A3zkKrAsgCcdgWeMuNnw6LfpInPTmFuMPQykhm3uyCubgMeO'; // Zhenya_26
      
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [adminCorreo]);
      if (result.rows.length === 0) {
        await pool.query(
          `INSERT INTO users (nombre, email, password, plan, role) VALUES ($1, $2, $3, $4, $5)`,
          [adminNombre, adminCorreo, adminPassword, 'pro_plus', 'admin']
        );
        console.info('Admin principal (Tatsu) creado automáticamente en PostgreSQL (fallback).');
      }
    }
  } catch (e) {
    console.error('Error procesando real_users.json para sincronizar usuarios:', e.message);
  }
})();

app.use((error, req, res, _next) => {
  console.error("🚨 ERROR SILENCIOSO ATRAPADO EN LA RUTA:", req.originalUrl);
  console.error("Detalle del problema:", error);
  const status = error.status || 500;
  res.status(status).json({ error: error.message || 'Error interno del servidor.' });
});

module.exports = app;