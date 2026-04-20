// Middleware para inyectar usuario simulado (admin, pro, normal) en req.user
// En producción, reemplaza esto por tu lógica real de autenticación (JWT, sesión, etc.)

module.exports = function userInject(req, res, next) {
  // --- DEMO: Cambia aquí para simular distintos roles ---
  // Puedes usar cabeceras, cookies, o cualquier lógica real
  // Ejemplo: Si envías ?admin=1 en la query, eres admin
  if (req.query.admin === '1') {
    req.user = { id: 1, nombre: 'Tatsu', role: 'admin', isAdmin: true };
  } else if (req.query.pro === '1') {
    req.user = { id: 2, nombre: 'Usuario Pro', plan: 'pro', isPro: true };
  } else {
    req.user = { id: 3, nombre: 'Usuario Gratis', plan: 'free' };
  }
  next();
};
