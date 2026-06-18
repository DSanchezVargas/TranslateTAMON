const PLAN_CATALOG = {
  free: {
    key: 'free',
    name: 'Free',
    monthlyPriceUsd: 0,
    benefits: [
      'Hasta 10 documentos diarios',
      'Acceso estándar',
      'Historial básico'
    ],
    dailyDocumentQuota: 10
  },
  pro_plus: {
    key: 'pro_plus',
    name: 'Pro Plus',
    monthlyPriceUsd: 12.99,
    benefits: [
      'Documentos ilimitados',
      'Prioridad de procesamiento',
      'Panel y métricas avanzadas'
    ],
    dailyDocumentQuota: null
  }
};

function normalizePlan(rawPlan) {
  if (!rawPlan) return 'free';
  const normalized = String(rawPlan).toLowerCase();
  if (normalized === 'pro' || normalized === 'vip') return 'pro_plus';
  if (normalized === 'chill' || normalized === 'gratis') return 'free';
  return PLAN_CATALOG[normalized] ? normalized : 'free';
}

function getPlanDetails(rawPlan) {
  return PLAN_CATALOG[normalizePlan(rawPlan)];
}

module.exports = {
  PLAN_CATALOG,
  normalizePlan,
  getPlanDetails
};
