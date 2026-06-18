const express = require('express');
const jwt = require('jsonwebtoken');
const { pool, isDbReady } = require('../config/db');
const { PLAN_CATALOG, normalizePlan, getPlanDetails } = require('../utils/planCatalog');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

function resolveUserId(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    return Number(decoded.id);
  }
  return Number(req.user?.id || req.user?._id);
}

function requireAuth(req, res, next) {
  try {
    const userId = resolveUserId(req);
    if (!Number.isInteger(userId)) return res.status(401).json({ error: 'Sesión inválida.' });
    req.authUserId = userId;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Sesión inválida.' });
  }
}

router.get('/', (_req, res) => {
  res.json({ plans: Object.values(PLAN_CATALOG) });
});

router.get('/current', requireAuth, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const userResult = await pool.query('SELECT id, plan FROM users WHERE id = $1', [req.authUserId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const currentPlan = normalizePlan(user.plan);
    return res.json({
      currentPlan,
      currentPlanDetails: getPlanDetails(currentPlan),
      nextPlan: currentPlan === 'free' ? 'pro_plus' : null,
      nextPlanDetails: currentPlan === 'free' ? getPlanDetails('pro_plus') : null
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener plan actual.', detail: error.message });
  }
});

router.post('/upgrade', requireAuth, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const targetPlan = normalizePlan(req.body.targetPlan || 'pro_plus');
    const discountCode = String(req.body.discountCode || '').trim().toUpperCase();
    if (targetPlan !== 'pro_plus') {
      return res.status(400).json({ error: 'Solo se permite upgrade a pro_plus.' });
    }

    const userResult = await pool.query('SELECT id, plan FROM users WHERE id = $1', [req.authUserId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const currentPlan = normalizePlan(user.plan);
    if (currentPlan === 'pro_plus') {
      return res.status(409).json({ error: 'Tu cuenta ya está en pro_plus.' });
    }

    const basePrice = PLAN_CATALOG.pro_plus.monthlyPriceUsd;
    const discountPercent = discountCode === 'TAMON10' ? 10 : 0;
    const finalPrice = Number((basePrice * (1 - discountPercent / 100)).toFixed(2));

    await pool.query(
      `UPDATE users SET plan = $1 WHERE id = $2`,
      ['pro_plus', req.authUserId]
    );

    return res.json({
      message: 'Upgrade completado.',
      previousPlan: currentPlan,
      currentPlan: 'pro_plus',
      simulatedPayment: {
        provider: 'stripe_simulated',
        status: 'paid',
        preparedForStripe: true,
        basePriceUsd: basePrice,
        discountCode: discountCode || null,
        discountPercent,
        finalPriceUsd: finalPrice
      },
      benefits: PLAN_CATALOG.pro_plus.benefits
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al actualizar plan.', detail: error.message });
  }
});

router.put('/change', requireAuth, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const targetPlan = normalizePlan(req.body.targetPlan);
    await pool.query('UPDATE users SET plan = $1 WHERE id = $2', [targetPlan, req.authUserId]);
    return res.json({
      message: 'Plan actualizado.',
      currentPlan: targetPlan,
      currentPlanDetails: getPlanDetails(targetPlan)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al cambiar plan.', detail: error.message });
  }
});

module.exports = router;
