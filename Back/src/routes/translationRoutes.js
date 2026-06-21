const express = require('express');
const router = express.Router();
const fs = require('fs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

function resolveUserId(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      return Number(decoded.id);
    } catch (e) {
      // Ignorar error de verificación de token
    }
  }
  return Number(req.user?.id || req.user?._id || null);
}
// --- ENDPOINT DE FEEDBACK DE USUARIO ---
router.post('/feedback', async (req, res) => {
  const { userId, comentario, tipo, traceId } = req.body;
  if (!comentario || !tipo) return res.status(400).json({ error: 'Faltan datos.' });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS user_feedback (
      id SERIAL PRIMARY KEY, user_id INTEGER, comentario TEXT, tipo VARCHAR(50), trace_id VARCHAR(80), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query('INSERT INTO user_feedback (user_id, comentario, tipo, trace_id) VALUES ($1, $2, $3, $4)', [userId || null, comentario, tipo, traceId || null]);
    res.status(201).json({ mensaje: 'Feedback recibido. ¡Gracias!' });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo registrar el feedback.' });
  }
});

const { requireAdmin } = require('../middleware/auth');
// --- ENDPOINT DE MÉTRICAS DE USO Y ERRORES (solo admin) ---
router.get('/metrics', requireAdmin, async (req, res) => {
  try {
    const [[{ total_traducciones }], [{ total_errores }], [{ total_feedback }]] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total_traducciones FROM translation_history WHERE status = $1', ['success']).then(r => r.rows),
      pool.query('SELECT COUNT(*) AS total_errores FROM translation_history WHERE status = $1', ['failed']).then(r => r.rows),
      pool.query('SELECT COUNT(*) AS total_feedback FROM user_feedback').then(r => r.rows)
    ]);
    res.json({ total_traducciones, total_errores, total_feedback });
  } catch (e) {
    res.status(500).json({ error: 'No se pudieron obtener métricas.' });
  }
});
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { extractTextByFile } = require('../services/textExtractor');
const { translateText, translateTextWithProgress } = require('../services/translator');
const { createTranslatedDocxBuffer } = require('../services/docxGenerator');
const {
  getMemoryContext,
  applyRules,
  applyGlossaryPlaceholders,
  restoreGlossaryPlaceholders,
  applyCorrections
} = require('../services/memoryService');

// 1. ADIÓS MONGOOSE, HOLA POSTGRES:
const { pool, isDbReady } = require('../config/db'); 
const { sanitizeString, isInvalidTranslatedText } = require('../utils/validation');
const { ASSISTANT_TAGLINE } = require('../config/appInfo');

const uploadLimitMb = 5120; // 5 GB máximo global en el parser para permitir la subida de Pro+
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimitMb * 1024 * 1024 }
});

const previewStore = new Map();
const translationJobs = new Map(); 
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_ESTIMATED_SECONDS = 23 * 60 * 60;
const ASSISTANT_TEXT_PREVIEW_LIMIT = 220;

async function saveUserLearningSuggestions(preview, finalText) { return; }

// --- NUEVO: GUARDAR HISTORIAL EN POSTGRESQL ---
async function saveHistory(record) {
  if (!isDbReady()) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS translation_history (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, original_file_name VARCHAR(255), file_type VARCHAR(50),
        source_language VARCHAR(20), target_language VARCHAR(20), project VARCHAR(120),
        domain VARCHAR(120), source_text_hash VARCHAR(255), translated_text_cache TEXT,
        source_text_length INTEGER, translated_text_length INTEGER, status VARCHAR(50),
        error_message TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        file_size_bytes BIGINT DEFAULT 0
      )
    `);

    await pool.query('ALTER TABLE translation_history ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
    await pool.query('ALTER TABLE translation_history ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT DEFAULT 0');
    
    await pool.query(`
      INSERT INTO translation_history 
      (user_id, original_file_name, file_type, source_language, target_language, project, domain, source_text_hash, translated_text_cache, source_text_length, translated_text_length, status, error_message, file_size_bytes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      record.userId || null,
      record.originalFileName || 'unknown', record.fileType || 'unknown', record.sourceLanguage || 'unknown',
      record.targetLanguage || 'unknown', record.project || 'default', record.domain || 'general',
      record.sourceTextHash || '', record.translatedTextCache || '', record.sourceTextLength || 0,
      record.translatedTextLength || 0, record.status || 'unknown', record.errorMessage || '',
      record.fileSizeBytes || 0
    ]);
  } catch (e) { console.error("Error guardando historial en Postgres:", e); }
}

