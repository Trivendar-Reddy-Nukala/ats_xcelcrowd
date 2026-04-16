# 🎯 ATS — Applicant Tracking System

A **production-grade Applicant Tracking System** powered by Node.js, PostgreSQL with `pgvector`, and a React frontend. It uses local AI embeddings to semantically score resumes against job descriptions, manages capacity-limited review queues with concurrency-safe seat allocation, and streams live queue updates to every connected client via Server-Sent Events.

---

## 📑 Table of Contents

1. [Tech Stack](#-tech-stack)
2. [Project Structure](#-project-structure)
3. [Architecture Overview](#-architecture-overview)
4. [Database Schema](#-database-schema)
5. [Backend Processing — Step by Step](#-backend-processing--step-by-step)
   - [Step 1 — Startup & Migrations](#step-1--startup--migrations)
   - [Step 2 — Embedding Model Warmup](#step-2--embedding-model-warmup)
   - [Step 3 — Authentication Flow](#step-3--authentication-flow)
   - [Step 4 — Job Posting Pipeline](#step-4--job-posting-pipeline)
   - [Step 5 — Resume Submission & Scoring](#step-5--resume-submission--scoring)
   - [Step 6 — Seat Allocation with Advisory Locks](#step-6--seat-allocation-with-advisory-locks)
   - [Step 7 — Queue Promotion Engine](#step-7--queue-promotion-engine)
   - [Step 8 — Acknowledgement & Decay Cascade](#step-8--acknowledgement--decay-cascade)
   - [Step 9 — Real-time SSE Stream](#step-9--real-time-sse-stream)
   - [Step 10 — Audit Log](#step-10--audit-log)
6. [Scoring Algorithm Deep-Dive](#-scoring-algorithm-deep-dive)
7. [Applicant Status State Machine](#-applicant-status-state-machine)
8. [API Reference](#-api-reference)
9. [Environment Variables](#-environment-variables)
10. [Running Locally](#-running-locally)
11. [Running with Docker](#-running-with-docker)
12. [Folder-by-Folder Reference](#-folder-by-folder-reference)

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js 20 + Express 5 | HTTP server & routing |
| **Database** | PostgreSQL 16 + pgvector | Relational data + vector similarity search |
| **Embeddings** | `@xenova/transformers` (MiniLM-L6-v2) | Local AI for 384-dim resume/JD vectors |
| **Auth** | JSON Web Tokens (JWT) + bcryptjs | Stateless auth, password hashing |
| **File Upload** | Multer | PDF file saving to `/uploads` |
| **PDF Parsing** | pdf-parse | Text extraction from uploaded PDFs |
| **Real-time** | Server-Sent Events (SSE) | Live waitlist/queue updates pushed to clients |
| **Containerization** | Docker + Docker Compose | Reproducible local environment |
| **Frontend** | React + Vite + Tailwind CSS | Candidate & recruiter dashboards |

---

## 📁 Project Structure

```
ATS/
├── docker-compose.yml          # Orchestrates postgres + backend + frontend
├── .env                        # Root-level env (DATABASE_URL, PORT, JWT_SECRET)
├── docs/
│   └── api.md                  # API reference
├── backend/
│   ├── server.js               # ⭐ Main Express app — all route definitions
│   ├── db.js                   # PostgreSQL pool + transaction helper
│   ├── package.json            # Node dependencies
│   ├── Dockerfile              # Backend container image
│   ├── .env / .env.example     # Backend-specific env vars
│   ├── uploads/                # PDF files saved here by Multer
│   ├── migrations/
│   │   ├── migrate.js          # Migration runner (auto-runs on startup)
│   │   ├── 001_init.sql        # Core schema: jobs, applicants, skill_embeddings, state_transitions
│   │   └── 002_auth.sql        # Users table + foreign keys added to jobs & applicants
│   ├── routes/
│   │   └── auth.js             # /auth/register + /auth/login + authenticateToken middleware
│   └── utils/
│       ├── embeddings.js       # AI embedding pipeline (MiniLM-L6-v2)
│       └── queue.js            # Promotion logic + SSE event emitter + audit logger
└── frontend/
    ├── src/                    # React components & pages
    ├── Dockerfile
    └── vite.config.js
```

---

## 🏗 Architecture Overview

```mermaid
graph TB
    subgraph Client ["🌐 Client Layer"]
        FE["React / Vite Frontend<br/>(port 5173)"]
    end

    subgraph Backend ["⚙️ Backend Layer (Express.js — port 5000)"]
        AUTH["auth.js<br/>POST /auth/register<br/>POST /auth/login"]
        JOBS["Jobs Routes<br/>POST /jobs<br/>GET /jobs<br/>GET /jobs/:id/waitlist<br/>GET /jobs/:id/transitions"]
        APPS["Applicants Routes<br/>POST /applicants<br/>POST /:id/acknowledge<br/>POST /:id/hire<br/>POST /:id/reject<br/>GET /:id/position"]
        SSE["SSE Stream<br/>GET /stream/jobs/:jobId"]
        DECAY["⏱ Decay Background Job<br/>setInterval — every 60s"]
    end

    subgraph Utilities ["🔧 Utilities"]
        EMB["embeddings.js<br/>Xenova MiniLM-L6-v2<br/>384-dim vectors"]
        QUEUE["queue.js<br/>promoteApplicants()<br/>logTransition()<br/>queueEvents (EventEmitter)"]
    end

    subgraph DB ["🗄 PostgreSQL + pgvector"]
        USERS[(users)]
        JOBST[(jobs)]
        SKILL[(skill_embeddings)]
        APPT[(applicants)]
        TRANS[(state_transitions)]
    end

    FE -->|REST + JWT| AUTH
    FE -->|REST + JWT| JOBS
    FE -->|multipart/form-data + JWT| APPS
    FE -->|EventSource| SSE

    AUTH --> USERS
    JOBS --> JOBST
    JOBS --> SKILL
    JOBS --> EMB
    APPS --> APPT
    APPS --> EMB
    APPS --> QUEUE
    SSE --> QUEUE
    DECAY --> APPT
    DECAY --> QUEUE
    QUEUE --> TRANS
    QUEUE --> APPT
```

---

## 🗄 Database Schema

The schema is applied automatically at startup via idempotent SQL migrations.

### Table: `users`
_(created by `002_auth.sql`)_

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated |
| `email` | TEXT UNIQUE | Login identifier |
| `password_hash` | TEXT | bcrypt hash (10 rounds) |
| `role` | TEXT | `'student'` or `'recruiter'` |
| `name` | TEXT | Display name |
| `company_name` | TEXT | Recruiters only (optional) |
| `company_details` | TEXT | Recruiters only (optional) |
| `created_at` | TIMESTAMPTZ | Auto |

### Table: `jobs`
_(created by `001_init.sql`, extended by `002_auth.sql`)_

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated |
| `title` | TEXT | Job title |
| `description` | TEXT | Full job description |
| `active_capacity` | INT | Max simultaneous active-review slots |
| `required_skills` | JSONB | e.g. `["React", "PostgreSQL"]` |
| `jd_embedding` | vector(384) | Embedded JD for semantic scoring |
| `ack_window_hours` | INT | Hours before an unacknowledged slot decays (default 24) |
| `status` | TEXT | `'open'` / `'closed'` |
| `recruiter_id` | UUID → users | Owner |
| `opening_date` | TIMESTAMPTZ | When the job opens |
| `closing_date` | TIMESTAMPTZ | When the job closes (optional) |
| `threshold_score` | FLOAT | Min score (0–1 internally, entered as 0–100 in the UI) to appear in waitlist view |

### Table: `skill_embeddings`
_(one row per skill per job)_

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | Auto |
| `job_id` | UUID → jobs | Cascades on delete |
| `skill_name` | TEXT | e.g. `"React"` |
| `embedding` | vector(384) | Embedded skill phrase |

### Table: `applicants`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto |
| `job_id` | UUID → jobs | |
| `user_id` | UUID → users | The student who applied |
| `name` | TEXT | |
| `email` | TEXT | |
| `resume_text` | TEXT | Extracted from PDF |
| `resume_embedding` | vector(384) | Whole-resume embedding |
| `skill_match_score` | FLOAT | 0–1, weighted 60% |
| `semantic_score` | FLOAT | 0–1, weighted 40% |
| `final_score` | FLOAT | Composite score (can decay) |
| `original_score` | FLOAT | Score locked at insert — used for decay math |
| `decay_count` | INT | Number of decay cycles gone through |
| `status` | TEXT | See [State Machine](#-applicant-status-state-machine) |
| `promoted_at` | TIMESTAMPTZ | When moved to active_review |
| `ack_deadline` | TIMESTAMPTZ | Deadline to acknowledge (or slot decays) |
| `acknowledged_at` | TIMESTAMPTZ | When student confirmed |
| `resume_file_path` | TEXT | Path on backend disk |
| `created_at` | TIMESTAMPTZ | Application timestamp |

### Table: `state_transitions` (Audit Log)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `applicant_id` | UUID → applicants | |
| `job_id` | UUID → jobs | |
| `from_status` | TEXT | Previous state |
| `to_status` | TEXT | New state |
| `reason` | TEXT | Machine reason string |
| `metadata` | JSONB | Extra data (scores, timestamps etc.) |
| `created_at` | TIMESTAMPTZ | Event timestamp |

### Indexes

| Index | Columns | Type | Purpose |
|---|---|---|---|
| `idx_applicants_job_status_score` | `(job_id, status, final_score DESC)` | B-tree | Fast waitlist queries |
| `idx_applicants_ack_deadline` | `(ack_deadline) WHERE status='active_review'` | Partial B-tree | Fast expiry scan |
| `idx_applicants_embedding_hnsw` | `resume_embedding vector_cosine_ops` | HNSW | cosine similarity search |
| `idx_skill_embeddings_job` | `(job_id)` | B-tree | Skill lookup per job |

---

## ⚙️ Backend Processing — Step by Step

### Step 1 — Startup & Migrations

When the server boots (`node server.js`), the `start()` function runs three sequential tasks before accepting any requests:

```
server.js: start()
  │
  ├─ 1. migrate()          ← runs ALL .sql files in /migrations in sorted order
  │    ├── 001_init.sql    ← CREATE EXTENSION vector; CREATE TABLE jobs, applicants, etc.
  │    └── 002_auth.sql    ← CREATE TABLE users; ALTER TABLE jobs/applicants
  │
  ├─ 2. warmup()           ← downloads + loads ONNX model into memory
  │
  └─ 3. app.listen(5000)   ← server is now ready
```

**Why migrations run first:** The SQL uses `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`, making them safe to re-run on every restart with no side effects.

```
console output:
Running database migrations...
✅  Migration 001_init.sql applied successfully.
✅  Migration 002_auth.sql applied successfully.
Warming up embedding model...
✅  Embedding model ready.
✅  Server running on port 5000
```

---

### Step 2 — Embedding Model Warmup

```mermaid
sequenceDiagram
    participant S as server.js
    participant E as embeddings.js
    participant X as @xenova/transformers

    S->>E: warmup()
    E->>X: import { pipeline }
    X-->>E: pipeline factory loaded
    E->>X: pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true })
    X-->>E: ONNX model in memory (singleton)
    E->>X: getEmbedding('warmup') — dummy run
    X-->>E: [0.013, -0.042, ...] (384 floats)
    E-->>S: ✅ model ready
```

The model (`all-MiniLM-L6-v2`) is a compact but powerful **sentence embedding model** that converts any text into a **384-dimensional float vector**. It runs entirely locally — no external API calls.

- Uses mean-pooling + L2 normalization so all vectors live on the unit sphere.
- Quantized ONNX weights reduce memory usage and startup time.
- The singleton pattern (`if (!pipeline)`) ensures the model is only loaded once, even under concurrent requests.

---

### Step 3 — Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant A as auth.js (route)
    participant DB as PostgreSQL users

    Note over C,DB: REGISTRATION
    C->>A: POST /auth/register { email, password, role, name }
    A->>A: bcrypt.genSalt(10) + bcrypt.hash(password)
    A->>DB: INSERT INTO users (email, password_hash, role, name, ...)
    DB-->>A: { id, email, role, name }
    A->>A: jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '7d' })
    A-->>C: { user, token: "eyJ..." }

    Note over C,DB: LOGIN
    C->>A: POST /auth/login { email, password }
    A->>DB: SELECT * FROM users WHERE email = $1
    DB-->>A: user row
    A->>A: bcrypt.compare(password, password_hash)
    A-->>C: { user, token: "eyJ..." }

    Note over C,DB: PROTECTED ROUTE
    C->>A: Any protected endpoint + Authorization: Bearer eyJ...
    A->>A: authenticateToken middleware: jwt.verify(token, JWT_SECRET)
    A->>A: req.user = { id, role } decoded from JWT
    A-->>C: Proceeds to route handler
```

**Key design choices:**
- Passwords are hashed with `bcrypt` (10 rounds). The hash is never returned in API responses.
- JWT payload carries only `{ id, role }` — just enough for authorization checks without hitting the DB on every request.
- Tokens expire in **7 days**.
- Role check (`req.user.role !== 'recruiter'`) is enforced directly in each route handler.

---

### Step 4 — Job Posting Pipeline

When a recruiter creates a job (`POST /jobs`), the backend embeds the full JD **and** each individual skill:

```mermaid
flowchart TD
    A["Recruiter sends POST /jobs\n{title, description, capacity, skills[]}"] --> B{Role check\nreq.user.role === 'recruiter'?}
    B -->|No| E1["403 Forbidden"]
    B -->|Yes| C["getEmbedding(description)\n→ jdVec (384 floats)"]
    C --> D["INSERT INTO jobs\n(title, description, capacity, required_skills,\njd_embedding=toVec(jdVec), ack_window_hours,\nrecruiter_id, threshold_score, ...)"]
    D --> F["For each skill in skills[]:\n  getEmbedding(skill) → vec\n  INSERT INTO skill_embeddings\n  (job_id, skill_name, embedding)"]
    F --> G["Return { job row + _id alias }"]
```

**Why embed each skill separately?**  
Individual skill embeddings allow per-skill chunk matching during resume scoring. A resume may not mention "React" verbatim, but a statement like *"built single-page apps with a component library"* will have high cosine similarity to the "React" skill vector.

---

### Step 5 — Resume Submission & Scoring

This is the most complex flow in the system. When a student submits an application (`POST /applicants`):

```mermaid
flowchart TD
    A["Student sends multipart/form-data\n{jobId, name, resume: PDF file}"] --> B{Role check:\nstudent?}
    B -->|No| E1["403 Forbidden"]
    B -->|Yes| C["Multer saves PDF to /uploads/\n{timestamp}-{random}-filename.pdf"]
    C --> D["fs.readFileSync + pdf-parse\n→ resume_text (raw string)"]
    D --> E{resume_text empty?}
    E -->|Yes| E2["400: Could not extract text"]
    E -->|No| F["getEmbedding(resume_text)\n→ resumeVec (384 floats)"]
    F --> G["getChunkEmbeddings(resume_text)\nSplit on sentence boundaries (.!?\\n)\nFilter chunks > 15 chars\n→ chunkVecs[]"]
    G --> H["DB: SELECT job + jd_embedding + skill_vecs\nFROM jobs LEFT JOIN skill_embeddings"]
    H --> I1["Semantic Score =\ncosineSimilarity(resumeVec, jdVec)"]
    H --> I2["Skill Score =\nscoreSkillMatch(chunkVecs, skillVecs)"]
    I1 --> J["Final Score =\n(skillScore × 0.6) + (semanticScore × 0.4)"]
    I2 --> J
    J --> K["⚡ db.transaction() + pg_advisory_xact_lock(jobId)"]
    K --> L["COUNT active_review + acknowledged seats"]
    L --> M{slots > 0?}
    M -->|Yes| N1["status = 'active_review'\nack_deadline = NOW() + ack_window_hours"]
    M -->|No| N2["status = 'waitlisted'"]
    N1 --> O["INSERT INTO applicants (all fields)"]
    N2 --> O
    O --> P["logTransition: null → status,\nreason='application_submitted'"]
    P --> Q["queueEvents.emit('state_change')"]
    Q --> R["Return { id, status, final_score,\nskill_match_score, semantic_score }"]
```

---

### Step 6 — Seat Allocation with Advisory Locks

The system must never exceed `active_capacity` simultaneous active-review applicants. To prevent race conditions under concurrent submissions, it uses **PostgreSQL advisory transaction locks**:

```mermaid
sequenceDiagram
    participant T1 as Transaction 1
    participant T2 as Transaction 2 (concurrent)
    participant PG as PostgreSQL

    T1->>PG: SELECT pg_advisory_xact_lock(hashtext('job-uuid'))
    Note over PG: Lock acquired by T1
    T2->>PG: SELECT pg_advisory_xact_lock(hashtext('job-uuid'))
    Note over PG: T2 BLOCKS here — waits for T1

    T1->>PG: COUNT seats occupied
    PG-->>T1: 2 occupied / capacity 3 → 1 slot free
    T1->>PG: INSERT applicant with status='active_review'
    T1->>PG: COMMIT → lock released

    Note over PG: T2 now unblocks
    T2->>PG: COUNT seats occupied
    PG-->>T2: 3 occupied / capacity 3 → 0 slots free
    T2->>PG: INSERT applicant with status='waitlisted'
    T2->>PG: COMMIT
```

The advisory lock key is `hashtext(jobId)` — a deterministic integer per job UUID. This means:
- Two applicants to the **same job** are serialized safely.
- Two applicants to **different jobs** proceed in parallel without blocking each other.

---

### Step 7 — Queue Promotion Engine

`promoteApplicants(jobId)` in `utils/queue.js` fills open slots by promoting the highest-scoring waitlisted applicants. It is called whenever a slot opens (hire, reject, or new application finds leftover slots).

```mermaid
flowchart TD
    A["promoteApplicants(jobId) called"] --> B["SELECT active_capacity, ack_window_hours\nFROM jobs WHERE id = jobId"]
    B --> C["COUNT active_review + acknowledged\n→ occupied, slots = capacity - occupied"]
    C --> D{slots <= 0?}
    D -->|Yes| E["Return — no action needed"]
    D -->|No| F["For i in 0..slots:"]
    F --> G["UPDATE applicants\nSET status='active_review',\npromoted_at=NOW(),\nack_deadline=NOW()+ack_window_hours\nWHERE id = (\n  SELECT id FROM applicants\n  WHERE job_id=? AND status='waitlisted'\n  ORDER BY final_score DESC, created_at ASC\n  FOR UPDATE SKIP LOCKED\n  LIMIT 1\n)\nRETURNING *"]
    G --> H{Row returned?}
    H -->|No — waitlist empty| I["break loop"]
    H -->|Yes| J["logTransition: waitlisted → active_review\nreason='slot_available'"]
    J --> K["queueEvents.emit('promotion', applicant)"]
    K --> F
```

**`FOR UPDATE SKIP LOCKED`** ensures that if two concurrent calls to `promoteApplicants` run simultaneously (e.g., a hire and a rejection arrive at the same millisecond), they each skip rows being promoted by the other — preventing the same applicant from being double-promoted.

---

### Step 8 — Acknowledgement & Decay Cascade

Every promoted applicant must **acknowledge** their spot within `ack_window_hours` (default 24h) or their score decays and the slot is freed.

```mermaid
stateDiagram-v2
    [*] --> active_review : Promoted (slot available)
    active_review --> acknowledged : POST /applicants/:id/acknowledge (student confirms)
    active_review --> decayed : ack_deadline expires (background job)
    acknowledged --> hired : POST /applicants/:id/hire (recruiter)
    active_review --> hired : POST /applicants/:id/hire
    active_review --> rejected : POST /applicants/:id/reject
    acknowledged --> rejected : POST /applicants/:id/reject
    waitlisted --> rejected : POST /applicants/:id/reject
    decayed --> [*] : Out of queue
    hired --> [*] : Terminal
    rejected --> [*] : Terminal
```

**Decay Cascade — runs every 60 seconds** via `setInterval`:

```js
// server.js (simplified)
setInterval(() => runDecayCascade(), 60_000);
```

```mermaid
flowchart TD
    A["⏱ setInterval fires (every 60s)"] --> B["SELECT * FROM applicants\nWHERE status='active_review'\nAND ack_deadline < NOW()"]
    B --> C{Any expired applicants?}
    C -->|No| Z["Return quietly"]
    C -->|Yes| D["For each expired applicant:"]
    D --> E["newDecayCount = decay_count + 1\nnewScore = original_score × 0.9^newDecayCount"]
    E --> F["UPDATE applicants\nSET status='decayed',\ndecay_count=newDecayCount,\nfinal_score=newScore\nWHERE id=applicant.id"]
    F --> G["logTransition: active_review → decayed\nreason='ack_deadline_expired'"]
    G --> H["queueEvents.emit('state_change', decay)"]
    H --> I["Add jobId to toPromote set"]
    I --> D
    I --> J["For each jobId in toPromote:"]
    J --> K["promoteApplicants(jobId)\n→ fills the freed slot from waitlist"]
```

**Decay math:**  
`new_score = original_score × 0.9^decay_count`

The score is always calculated from `original_score` (locked at insert), so it cannot compound incorrectly. A decayed applicant re-enters the waitlist with a reduced score, ensuring fresh, promptly-responding candidates get priority.

---

### Step 9 — Real-time SSE Stream

Every recruiter dashboard maintains a long-lived HTTP connection to `/stream/jobs/:jobId` for live waitlist updates.

```mermaid
sequenceDiagram
    participant C as Client (EventSource)
    participant S as server.js SSE handler
    participant EE as queueEvents (EventEmitter)

    C->>S: GET /stream/jobs/job-uuid
    S-->>C: HTTP 200 Content-Type: text/event-stream (headers flushed)
    Note over S: Sets up heartbeat (every 20s): res.write(': ping\n\n')
    S->>EE: queueEvents.on('promotion', handler)\nqueueEvents.on('state_change', handler)

    Note over EE: Any route handler calls queueEvents.emit(...)
    EE->>S: emit('promotion', { jobId, applicant })
    S->>S: filter: data.jobId === req.params.jobId?
    S-->>C: data: {"type":"promotion","jobId":"...","applicant":{...}}\n\n

    EE->>S: emit('state_change', { jobId, type: 'hired' })
    S-->>C: data: {"type":"state_change","jobId":"...","type":"hired"}\n\n

    C->>S: Connection close (browser tab closed)
    S->>EE: queueEvents.off('promotion', handler)
    S->>EE: queueEvents.off('state_change', handler)
    Note over S: clearInterval(heartbeat)
```

Events emitted by the system:

| Event | Emitted when | Payload |
|---|---|---|
| `promotion` | Applicant moves to `active_review` | `{ jobId, applicant }` |
| `state_change` | Any status change (hire, reject, decay, new application) | `{ jobId, type }` |

---

### Step 10 — Audit Log

Every status change in the system — whether triggered by a student, recruiter, or the background decay job — is recorded in `state_transitions`:

```js
// utils/queue.js
await logTransition(
  applicantId, jobId,
  fromStatus,  toStatus,
  reason,      { ...extraMetadata }
);
```

| Reason string | Triggered by |
|---|---|
| `application_submitted` | `POST /applicants` |
| `slot_available` | `promoteApplicants()` |
| `user_acknowledged` | `POST /applicants/:id/acknowledge` |
| `recruiter_hired` | `POST /applicants/:id/hire` |
| `recruiter_rejected` | `POST /applicants/:id/reject` |
| `ack_deadline_expired` | Background decay job |

Retrieve the full audit trail: `GET /jobs/:id/transitions`

---

## 🧮 Scoring Algorithm Deep-Dive

The final score is a **weighted composite** of two independent signals, returned **out of 100**:

```
Final Score = ((Skill Match Score × 0.6) + (Semantic Score × 0.4)) × 100
```

> Scores are stored internally as 0–1 floats in PostgreSQL for efficient comparison against `threshold_score`. All API responses normalize to 0–100.

### Semantic Score (40% weight)

Measures how much the **overall resume** matches the **overall job description**:

```
Semantic Score = cosine_similarity(resume_embedding, jd_embedding)
```

Both are 384-dim vectors from the same MiniLM model, so their dot product on the unit sphere is directly comparable.

### Skill Match Score (60% weight)

Measures how well the **resume covers each required skill**, using sentence-level chunk matching:

```mermaid
flowchart LR
    R["Resume text"] --> SC["Split into sentence chunks\n(on .!?\\n boundaries)"]
    SC --> CE["Embed each chunk\n→ chunkVecs[]"]
    J["Job skills[]"] --> SE["skill_embeddings table\n(one vec per skill)"]
    CE --> SM["scoreSkillMatch(chunkVecs, skillVecs)"]
    SE --> SM
    SM --> NS["For each skill:\n  maxSim = max cosine_sim(chunk, skill)\n  ≥0.92 → 1.0 (exact match)\n  ≥0.75 → 0.8 (similar)\n  ≥0.60 → 0.4 (loosely related)\n  <0.60 → 0.0 (no match)"]
    NS --> AVG["Skill Score = sum(matches) / num_skills"]
```

**Why chunks?** A full resume embedding averages over all content, diluting specific skill signals. Sentence-level chunks capture targeted statements like *"deployed microservices with Kubernetes"* with much higher fidelity.

---

## 🔄 Applicant Status State Machine

```mermaid
stateDiagram-v2
    direction LR
    [*] --> waitlisted : Apply (no slots free)
    [*] --> active_review : Apply (slot available)
    waitlisted --> active_review : promoteApplicants() — slot freed
    active_review --> acknowledged : Student acknowledges
    active_review --> decayed : ack_deadline expires (background job every 60s)
    decayed --> waitlisted : Re-enters queue with reduced score
    active_review --> hired : Recruiter hires
    acknowledged --> hired : Recruiter hires
    active_review --> rejected : Recruiter rejects
    acknowledged --> rejected : Recruiter rejects
    waitlisted --> rejected : Recruiter rejects
```

---

## 📡 API Reference

All protected routes require: `Authorization: Bearer <token>`

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | None | Create account (student or recruiter) |
| `POST` | `/auth/login` | None | Receive JWT token |

**Register body:**
```json
{
  "email": "jane@example.com",
  "password": "secret",
  "name": "Jane Doe",
  "role": "student",
  "company_name": "Acme",
  "company_details": "Tech company"
}
```

**Login body:**
```json
{ "email": "jane@example.com", "password": "secret" }
```

---

### Jobs

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/jobs` | None | List all jobs (`?search=keyword`) |
| `POST` | `/jobs` | Recruiter | Create job + embed JD + skills |
| `GET` | `/jobs/:id/waitlist` | None | All applicants for a job (filtered by threshold_score) |
| `GET` | `/jobs/:id/transitions` | None | Audit log for a job |
| `GET` | `/stream/jobs/:jobId` | None | SSE live stream |

**POST /jobs body:**
```json
{
  "title": "Software Engineer",
  "description": "We are looking for...",
  "capacity": 3,
  "skills": ["React", "Node.js", "PostgreSQL"],
  "ack_window_hours": 24,
  "threshold_score": 0.65,
  "opening_date": "2025-01-01",
  "closing_date": "2025-12-31"
}
```

---

### Applicants

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/applicants` | Student | Submit PDF resume |
| `POST` | `/applicants/:id/acknowledge` | None | Student confirms their slot |
| `POST` | `/applicants/:id/hire` | None | Recruiter hires → frees slot |
| `POST` | `/applicants/:id/reject` | None | Recruiter rejects → frees slot |
| `GET` | `/applicants/:id/position` | None | Waitlist position & deadline |

**POST /applicants — multipart/form-data:**
```
jobId:  <uuid>
name:   Jane Doe
resume: <PDF file>
```

**POST /applicants response:**
```json
{
  "id": "a1b2c3...",
  "status": "active_review",
  "final_score": 82.00,
  "skill_match_score": 88.00,
  "semantic_score": 73.00
}
```

**GET /applicants/:id/position response:**
```json
{
  "position": 3,
  "total_waitlisted": 10,
  "status": "waitlisted",
  "ack_deadline": null
}
```

---

## 🔐 Environment Variables

Create a `.env` file in the project root (and optionally in `backend/`):

```env
DATABASE_URL=postgresql://postgres:ats@localhost:5432/ats
PORT=5000
JWT_SECRET=your_super_secret_key_here
```

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:ats@localhost:5432/ats` | Full PostgreSQL connection string |
| `PORT` | `5000` | Express server port |
| `JWT_SECRET` | `fallback_secret_key_repalce_in_prod` | JWT signing secret — **change in production!** |

---

## 🚀 Running Locally

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL)

### Step 1 — Start PostgreSQL via Docker

```bash
docker-compose up postgres -d
```

This starts `pgvector/pgvector:pg16` with:
- Database: `ats`
- User: `postgres`
- Password: `ats`
- Port: `5432`

Wait for the health check to pass:
```bash
docker ps   # ats_postgres should show (healthy)
```

### Step 2 — Configure Environment

```bash
# In the project root
copy .env.example .env   # or create manually
```

Ensure `.env` contains:
```env
DATABASE_URL=postgresql://postgres:ats@localhost:5432/ats
PORT=5000
JWT_SECRET=change_me_in_production
```

### Step 3 — Install & Start Backend

```bash
cd backend
npm install
npm run dev
```

On first start you will see:
```
Running database migrations...
✅  Migration 001_init.sql applied successfully.
✅  Migration 002_auth.sql applied successfully.
Warming up embedding model...
✅  Embedding model ready.
✅  Server running on port 5000
```

> ⚠️ **First startup note:** The embedding model (~22 MB) downloads from HuggingFace Hub. This takes 10–30 seconds on first run. Subsequent starts use the cached model.

### Step 4 — Install & Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend available at: **http://localhost:5173**

---

## 🐳 Running with Docker

To run the **entire stack** (PostgreSQL + backend + frontend) in containers:

```bash
# From the project root
docker-compose up --build
```

| Container | Port | Description |
|---|---|---|
| `ats_postgres` | 5432 | PostgreSQL 16 + pgvector |
| `ats_backend` | 5000 | Express API server |
| `ats_frontend` | 5173 | React Vite dev server |

The backend container waits for PostgreSQL to pass its health check before starting, preventing connection errors on cold boot.

To stop everything:
```bash
docker-compose down
```

To also wipe the database volume:
```bash
docker-compose down -v
```

---

## 📂 Folder-by-Folder Reference

### `backend/server.js`
The single-file Express application. Contains all route handlers plus the background decay scheduler. Key sections:

| Lines | Section |
|---|---|
| 1–12 | Imports: dotenv, express, cors, pgvector, multer, pdf-parse, db, migrate, utils |
| 14–26 | Multer disk storage config (saves to `./uploads/`) |
| 39–49 | `start()` — migrations → warmup → listen |
| 56–66 | `toVec()` / `fromVec()` helpers for pgvector serialization |
| 73–112 | `POST /jobs` — create job + embed JD + skills |
| 115–136 | `GET /jobs` — list jobs with optional search |
| 143–268 | `POST /applicants` — full resume scoring + atomic insert |
| 272–294 | `POST /applicants/:id/acknowledge` |
| 297–322 | `POST /applicants/:id/hire` |
| 325–353 | `POST /applicants/:id/reject` |
| 356–396 | `GET /applicants/:id/position` |
| 403–442 | `GET /jobs/:id/waitlist` |
| 445–461 | `GET /jobs/:id/transitions` — audit log |
| 466–492 | `GET /stream/jobs/:jobId` — SSE handler |
| 497–542 | `runDecayCascade()` — decay expired applicants |
| 545–547 | `setInterval(runDecayCascade, 60_000)` |

### `backend/db.js`
PostgreSQL connection pool (`pg.Pool`) and transaction wrapper. The `db.transaction(callback)` helper automatically handles `BEGIN` / `COMMIT` / `ROLLBACK` and releases the client.

### `backend/utils/embeddings.js`
| Export | Description |
|---|---|
| `warmup()` | Loads model singleton + runs dummy inference |
| `getEmbedding(text)` | Single text → 384-dim float array |
| `getChunkEmbeddings(text)` | Splits by sentence → array of 384-dim arrays |
| `cosineSimilarity(vecA, vecB)` | Pure JS dot-product cosine similarity |
| `scoreSkillMatch(chunkVecs, skillVecs)` | Graduated per-skill match → normalized [0,1] |

### `backend/utils/queue.js`
| Export | Description |
|---|---|
| `queueEvents` | Node.js `EventEmitter` — backbone of SSE broadcasts |
| `logTransition(...)` | Inserts row into `state_transitions` |
| `promoteApplicants(jobId)` | Fills open slots from waitlist using `FOR UPDATE SKIP LOCKED` |

### `backend/migrations/`
| File | Description |
|---|---|
| `migrate.js` | Reads all `.sql` files in sorted order and runs them via `db.query()`. Called at startup and can be run manually with `npm run migrate`. |
| `001_init.sql` | Enables `pgvector`, creates `jobs`, `skill_embeddings`, `applicants`, `state_transitions` tables and all indexes including HNSW. |
| `002_auth.sql` | Creates `users` table and adds `recruiter_id`, `user_id`, `opening_date`, `closing_date`, `threshold_score`, `resume_file_path` columns. |

### `backend/routes/auth.js`
Exports `router` (mounted at `/auth`) and `authenticateToken` middleware used in `server.js` to gate protected routes.

---

## 🧪 Quick Test (curl)

```bash
# 1. Register a recruiter
curl -X POST http://localhost:5000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"rec@company.com","password":"pass123","role":"recruiter","name":"Alice"}'

# 2. Login and grab token
TOKEN=$(curl -s -X POST http://localhost:5000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"rec@company.com","password":"pass123"}' | jq -r '.token')

# 3. Create a job
curl -X POST http://localhost:5000/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Backend Dev","description":"Node.js and PostgreSQL experience required","capacity":2,"skills":["Node.js","PostgreSQL"]}'

# 4. Register a student and apply
curl -X POST http://localhost:5000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"stu@uni.edu","password":"pass123","role":"student","name":"Bob"}'

STOKEN=$(curl -s -X POST http://localhost:5000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"stu@uni.edu","password":"pass123"}' | jq -r '.token')

curl -X POST http://localhost:5000/applicants \
  -H "Authorization: Bearer $STOKEN" \
  -F "jobId=<job-id-from-step-3>" \
  -F "name=Bob" \
  -F "resume=@/path/to/resume.pdf"
```

---

*Built with ❤️ using Node.js, PostgreSQL + pgvector, and local AI embeddings.*
