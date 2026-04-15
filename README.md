# Production-Grade Lightweight ATS

A robust, full-stack Applicant Tracking System (ATS) optimized for rapid scaling. Built over a 10-day sprint, it incorporates local AI vector scoring alongside dynamic Queue Promotion Cascading.

## System Architecture
- **Frontend Layer**: React + Vite styled aggressively using Tailwind CSS v4 (Glassmorphism aesthetics) and React Router for role-based portal isolation.
- **Backend API**: Express & Node.js integrating directly with `pgvector` for offline sentence embeddings (`all-MiniLM-L6-v2`) via WebAssembly. Features include multi-part PDF text extraction (`pdf-parse`, `multer`) and stateless authentication (`jsonwebtoken`, `bcryptjs`).
- **Database Engine**: PostgreSQL serving as both a structured data store and a highly concurrent atomic queuing engine.
- **The Event Cascade**: Native `setInterval` routines independently scrub Applicant acknowledgment timeouts, intelligently penalizing non-responses (score decays) and promoting next-best-fits asynchronously over SSE streams.

## Waitlist Queue & Concurrency Mechanisms
When two applicants arrive simultaneously or attempt to accept actions for the last available slot, the system employs strict concurrency control to avoid double-promotions. Specifically, we use a PostgreSQL transaction with `SELECT ... FOR UPDATE` row-level locking (and `pg_advisory_xact_lock` for scoping). The first transaction to acquire the lock claims the slot; the second finds capacity exhausted and is placed on the waitlist.

## Audit Logs (Pipeline Events)
To satisfy stringent HR auditing requirements, all waitlist movement is immutably recorded in the `state_transitions` table. This pipeline event log acts as a permanent audit trail tracking status progressions (e.g., `waitlisted` -> `active_review` -> `acknowledged` -> `hired`), logging the triggering event action, and cataloging any alterations to the applicant's score matrix over time due to decay factors.

## Running Locally

Because Vector math happens directly in the Application without remote API keys, setting the project up takes only a few commands:

1. **Boot your Database (requires Docker):**
   ```sh
   docker-compose up -d postgres
   ```
2. **Start the API Engine:**
   ```sh
   cd backend
   npm install
   node server.js
   ```
3. **Serve the Recruiter/Candidate Portals:**
   ```sh
   cd frontend
   npm install
   npm run dev
   ```

Visit `http://localhost:5173` to test the web apps.