function clearExpiredPreviews() {
  const now = Date.now();
  previewStore.forEach((preview, id) => { if (preview.expiresAt <= now) previewStore.delete(id); });
}
setInterval(clearExpiredPreviews, 5 * 60 * 1000).unref();

function clearExpiredJobs() {
  const now = Date.now();
  translationJobs.forEach((job, id) => { if (job.expiresAt <= now) translationJobs.delete(id); });
}
setInterval(clearExpiredJobs, 10 * 60 * 1000).unref();

function computeSourceHash(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function buildAssistantMessage(status) { return `${ASSISTANT_TAGLINE} · status: ${status}`; }

function setExperienceHeaders(res, { traceId, status, processingMs }) {
  res.setHeader('X-Tamon-Trace-Id', traceId);
  res.setHeader('X-Tamon-Status', status);
  res.setHeader('X-Tamon-Processing-Ms', String(processingMs));
  res.setHeader('X-Tamon-Assistant-Message', buildAssistantMessage(status));
}

function estimateTranslationSecondsByText(text = '') {
  const estimated = Math.ceil(text.length / 900);
  return Math.min(Math.max(estimated, 10), MAX_ESTIMATED_SECONDS);
}

// --- NUEVO: BUSCAR CACHÉ EN POSTGRESQL ---
async function findCachedTranslation({ sourceHash, sourceLanguage, targetLanguage, project, domain }) {
  if (!isDbReady()) return null;
  try {
    const res = await pool.query(`
      SELECT translated_text_cache FROM translation_history 
      WHERE source_text_hash = $1 AND source_language = $2 AND target_language = $3 AND project = $4 AND domain = $5 
        AND status = 'success' AND translated_text_cache IS NOT NULL AND translated_text_cache != ''
      ORDER BY created_at DESC LIMIT 1
    `, [sourceHash, sourceLanguage, targetLanguage, project, domain]);
    
    if (res.rows.length === 0) return null;
    const cachedText = res.rows[0].translated_text_cache;
    if (isInvalidTranslatedText(cachedText)) return null;
    
    return { translatedTextCache: cachedText };
  } catch (e) { return null; }
}

function createJob({ originalFileName, sourceLanguage, targetLanguage, project, domain }) {
  const id = crypto.randomUUID(); const now = Date.now();
  const job = { id, status: 'queued', progressPercent: 0, etaSeconds: null, message: 'Trabajo en cola.', error: null, startedAt: now, updatedAt: now, expiresAt: now + JOB_TTL_MS, originalFileName, sourceLanguage, targetLanguage, project, domain, previewId: null, translatedTextPartial: '', history: [{ at: now, progressPercent: 0, message: 'Trabajo creado.' }] };
  translationJobs.set(id, job); return job;
}
function touchJob(job) { job.updatedAt = Date.now(); job.expiresAt = Date.now() + JOB_TTL_MS; }
function addJobHistory(job, message) {
  job.history.push({ at: Date.now(), progressPercent: job.progressPercent, message });
  if (job.history.length > 30) job.history = job.history.slice(job.history.length - 30);
  touchJob(job);
}
function estimateEtaSeconds(startedAt, processedChunks, totalChunks) {
  if (!processedChunks || !totalChunks || processedChunks >= totalChunks) return 0;
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const avgPerChunk = elapsedSeconds / processedChunks;
  return Math.min(Math.max(Math.ceil((totalChunks - processedChunks) * avgPerChunk), 0), 86399);
}

async function runPreviewJob(job, { file, sourceLanguage, targetLanguage, project, domain }) {
  job.status = 'processing'; job.message = 'Extrayendo texto...'; job.progressPercent = 5; addJobHistory(job, 'Extraccion iniciada.');
  try {
    const chunkWarnings = []; const originalText = await extractTextByFile(file, sourceLanguage); const sourceTextHash = computeSourceHash(originalText);
    job.message = 'Buscando traduccion en memoria...'; job.progressPercent = 12; touchJob(job);

    const cached = await findCachedTranslation({ sourceHash: sourceTextHash, sourceLanguage, targetLanguage, project, domain });
    if (cached?.translatedTextCache) {
      const previewId = crypto.randomUUID(); clearExpiredPreviews();
      previewStore.set(previewId, { originalFileName: file.originalname, sourceLanguage, targetLanguage, project, domain, originalText, sourceTextHash, translatedText: cached.translatedTextCache, expiresAt: Date.now() + PREVIEW_TTL_MS });
      job.status = 'completed'; job.progressPercent = 100; job.etaSeconds = 0; job.message = 'Completado desde cache.'; job.previewId = previewId; job.translatedTextPartial = cached.translatedTextCache;
      addJobHistory(job, 'Resultado desde cache.');
      await saveHistory({ originalFileName: file.originalname, fileType: path.extname(file.originalname).replace('.', ''), sourceLanguage, targetLanguage, project, domain, sourceTextHash, translatedTextCache: cached.translatedTextCache, sourceTextLength: originalText.length, translatedTextLength: cached.translatedTextCache.length, status: 'success' });
      return;
    }

    job.message = 'Traduciendo...'; job.progressPercent = 20; addJobHistory(job, 'Traduccion iniciada.');
    const memory = await getMemoryContext({ project, domain, sourceLanguage, targetLanguage });
    const preRuledText = applyRules(originalText, memory.preRules);
    const { text: textWithPlaceholders, placeholders } = applyGlossaryPlaceholders(preRuledText, memory.glossary);

    const translatedRaw = await translateTextWithProgress(textWithPlaceholders, sourceLanguage, targetLanguage, {
      onProgress: ({ processedChunks, totalChunks, translatedSoFar }) => {
        job.progressPercent = 20 + Math.round((processedChunks / totalChunks) * 70);
        job.etaSeconds = estimateEtaSeconds(job.startedAt, processedChunks, totalChunks);
        job.message = `Traduciendo bloque ${processedChunks} de ${totalChunks}...`; job.translatedTextPartial = translatedSoFar; touchJob(job);
      },
      fallbackToOriginalOnError: true,
      onChunkError: ({ chunkIndex, totalChunks }) => { chunkWarnings.push({ chunkIndex, totalChunks }); }
    });

    let translatedText = applyCorrections(applyRules(restoreGlossaryPlaceholders(translatedRaw, placeholders), memory.postRules), memory.corrections);
    if (isInvalidTranslatedText(translatedText)) throw new Error('Contenido invalido devuelto.');

    const previewId = crypto.randomUUID(); clearExpiredPreviews();
    previewStore.set(previewId, { originalFileName: file.originalname, sourceLanguage, targetLanguage, project, domain, originalText, sourceTextHash, translatedText, expiresAt: Date.now() + PREVIEW_TTL_MS });

    await saveHistory({ originalFileName: file.originalname, fileType: path.extname(file.originalname).replace('.', ''), sourceLanguage, targetLanguage, project, domain, sourceTextHash, translatedTextCache: translatedText, sourceTextLength: originalText.length, translatedTextLength: translatedText.length, status: 'success' });

    job.status = 'completed'; job.progressPercent = 100; job.etaSeconds = 0; job.message = 'Vista previa lista.'; job.previewId = previewId; job.translatedTextPartial = translatedText;
    addJobHistory(job, 'Traduccion finalizada.');
  } catch (error) {
    job.status = 'failed'; job.progressPercent = 100; job.message = 'Error.'; job.error = error.message; addJobHistory(job, `Error: ${error.message}`);
    await saveHistory({ originalFileName: file?.originalname, status: 'failed', errorMessage: error.message });
  }
}

const { extractDocxRunsWithIndices } = require('../services/docxRunsExtractor');
async function createPreviewFromFile({ file, sourceLanguage, targetLanguage, project, domain, userId }) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.docx') {
    // Extraer runs con índices
    const tmpPath = file.path || file.buffer && (() => {
      const tmp = path.join(__dirname, '../../uploads', `${Date.now()}-${file.originalname}`);
      fs.writeFileSync(tmp, file.buffer);
      file.path = tmp;
      return tmp;
    })();
    const runs = extractDocxRunsWithIndices(tmpPath || file.path);
    return { docxRuns: runs, sourceTextHash: computeSourceHash(JSON.stringify(runs)), fromCache: false };
  } else {
    const originalText = await extractTextByFile(file, sourceLanguage);
    const sourceTextHash = computeSourceHash(originalText);
    const cached = await findCachedTranslation({ sourceHash: sourceTextHash, sourceLanguage, targetLanguage, project, domain });
    if (cached?.translatedTextCache) return { originalText, translatedText: cached.translatedTextCache, sourceTextHash, fromCache: true };

    const memory = await getMemoryContext({ userId, project, domain, sourceLanguage, targetLanguage });
    const preRuledText = applyRules(originalText, memory.preRules);
    const { text: textWithPlaceholders, placeholders } = applyGlossaryPlaceholders(preRuledText, memory.glossary);
    let translatedText = await translateText(textWithPlaceholders, sourceLanguage, targetLanguage);
    translatedText = applyCorrections(applyRules(restoreGlossaryPlaceholders(translatedText, placeholders), memory.postRules), memory.corrections);
    
    if (isInvalidTranslatedText(translatedText)) throw new Error('Texto invalido.');
    return { originalText, translatedText, sourceTextHash, fromCache: false };
  }
}

