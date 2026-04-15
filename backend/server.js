require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const cron       = require('node-cron');
const pgvector   = require('pgvector/pg');
const db         = require('./db');
const migrate    = require('./migrations/migrate');
const { warmup, getEmbedding, getChunkEmbeddings, cosineSimilarity, scoreSkillMatch } = require('./utils/embeddings');
const { promoteApplicants, queueEvents, logTransition } = require('./utils/queue');

const app  = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());

// ================================================================
// STARTUP
// ================================================================
async function start() {
  // 1. Run SQL migrations (idempotent)
  await migrate();

  // 2. Warm up the embedding model
  await warmup();

  // 3. Start listening
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`✅  Server running on port ${PORT}`));
}

// ================================================================
// HELPERS
// ================================================================

/** Convert a raw JS float[] to the pgvector literal '[0.1,0.2,...]' */
function toVec(arr) {
  return pgvector.toSql(arr);
}

/** Parse a pgvector result back to a plain float[] */
function fromVec(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val;
  // pgvector returns strings like '[0.1,0.2,...]' if type not registered
  return val.toString().slice(1, -1).split(',').map(Number);
}

// ================================================================
// ROUTES — JOBS
// ================================================================

// POST /jobs — create a job and embed its JD + skills
app.post('/jobs', async (req, res) => {
  try {
    const { title, description, capacity, skills, ack_window_hours } = req.body;

    if (!title || !description || !capacity || !Array.isArray(skills) || skills.length === 0) {
      return res.status(400).json({ error: 'title, description, capacity, and skills[] are required' });
    }

    // Embed full JD
    const jdVec = await getEmbedding(description);

    // Insert job row
    const jobRes = await db.query(
      `INSERT INTO jobs (title, description, active_capacity, required_skills, jd_embedding, ack_window_hours)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, description, active_capacity, required_skills, ack_window_hours, status, created_at`,
      [title, description, capacity, JSON.stringify(skills), toVec(jdVec), ack_window_hours || 24]
    );
    const job = jobRes.rows[0];

    // Embed each skill and store in skill_embeddings
    for (const skill of skills) {
      const vec = await getEmbedding(skill);
      await db.query(
        `INSERT INTO skill_embeddings (job_id, skill_name, embedding) VALUES ($1, $2, $3)`,
        [job.id, skill, toVec(vec)]
      );
    }

    // Return with _id alias for backward compat
    res.status(201).json({ ...job, _id: job.id });
  } catch (err) {
    console.error('POST /jobs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs — list all jobs (no vectors)
app.get('/jobs', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, description, active_capacity AS capacity, required_skills AS skills,
              ack_window_hours, status, created_at
       FROM jobs ORDER BY created_at DESC`
    );
    // _id alias for frontend compat
    const jobs = result.rows.map(j => ({ ...j, _id: j.id }));
    res.json(jobs);
  } catch (err) {
    console.error('GET /jobs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// ROUTES — APPLICANTS
// ================================================================

// POST /applicants — submit a resume with advisory lock to prevent over-promotion
app.post('/applicants', async (req, res) => {
  try {
    const { jobId, name, email, resume_text } = req.body;

    if (!jobId || !name || !resume_text) {
      return res.status(400).json({ error: 'jobId, name, and resume_text are required' });
    }

    // --- Scoring (outside the transaction — can be slow) ---

    // 1. Embed the whole resume for semantic score
    const resumeVec      = await getEmbedding(resume_text);

    // 2. Chunk-embed the resume for skill matching
    const chunkVecs      = await getChunkEmbeddings(resume_text);

    // 3. Fetch job JD embedding + skill embeddings
    const jobRes = await db.query(
      `SELECT j.id, j.active_capacity, j.ack_window_hours, j.jd_embedding,
              COALESCE(
                json_agg(se.embedding ORDER BY se.id) FILTER (WHERE se.id IS NOT NULL),
                '[]'
              ) AS skill_vecs
       FROM jobs j
       LEFT JOIN skill_embeddings se ON se.job_id = j.id
       WHERE j.id = $1
       GROUP BY j.id`,
      [jobId]
    );
    if (jobRes.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

    const job = jobRes.rows[0];

    // 4. Semantic score: whole resume vs whole JD
    const jdVec        = fromVec(job.jd_embedding);
    const semanticScore = Math.max(0, cosineSimilarity(resumeVec, jdVec));

    // 5. Skill match score: chunk embeddings vs per-skill embeddings
    const skillVecs    = (job.skill_vecs || []).map(v => fromVec(v));
    const skillScore   = skillVecs.length > 0
      ? scoreSkillMatch(chunkVecs, skillVecs)
      : 0;

    const finalScore = (skillScore * 0.6) + (semanticScore * 0.4);

    // --- Atomic insert with advisory lock ---
    let newApplicant;
    await db.transaction(async (client) => {
      // Advisory lock scoped to this job — prevents concurrent over-promotion
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [jobId]);

      // Count currently occupied seats
      const countRes = await client.query(
        `SELECT COUNT(*) FROM applicants
         WHERE job_id = $1 AND status IN ('active_review', 'acknowledged')`,
        [jobId]
      );
      const occupied = parseInt(countRes.rows[0].count, 10);
      const slots    = job.active_capacity - occupied;
      const status   = slots > 0 ? 'active_review' : 'waitlisted';

      const now         = new Date();
      const ackMs       = (job.ack_window_hours || 24) * 60 * 60 * 1000;
      const promotedAt  = status === 'active_review' ? now : null;
      const ackDeadline = status === 'active_review' ? new Date(now.getTime() + ackMs) : null;

      const insertRes = await client.query(
        `INSERT INTO applicants
           (job_id, name, email, resume_text, resume_embedding,
            skill_match_score, semantic_score, final_score, original_score,
            status, promoted_at, ack_deadline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)
         RETURNING *`,
        [
          jobId, name, email || null, resume_text, toVec(resumeVec),
          skillScore, semanticScore, finalScore, status, promotedAt, ackDeadline
        ]
      );
      newApplicant = insertRes.rows[0];
    });

    // Audit log
    await logTransition(
      newApplicant.id, jobId,
      null, newApplicant.status,
      'application_submitted',
      { final_score: finalScore }
    );

    // Emit SSE if directly promoted
    if (newApplicant.status === 'active_review') {
      queueEvents.emit('promotion', { jobId, applicant: newApplicant });
    } else {
      // Try to fill any still-open slots (edge case: slots may have freed
      // between the scoring phase and the lock acquisition)
      await promoteApplicants(jobId, job.ack_window_hours);
    }

    queueEvents.emit('state_change', { jobId, type: 'new_applicant' });

    res.status(201).json({
      id:             newApplicant.id,
      _id:            newApplicant.id, // compat
      status:         newApplicant.status,
      final_score:    newApplicant.final_score,
      skill_match_score: newApplicant.skill_match_score,
      semantic_score: newApplicant.semantic_score,
    });
  } catch (err) {
    console.error('POST /applicants error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /applicants/:id/acknowledge
app.post('/applicants/:id/acknowledge', async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE applicants
       SET status = 'acknowledged', acknowledged_at = NOW()
       WHERE id = $1 AND status = 'active_review'
       RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Applicant is not in active_review or does not exist' });
    }
    const applicant = result.rows[0];

    await logTransition(applicant.id, applicant.job_id, 'active_review', 'acknowledged', 'user_acknowledged');
    queueEvents.emit('state_change', { jobId: applicant.job_id, type: 'acknowledge' });

    res.json({ success: true, applicant: { ...applicant, _id: applicant.id } });
  } catch (err) {
    console.error('POST /applicants/:id/acknowledge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /applicants/:id/hire
app.post('/applicants/:id/hire', async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE applicants
       SET status = 'hired'
       WHERE id = $1 AND status IN ('active_review', 'acknowledged')
       RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Applicant cannot be hired from current status' });
    }
    const applicant = result.rows[0];

    await logTransition(applicant.id, applicant.job_id, applicant.status, 'hired', 'recruiter_hired');
    queueEvents.emit('state_change', { jobId: applicant.job_id, type: 'hired' });

    // Freed a slot — try to promote next in queue
    await promoteApplicants(applicant.job_id);

    res.json({ success: true, applicant: { ...applicant, _id: applicant.id } });
  } catch (err) {
    console.error('POST /applicants/:id/hire error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /applicants/:id/reject
app.post('/applicants/:id/reject', async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE applicants
       SET status = 'rejected'
       WHERE id = $1 AND status IN ('active_review', 'acknowledged', 'waitlisted')
       RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Applicant not found or already in terminal status' });
    }
    const applicant = result.rows[0];
    const prevStatus = req.body.from_status || applicant.status;

    await logTransition(applicant.id, applicant.job_id, prevStatus, 'rejected', 'recruiter_rejected');
    queueEvents.emit('state_change', { jobId: applicant.job_id, type: 'rejected' });

    // If seat was occupied, free it
    if (['active_review', 'acknowledged'].includes(prevStatus)) {
      await promoteApplicants(applicant.job_id);
    }

    res.json({ success: true, applicant: { ...applicant, _id: applicant.id } });
  } catch (err) {
    console.error('POST /applicants/:id/reject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /applicants/:id/position
app.get('/applicants/:id/position', async (req, res) => {
  try {
    // Fetch the applicant
    const appRes = await db.query(
      `SELECT id, job_id, status, final_score, ack_deadline, created_at FROM applicants WHERE id = $1`,
      [req.params.id]
    );
    if (appRes.rows.length === 0) return res.status(404).json({ error: 'Applicant not found' });
    const applicant = appRes.rows[0];

    // Waitlist position: count waitlisted applicants with higher score (or same score + older)
    const posRes = await db.query(
      `SELECT COUNT(*) AS position
       FROM applicants
       WHERE job_id = $1
         AND status = 'waitlisted'
         AND (
           final_score > $2
           OR (final_score = $2 AND created_at < $3)
         )`,
      [applicant.job_id, applicant.final_score, applicant.created_at]
    );
    const position = parseInt(posRes.rows[0].position, 10) + 1; // 1-based

    const totalRes = await db.query(
      `SELECT COUNT(*) AS total FROM applicants WHERE job_id = $1 AND status = 'waitlisted'`,
      [applicant.job_id]
    );
    const total_waitlisted = parseInt(totalRes.rows[0].total, 10);

    res.json({
      position,
      total_waitlisted,
      status:       applicant.status,
      ack_deadline: applicant.ack_deadline,
    });
  } catch (err) {
    console.error('GET /applicants/:id/position error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// ROUTES — ADMIN / WAITLIST
// ================================================================

// GET /jobs/:id/waitlist
app.get('/jobs/:id/waitlist', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id,
              id             AS _id,      -- compat alias
              job_id,
              name,
              email,
              status,
              skill_match_score AS skills_score,  -- matches frontend key
              semantic_score,
              final_score,
              original_score,
              decay_count,
              promoted_at,
              ack_deadline,
              acknowledged_at,
              created_at
       FROM applicants
       WHERE job_id = $1
       ORDER BY
         CASE status
           WHEN 'active_review' THEN 1
           WHEN 'acknowledged'  THEN 2
           WHEN 'waitlisted'    THEN 3
           WHEN 'decayed'       THEN 4
           ELSE 5
         END,
         final_score DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /jobs/:id/waitlist error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs/:id/transitions — audit log for a job
app.get('/jobs/:id/transitions', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT st.*, a.name AS applicant_name
       FROM state_transitions st
       JOIN applicants a ON a.id = st.applicant_id
       WHERE st.job_id = $1
       ORDER BY st.created_at DESC
       LIMIT 100`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /jobs/:id/transitions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// SSE — real-time waitlist stream
// ================================================================
app.get('/stream/jobs/:jobId', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders(); // important for Express 5

  // Heartbeat to keep the connection alive through proxies
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  const send = (type, data) => {
    if (data.jobId?.toString() === req.params.jobId) {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    }
  };

  const onPromotion   = d => send('promotion',    d);
  const onStateChange = d => send('state_change', d);

  queueEvents.on('promotion',    onPromotion);
  queueEvents.on('state_change', onStateChange);

  req.on('close', () => {
    clearInterval(heartbeat);
    queueEvents.off('promotion',    onPromotion);
    queueEvents.off('state_change', onStateChange);
  });
});

// ================================================================
// CRON — ACK DEADLINE DECAY CASCADE (every 60 seconds)
// ================================================================
cron.schedule('* * * * *', async () => {
  try {
    // Find all applicants whose ack window expired
    const expired = await db.query(
      `SELECT id, job_id, original_score, decay_count, status
       FROM applicants
       WHERE status = 'active_review' AND ack_deadline < NOW()`
    );

    if (expired.rows.length === 0) return;

    const jobIdsToPromote = new Set();

    for (const applicant of expired.rows) {
      // Decay uses original_score so compounding doesn't eat the score twice
      const newDecayCount = applicant.decay_count + 1;
      const newScore      = applicant.original_score * Math.pow(0.9, newDecayCount);

      await db.query(
        `UPDATE applicants
         SET status      = 'decayed',
             decay_count = $2,
             final_score = $3
         WHERE id = $1`,
        [applicant.id, newDecayCount, newScore]
      );

      await logTransition(
        applicant.id, applicant.job_id,
        'active_review', 'decayed',
        'ack_deadline_expired',
        { decay_count: newDecayCount, new_score: newScore }
      );

      queueEvents.emit('state_change', { jobId: applicant.job_id, type: 'decay' });
      jobIdsToPromote.add(applicant.job_id);
    }

    // Promote next in queue for each affected job
    for (const jobId of jobIdsToPromote) {
      await promoteApplicants(jobId);
    }
  } catch (err) {
    console.error('Decay cron error:', err);
  }
});

// ================================================================
// BOOT
// ================================================================
start().catch(err => {
  const detail = err.message || (err.errors && err.errors.map(e => e.message).join(', ')) || String(err);
  console.error('Fatal startup error:', detail);
  if (err.code === 'ECONNREFUSED') {
    console.error('→ PostgreSQL is not running. Start it with: docker-compose up postgres -d');
  }
  process.exit(1);
});

