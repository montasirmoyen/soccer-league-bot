const mongoose = require('mongoose');

const staffRatingSchema = new mongoose.Schema({
  staffId: { type: String, required: true },
  raterId: { type: String, required: true },
  stars: { type: Number, required: true, min: 1, max: 5 },
  description: { type: String, trim: true, default: '' }
}, { timestamps: true });

staffRatingSchema.index({ staffId: 1, raterId: 1 }, { unique: true });

module.exports = mongoose.model('StaffRating', staffRatingSchema);