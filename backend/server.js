require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const Job = require('./models/Job');
const Applicant = require('./models/Applicant');
const { getEmbedding, cosineSimilarity } = require('./utils/embeddings');
const { promoteApplicants, queueEvents } = require('./utils/queue');

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ats')
  .then(() => console.log('MongoDB Connected'))
  .catch(console.error);

// ---------------------------------------------------------
// ROUTES
// ---------------------------------------------------------

// Create a new Job
app.post('/jobs', async (req, res) => {
  try {
    const { title, description, capacity, skills } = req.body;
    
    // Embed the job description for semantic score
    const job_vector = await getEmbedding(description);
    
    // Embed each skill for the skill score
    const embeddedSkills = [];
    for (const skill of skills) {
      const vector = await getEmbedding(skill);
      embeddedSkills.push({ name: skill, vector });
    }

    const job = new Job({ title, description, capacity, skills: embeddedSkills, job_vector });
    await job.save();
    
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/jobs', async (req, res) => {
  const jobs = await Job.find({}, '-job_vector -skills.vector');
  res.json(jobs);
});

// Submit application
app.post('/applicants', async (req, res) => {
  try {
    const { jobId, name, resume_text } = req.body;
    
    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // 1. Two-phase embedding logic
    const resume_vector = await getEmbedding(resume_text);
    
    // Semantic score using full text vs full description
    let semantic_score = cosineSimilarity(resume_vector, job.job_vector);
    // Ensure bound limits
    semantic_score = Math.max(0, semantic_score);
    
    // Skill match score
    let skills_score = 0;
    for (const skill of job.skills) {
      // Very basic scoring: evaluate resume vs the specific skill embedding
      let match = cosineSimilarity(resume_vector, skill.vector);
      if (match >= 0.85) skills_score += 1.0;
      else if (match >= 0.70) skills_score += 0.8 * match;
    }
    // Normalize skills score
    if(job.skills.length > 0) skills_score = skills_score / job.skills.length;

    const final_score = (skills_score * 0.6) + (semantic_score * 0.4);

    const applicant = new Applicant({
      jobId, name, resume_text, final_score, skills_score, semantic_score, status: 'waitlisted'
    });
    
    await applicant.save();

    // Trigger promotion logic to see if they instantly get active_review
    await promoteApplicants(job._id);

    res.status(201).json({ id: applicant._id, final_score, status: applicant.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Applicant Acknowledge action
app.post('/applicants/:id/acknowledge', async (req, res) => {
  try {
    const applicant = await Applicant.findOneAndUpdate(
      { _id: req.params.id, status: 'active_review' },
      { $set: { status: 'acknowledged' } },
      { new: true }
    );
    
    if (!applicant) return res.status(400).json({ error: 'No longer in active review or already acknowledged' });

    // Emit event that someone acknowledged
    queueEvents.emit('state_change', { jobId: applicant.jobId, type: 'acknowledge' });

    res.json({ success: true, applicant });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Waitlist Data
app.get('/jobs/:id/waitlist', async (req, res) => {
  const applicants = await Applicant.find({ jobId: req.params.id }).sort({ status: 1, final_score: -1 });
  res.json(applicants);
});

// SSE endpoint to broadcast waitlist changes
app.get('/stream/jobs/:jobId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onPromotion = (data) => {
    if(data.jobId.toString() === req.params.jobId) {
      res.write(`data: ${JSON.stringify({ type: 'promotion', ...data })}\n\n`);
    }
  };

  const onStateChange = (data) => {
    if(data.jobId.toString() === req.params.jobId) {
      res.write(`data: ${JSON.stringify({ type: 'state_change', ...data })}\n\n`);
    }
  };
  
  queueEvents.on('promotion', onPromotion);
  queueEvents.on('state_change', onStateChange);

  req.on('close', () => {
    queueEvents.off('promotion', onPromotion);
    queueEvents.off('state_change', onStateChange);
  });
});

// ---------------------------------------------------------
// CRON: DECAY CASCADE SCHEDULER
// ---------------------------------------------------------
cron.schedule('* * * * *', async () => {
  // Runs every 60 seconds
  try {
    const expiredApplicants = await Applicant.find({
      status: 'active_review',
      ack_deadline: { $lt: new Date() }
    });

    const jobIdsToPromote = new Set();

    for (let applicant of expiredApplicants) {
      applicant.decay_count += 1;
      applicant.final_score = applicant.final_score * Math.pow(0.9, applicant.decay_count);
      applicant.status = 'waitlisted';
      
      await applicant.save();
      jobIdsToPromote.add(applicant.jobId.toString());

      queueEvents.emit('state_change', { jobId: applicant.jobId, type: 'decay' });
    }

    for (let jobId of jobIdsToPromote) {
      await promoteApplicants(jobId);
    }
  } catch(err) {
    console.error('Decay cascade cron error:', err);
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Runing Server on port ${PORT}`));
