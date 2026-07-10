const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  roleId: { type: String, required: true },
  manager: { type: String, default: null },
  assistantManager: { type: String, default: null },
  releasesUsed: { type: Number, default: 0 },
  emergencySignsUsed: { type: Number, default: 0 }
});

module.exports = mongoose.model('Team', teamSchema);