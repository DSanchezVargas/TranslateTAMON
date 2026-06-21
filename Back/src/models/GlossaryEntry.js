const mongoose = require('mongoose');

const glossaryEntrySchema = new mongoose.Schema(
  {
    project: { type: String, required: true },
    sourceLanguage: { type: String, required: true },
    targetLanguage: { type: String, required: true },
    sourceTerm: { type: String, required: true },
    targetTerm: { type: String, required: true },
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

glossaryEntrySchema.index({
  project: 1,
  sourceLanguage: 1,
  targetLanguage: 1,
  sourceTerm: 1
}, { unique: true });

module.exports = mongoose.model('GlossaryEntry', glossaryEntrySchema);
