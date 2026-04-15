-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ----------------------------------------------------------------
-- JOBS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  active_capacity   INT  NOT NULL CHECK (active_capacity > 0),
  required_skills   JSONB NOT NULL DEFAULT '[]',
  jd_embedding      vector(384),
  ack_window_hours  INT  DEFAULT 24,
  status            TEXT DEFAULT 'open',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- SKILL EMBEDDINGS  (one row per skill per job)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_embeddings (
  id         BIGSERIAL PRIMARY KEY,
  job_id     UUID REFERENCES jobs(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  embedding  vector(384) NOT NULL
);

-- ----------------------------------------------------------------
-- APPLICANTS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applicants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID REFERENCES jobs(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  email             TEXT,
  resume_text       TEXT NOT NULL,
  resume_embedding  vector(384),
  skill_match_score FLOAT,
  semantic_score    FLOAT,
  final_score       FLOAT,
  original_score    FLOAT,   -- locked at insert; used for decay math
  decay_count       INT  DEFAULT 0,
  status            TEXT DEFAULT 'waitlisted'
    CHECK (status IN (
      'pending_scoring',
      'waitlisted',
      'active_review',
      'acknowledged',
      'decayed',
      'hired',
      'rejected'
    )),
  promoted_at       TIMESTAMPTZ,
  ack_deadline      TIMESTAMPTZ,
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- STATE TRANSITIONS  (audit log)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS state_transitions (
  id            BIGSERIAL PRIMARY KEY,
  applicant_id  UUID REFERENCES applicants(id) ON DELETE CASCADE,
  job_id        UUID REFERENCES jobs(id)       ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  reason        TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------
-- Fast waitlist queries: job + status + score ordering
CREATE INDEX IF NOT EXISTS idx_applicants_job_status_score
  ON applicants (job_id, status, final_score DESC);

-- Fast ack-deadline expiry scan (partial — only active_review rows)
CREATE INDEX IF NOT EXISTS idx_applicants_ack_deadline
  ON applicants (ack_deadline)
  WHERE status = 'active_review';

-- HNSW vector index for cosine similarity searches
CREATE INDEX IF NOT EXISTS idx_applicants_embedding_hnsw
  ON applicants USING hnsw (resume_embedding vector_cosine_ops);

-- Skill embedding lookups per job
CREATE INDEX IF NOT EXISTS idx_skill_embeddings_job
  ON skill_embeddings (job_id);
