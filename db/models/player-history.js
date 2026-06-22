const mongoose = require('mongoose');

const playerHistorySchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  demandsUsed: { type: Number, default: 0 },
});

module.exports = mongoose.model('PlayerHistory', playerHistorySchema);