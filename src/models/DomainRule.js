const mongoose = require('mongoose');

const domainRuleSchema = new mongoose.Schema(
  {
    project: { type: String, required: true },
    domain: { type: String, required: true },
    findText: { type: String, required: true },
    replaceText: { type: String, required: true },
    applyStage: { type: String, enum: ['pre_translation', 'post_translation'], default: 'pre_translation' },
    version: { type: Number, default: 1 },
    history: [
      {
        version: Number,
        updatedAt: Date,
        updatedBy: String,
        changes: Object
      }
    ]
  },
  { timestamps: true }
);

module.exports = mongoose.model('DomainRule', domainRuleSchema);