async function processTranslationRequest(req, res, next, shouldReturnPreview = false) {

  const startedAt = Date.now();
  const traceId = crypto.randomUUID();

  // --- NUEVA LÓGICA DE CUOTA POR TIPO Y VENTANA DE TIEMPO ---
  let isPro = false;
  let isAdmin = false;
  let userId = null;

  if (isDbReady()) {
    try {
      userId = resolveUserId(req);
      let dbUser = null;

      if (userId && Number.isInteger(userId)) {
        const userRes = await pool.query('SELECT id, plan, role, COALESCE(chibis_count, 0) AS chibis_count FROM users WHERE id = $1', [userId]);
        dbUser = userRes.rows[0];
      }

      if (dbUser) {
        if (dbUser.role === 'admin') {
          isAdmin = true;
        } else {
          isPro = dbUser.plan === 'pro_plus' || dbUser.plan === 'pro';
          const chibisCount = Number(dbUser.chibis_count || 0);
          const baseQuota = isPro ? 50 : 15;
          const limit = baseQuota + chibisCount * 10;

          // Obtener las traducciones en cooldown (activas)
          const activeCooldownsRes = await pool.query(
            `SELECT *, 
               (created_at + (LEAST(1 + (COALESCE(file_size_bytes, 0) / 1048576.0 * 0.5), 24) * INTERVAL '1 hour')) AS expires_at,
               EXTRACT(EPOCH FROM ((created_at + (LEAST(1 + (COALESCE(file_size_bytes, 0) / 1048576.0 * 0.5), 24) * INTERVAL '1 hour')) - NOW()))::INT AS remaining_seconds
             FROM translation_history
             WHERE user_id = $1 AND status = 'success'
               AND (created_at + (LEAST(1 + (COALESCE(file_size_bytes, 0) / 1048576.0 * 0.5), 24) * INTERVAL '1 hour')) > NOW()
             ORDER BY expires_at ASC`,
            [userId]
          );
          
          const activeTranslations = activeCooldownsRes.rows;
          const usedQuota = activeTranslations.length;

          if (usedQuota >= limit) {
            const earliestExpiry = activeTranslations[0];
            const sec = earliestExpiry.remaining_seconds || 0;
            const hours = Math.floor(sec / 3600);
            const minutes = Math.max(Math.ceil((sec % 3600) / 60), 1);
            
            let resetMsg = `${minutes} minutos`;
            if (hours > 0) {
              resetMsg = `${hours} horas y ${minutes} minutos`;
            }

            return res.status(403).json({
              error: `⏳ Utilizaste tus cuotas que se restablecen en ${resetMsg}. Espera o usa un plan Chibi/actualiza a Pro+.`,
              proPlus: true,
              limitReached: true,
              cooldownRemainingSeconds: sec
            });
          }
        }
      } else {
        // Invitado / Anónimo (basado en IP)
        const clientIp = req.ip || req.connection.remoteAddress;
        const ext = req.file ? path.extname(req.file.originalname).toLowerCase() : '';
        let tipo = 'text';
        let limite = 10, ventanaMs = 30 * 60 * 1000; // texto: 10 por media hora
        if (ext === '.pdf') { tipo = 'pdf'; limite = 15; ventanaMs = 60 * 60 * 1000; } // 15 por hora
        else if (ext === '.docx') { tipo = 'docx'; limite = 20; ventanaMs = 2 * 60 * 60 * 1000; } // 20 por 2 horas
        else if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) { tipo = 'image'; limite = 15; ventanaMs = 2 * 60 * 60 * 1000; } // 15 por 2 horas

        await pool.query(`CREATE TABLE IF NOT EXISTS client_quotas_tipo (
          ip VARCHAR(50), tipo VARCHAR(20), count INT DEFAULT 0, last_used TIMESTAMP, PRIMARY KEY (ip, tipo)
        )`);
        const now = new Date();
        const resDB = await pool.query('SELECT * FROM client_quotas_tipo WHERE ip = $1 AND tipo = $2', [clientIp, tipo]);
        let quota = resDB.rows[0];

        if (!quota || (now - new Date(quota.last_used)) > ventanaMs) {
          await pool.query('INSERT INTO client_quotas_tipo (ip, tipo, count, last_used) VALUES ($1, $2, 1, $3) ON CONFLICT (ip, tipo) DO UPDATE SET count = 1, last_used = $3', [clientIp, tipo, now]);
        } else {
          if (quota.count >= limite) {
            const msRestante = ventanaMs - (now - new Date(quota.last_used));
            const minutos = Math.ceil(msRestante / 60000);
            let tipoMsg = tipo;
            if (tipo === 'docx') tipoMsg = 'documentos Word';
            else if (tipo === 'pdf') tipoMsg = 'PDFs';
            else if (tipo === 'image') tipoMsg = 'imágenes';
            else if (tipo === 'text') tipoMsg = 'textos';
            return res.status(403).json({
              error: `⏳ Has alcanzado el límite de ${limite} ${tipoMsg} para invitados. Registra una cuenta o inicia sesión para obtener más cuota.`,
              proPlus: true,
              tipo,
              minutosRestantes: minutos,
              limite
            });
          }
          await pool.query('UPDATE client_quotas_tipo SET count = count + 1, last_used = $3 WHERE ip = $1 AND tipo = $2', [clientIp, tipo, now]);
        }
      }
    } catch (err) { console.error("Error cuota Postgres:", err); }
  }

  if (!req.file) return res.status(400).json({ error: 'Debes enviar un archivo.' });

  try {
    const sourceLanguage = sanitizeString(req.body.sourceLanguage, { required: true, maxLength: 20 });
    const targetLanguage = sanitizeString(req.body.targetLanguage, { required: true, maxLength: 20 });
    const project = sanitizeString(req.body.project || 'default', { required: true, maxLength: 120 });
    const domain = sanitizeString(req.body.domain || 'general', { required: true, maxLength: 120 });

    const { originalText, translatedText, sourceTextHash, fromCache } = await createPreviewFromFile({ file: req.file, sourceLanguage, targetLanguage, project, domain, userId });
    const previewId = crypto.randomUUID(); clearExpiredPreviews();
    previewStore.set(previewId, { originalFileName: req.file.originalname, sourceLanguage, targetLanguage, project, domain, originalText, sourceTextHash, translatedText, expiresAt: Date.now() + PREVIEW_TTL_MS });

    const safeUserId = Number.isInteger(userId) ? userId : null;

    if (shouldReturnPreview) {
      setExperienceHeaders(res, { traceId, status: 'preview_ready', processingMs: Date.now() - startedAt });
      await saveHistory({ userId: safeUserId, originalFileName: req.file.originalname, fileType: path.extname(req.file.originalname).replace('.', ''), sourceLanguage, targetLanguage, project, domain, sourceTextHash, translatedTextCache: translatedText, sourceTextLength: originalText.length, translatedTextLength: translatedText.length, status: 'success', fileSizeBytes: req.file.size });
      return res.status(200).json({ previewId, traceId, originalFileName: req.file.originalname, sourceLanguage, targetLanguage, originalText, translatedText, experience: { status: 'preview_ready', estimatedCompletionSeconds: estimateTranslationSecondsByText(originalText), fromCache, assistantMessage: buildAssistantMessage('preview_ready') } });
    }

    const translatedDocxBuffer = await createTranslatedDocxBuffer({ originalFileName: req.file.originalname, sourceLanguage, targetLanguage, translatedText });
    await saveHistory({ userId: safeUserId, originalFileName: req.file.originalname, fileType: path.extname(req.file.originalname).replace('.', ''), sourceLanguage, targetLanguage, project, domain, sourceTextHash, translatedTextCache: translatedText, sourceTextLength: originalText.length, translatedTextLength: translatedText.length, status: 'success', fileSizeBytes: req.file.size });

    setExperienceHeaders(res, { traceId, status: 'document_ready', processingMs: Date.now() - startedAt });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${path.parse(req.file.originalname).name}-${targetLanguage}.docx"`);
    return res.status(200).send(translatedDocxBuffer);
  } catch (error) {
    const safeUserId = Number.isInteger(userId) ? userId : null;
    await saveHistory({ userId: safeUserId, originalFileName: req.file?.originalname, status: 'failed', errorMessage: error.message, fileSizeBytes: req.file ? req.file.size : 0 });
    return next(error);
  }
}

