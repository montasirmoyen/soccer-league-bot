const mongoose = require('mongoose');

const pendingDemandSchema = new mongoose.Schema({
  teamName: { type: String, required: true },
  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now }
}, { _id: false });

const playerHistorySchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  signingsUsed: { type: Number, default: 0 },
  demandsUsed: { type: Number, default: 0 },
  pendingDemand: { type: pendingDemandSchema, default: null }
});

module.exports = mongoose.model('PlayerHistory', playerHistorySchema);