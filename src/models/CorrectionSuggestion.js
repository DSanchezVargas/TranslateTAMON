const mongoose = require('mongoose');

const correctionSuggestionSchema = new mongoose.Schema(
  {
    project: { type: String, required: true },
    sourceLanguage: { type: String, required: true },
    targetLanguage: { type: String, required: true },
    originalTranslation: { type: String, required: true },
    suggestedTranslation: { type: String, required: true },
    createdByRole: { type: String, enum: ['user', 'admin', 'system'], default: 'user' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: String },
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

module.exports = mongoose.model('CorrectionSuggestion', correctionSuggestionSchema);
