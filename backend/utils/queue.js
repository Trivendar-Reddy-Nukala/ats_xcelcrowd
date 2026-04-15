const EventEmitter = require('events');
const db = require('../db');

// EventEmitter for SSE broadcast
const queueEvents = new EventEmitter();
queueEvents.setMaxListeners(100); // many SSE clients possible

// ----------------------------------------------------------------
// Audit log
// ----------------------------------------------------------------
/**
 * Insert a row into state_transitions.
 * Call this on every status change throughout the app.
 */
async function logTransition(applicantId, jobId, fromStatus, toStatus, reason, metadata = {}) {
  try {
    await db.query(
      `INSERT INTO state_transitions
         (applicant_id, job_id, from_status, to_status, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [applicantId, jobId, fromStatus, toStatus, reason, JSON.stringify(metadata)]
    );
  } catch (err) {
    // Audit failures are non-fatal but always logged
    console.error('logTransition error:', err.message);
  }
}

// ----------------------------------------------------------------
// Promotion
// ----------------------------------------------------------------
/**
 * Promote the highest-scoring waitlisted applicant into active_review,
 * filling as many open slots as there are available.
 *
 * Uses FOR UPDATE SKIP LOCKED so concurrent callers never double-promote.
 *
 * @param {string} jobId
 * @param {number} [ackWindowHours=24]  - from the job record
 */
async function promoteApplicants(jobId, ackWindowHours = 24) {
  try {
    // How many slots does this job have?
    const jobRes = await db.query(
      'SELECT active_capacity, ack_window_hours FROM jobs WHERE id = $1',
      [jobId]
    );
    if (jobRes.rows.length === 0) return;

    const capacity  = jobRes.rows[0].active_capacity;
    const ackHours  = ackWindowHours || jobRes.rows[0].ack_window_hours || 24;

    // Count currently occupied seats
    const countRes = await db.query(
      `SELECT COUNT(*) FROM applicants
       WHERE job_id = $1 AND status IN ('active_review', 'acknowledged')`,
      [jobId]
    );
    const occupied = parseInt(countRes.rows[0].count, 10);
    const slots    = capacity - occupied;

    if (slots <= 0) return;

    // Promote up to `slots` waitlisted applicants, one at a time.
    // FOR UPDATE SKIP LOCKED ensures concurrent callers skip the same row.
    for (let i = 0; i < slots; i++) {
      const res = await db.query(
        `UPDATE applicants
         SET status      = 'active_review',
             promoted_at = NOW(),
             ack_deadline = NOW() + $2 * INTERVAL '1 hour'
         WHERE id = (
           SELECT id FROM applicants
           WHERE job_id = $1 AND status = 'waitlisted'
           ORDER BY final_score DESC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING *`,
        [jobId, ackHours]
      );

      if (res.rows.length === 0) break; // waitlist exhausted

      const promoted = res.rows[0];
      console.log(`Promoted applicant ${promoted.id} for job ${jobId}`);

      await logTransition(
        promoted.id, jobId,
        'waitlisted', 'active_review',
        'slot_available',
        { promoted_at: promoted.promoted_at, ack_deadline: promoted.ack_deadline }
      );

      queueEvents.emit('promotion', { jobId, applicant: promoted });
    }
  } catch (err) {
    console.error('promoteApplicants error:', err.message);
  }
}

module.exports = { promoteApplicants, queueEvents, logTransition };
