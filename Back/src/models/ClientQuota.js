const mongoose = require('mongoose');

const clientQuotaSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  lastUsed: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ClientQuota', clientQuotaSchema);