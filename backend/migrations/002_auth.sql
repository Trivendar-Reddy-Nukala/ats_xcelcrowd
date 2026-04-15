-- ----------------------------------------------------------------
-- USERS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'recruiter')),
  name TEXT NOT NULL,
  company_name TEXT,
  company_details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- ALTER JOBS
-- ----------------------------------------------------------------
ALTER TABLE jobs 
  ADD COLUMN IF NOT EXISTS recruiter_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS opening_date TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS closing_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS threshold_score FLOAT DEFAULT 0;

-- ----------------------------------------------------------------
-- ALTER APPLICANTS
-- ----------------------------------------------------------------
ALTER TABLE applicants
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS resume_file_path TEXT;
