const Applicant = require('../models/Applicant');
const Job = require('../models/Job');

// Emits an event to any listeners (SSE clients)
const EventEmitter = require('events');
const queueEvents = new EventEmitter();

/**
 * Attempts to promote applicants from the waitlist into active_review
 * to fill available job capacity.
 */
async function promoteApplicants(jobId) {
  try {
    const job = await Job.findById(jobId);
    if (!job) return;

    // Count how many are currently in active_review or acknowledged
    const activeCount = await Applicant.countDocuments({
      jobId,
      status: { $in: ['active_review', 'acknowledged'] }
    });

    const slotsAvailable = job.capacity - activeCount;

    if (slotsAvailable > 0) {
      for (let i = 0; i < slotsAvailable; i++) {
        // Atomic promotion!
        const promoted = await Applicant.findOneAndUpdate(
          { jobId, status: 'waitlisted' },
          { 
            $set: { 
              status: 'active_review', 
              promoted_at: new Date(),
              ack_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
            } 
          },
          { 
            sort: { final_score: -1, createdAt: 1 }, 
            new: true 
          }
        );

        if (promoted) {
          console.log(`Promoted applicant ${promoted._id} for job ${jobId}`);
          queueEvents.emit('promotion', { jobId, applicant: promoted });
        } else {
          // Waitlist empty
          break;
        }
      }
    }
  } catch (err) {
    console.error('Error promoting applicants:', err);
  }
}

module.exports = { promoteApplicants, queueEvents };
