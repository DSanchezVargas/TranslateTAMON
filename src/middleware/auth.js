// Middleware para requerir rol de admin
module.exports.requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Acceso solo para administradores' });
};
