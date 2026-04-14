const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  capacity: { type: Number, required: true },
  skills: [{
    name: String,
    vector: [Number] // 384d vector
  }],
  job_vector: [Number] // Full JD text embedding string
}, { timestamps: true });

module.exports = mongoose.model('Job', JobSchema);
