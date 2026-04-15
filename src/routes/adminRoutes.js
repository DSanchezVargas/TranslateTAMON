const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const CorrectionSuggestion = require('../models/CorrectionSuggestion');
const DomainRule = require('../models/DomainRule');
const GlossaryEntry = require('../models/GlossaryEntry');

// Subir nuevos ejemplos/correcciones
router.post('/training-data', requireAdmin, async (req, res) => {
  try {
    const { type, data } = req.body;
    let result;
    switch (type) {
      case 'correction':
        result = await CorrectionSuggestion.create(data);
        break;
      case 'rule':
        result = await DomainRule.create(data);
        break;
      case 'glossary':
        result = await GlossaryEntry.create(data);
        break;
      default:
        return res.status(400).json({ error: 'Tipo no soportado' });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar sugerencias de la IA para revisión
router.get('/suggestions', requireAdmin, async (req, res) => {
  try {
    const suggestions = await CorrectionSuggestion.find({ status: 'pending' });
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aprobar sugerencia
router.post('/suggestions/:id/approve', requireAdmin, async (req, res) => {
  try {
    const suggestion = await CorrectionSuggestion.findByIdAndUpdate(
      req.params.id,
      { status: 'approved' },
      { new: true }
    );
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rechazar sugerencia
router.post('/suggestions/:id/reject', requireAdmin, async (req, res) => {
  try {
    const suggestion = await CorrectionSuggestion.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected' },
      { new: true }
    );
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modificar una regla existente
router.put('/rules/:id', requireAdmin, async (req, res) => {
  try {
    const rule = await DomainRule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agregar término al glosario
router.post('/glossary', requireAdmin, async (req, res) => {
  try {
    const entry = await GlossaryEntry.create(req.body);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
