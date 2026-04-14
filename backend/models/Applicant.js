const mongoose = require('mongoose');

const ApplicantSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  name: { type: String, required: true },
  resume_text: { type: String, required: true },
  final_score: { type: Number, required: true },
  skills_score: { type: Number, required: true },
  semantic_score: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending_scoring', 'waitlisted', 'active_review', 'acknowledged'],
    default: 'pending_scoring' 
  },
  promoted_at: { type: Date },
  ack_deadline: { type: Date },
  decay_count: { type: Number, default: 0 },
  waitlist_position: { type: Number } // Virtual or dynamic for UI tracking
}, { timestamps: true });

module.exports = mongoose.model('Applicant', ApplicantSchema);