router.post('/translate', upload.single('document'), async (req, res, next) => processTranslationRequest(req, res, next, false));
router.post('/translate/preview', upload.single('document'), async (req, res, next) => processTranslationRequest(req, res, next, true));

// DOCX: reenviar traducciones por índice a microservicio Python
const axios = require('axios');
router.post('/translate/finalize', async (req, res, next) => {
  const startedAt = Date.now(); const traceId = crypto.randomUUID();
  try {
    const { previewId, translatedText, sourceLanguage, targetLanguage, originalFileName, docxRunsTranslated } = req.body;
    const preview = previewId ? previewStore.get(previewId) : null;
    if (previewId && !preview) return res.status(404).json({ error: 'Vista previa no encontrada o expirada.' });

    // Si es DOCX con runs traducidos
    if (docxRunsTranslated && Array.isArray(docxRunsTranslated)) {
      // Recuperar archivo original
      const tmpPath = path.join(__dirname, '../../uploads', `${Date.now()}-${originalFileName}`);
      fs.writeFileSync(tmpPath, Buffer.from(preview?.originalFileBuffer || []));
      // Llamar microservicio Python
      const formData = new (require('form-data'))();
      formData.append('file', fs.createReadStream(tmpPath));
      formData.append('traducciones', JSON.stringify(docxRunsTranslated));
      const pyRes = await axios.post('http://localhost:5001/procesar-docx', formData, { responseType: 'arraybuffer', headers: formData.getHeaders() });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${path.parse(originalFileName).name}-${targetLanguage}.docx"`);
      return res.status(200).send(pyRes.data);
    }

    // Flujo clásico
    const finalText = translatedText || preview?.translatedText;
    const finalSourceLanguage = sourceLanguage || preview?.sourceLanguage;
    const finalTargetLanguage = targetLanguage || preview?.targetLanguage;
    const finalFileName = originalFileName || preview?.originalFileName || 'documento';

    if (!finalText || !finalSourceLanguage || !finalTargetLanguage) return res.status(400).json({ error: 'Faltan datos.' });

    const translatedDocxBuffer = await createTranslatedDocxBuffer({ originalFileName: finalFileName, sourceLanguage: finalSourceLanguage, targetLanguage: finalTargetLanguage, translatedText: finalText });
    const userId = Number(req.user?.id || req.user?._id);
    await saveHistory({ userId: Number.isInteger(userId) ? userId : null, originalFileName: finalFileName, sourceLanguage: finalSourceLanguage, targetLanguage: finalTargetLanguage, translatedTextCache: finalText, status: 'success' });

    setExperienceHeaders(res, { traceId, status: 'finalized', processingMs: Date.now() - startedAt });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${path.parse(finalFileName).name}-${finalTargetLanguage}.docx"`);
    return res.status(200).send(translatedDocxBuffer);
  } catch (error) { return next(error); }
});

router.post('/assistant/translate-text', async (req, res) => {
  try {
    const userName = String(req.body.userName || 'usuario').trim() || 'usuario';
    const text = String(req.body.text || '').trim();
    const sourceLanguage = String(req.body.sourceLanguage || '').trim();
    const targetLanguage = String(req.body.targetLanguage || '').trim();

    if (!text) return res.status(400).json({ error: 'Campo requerido: text' });
    if (!sourceLanguage || !targetLanguage) {
      return res.status(400).json({ error: 'Campo requerido: sourceLanguage y targetLanguage' });
    }

    const translatedText = sourceLanguage === targetLanguage
      ? text
      : await translateText(text, sourceLanguage, targetLanguage);

    return res.json({
      userName,
      sourceLanguage,
      targetLanguage,
      translatedText,
      assistantResponse: `Bueno ${userName}, tu traducción a ${targetLanguage} es: ${translatedText}`
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al traducir texto.', detail: error.message });
  }
});

module.exports = router;