# Production-Grade Lightweight ATS

A robust, full-stack Applicant Tracking System (ATS) optimized for rapid scaling. Built over a 10-day sprint, it incorporates local AI vector scoring using Xenova's HuggingFace Transformers port alongside dynamic Queue Promotion Cascading.

## System Architecture (MERN Stack)
- **Frontend Layer**: React + Vite styled aggressively using Tailwind CSS v4 (Glassmorphism aesthetics).
- **API Engine**: Express and Node.js implementing offline sentence embeddings (`all-MiniLM-L6-v2`) via WebAssembly.
- **Database + Queue Engine**: MongoDB serving as both a document store and an atomic queue. 
- **The Event Cascade**: Node-Cron routinely scrubs Applicant acknowledgment timeouts, intelligently penalizing non-responses and promoting next-best-fits asynchronously over SSE streams entirely.

## Running Locally

Because Vector math happens directly in the Javascript V8 Engine without remote API key locks, setting the project up takes only three commands:

1. **Boot your Database (requires Docker):**
   ```sh
   docker-compose up -d
   ```
2. **Start the Express Event & AI Engine:**
   ```sh
   cd backend
   npm install
   npm start
   ```
3. **Serve the Recruiter/Candidate Portal:**
   ```sh
   cd frontend
   npm install
   npm run dev
   ```

Visit `http://localhost:5173` to test the demo portals.

## Features
- **Zero API-Key Embedding Math**: Ranks Candidate Resumes vs the Job explicitly through deep Semantic (Full JD Math) and Exact Skill (Target Word) comparisons locally ~30ms scoring.
- **State Queue Promotions**: Uses Mongoose `findOneAndUpdate` abstractions to enforce strict atomic queue ordering when slot openings fall out of timeout constraints.
- **SSE Web-Socketing**: Frontend reacts automatically as Admin status changes.
