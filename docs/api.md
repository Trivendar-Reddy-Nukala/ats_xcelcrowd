# ATS API Documentation

This document describes the available REST API endpoints and Server-Sent Events (SSE) streams for the Applicant Tracking System.

## Authentication

All protected routes expect a JWT passed in the `Authorization` header as a Bearer token:
`Authorization: Bearer <your_jwt_here>`

### `POST /auth/register`
Creates a new user account.
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "securepassword",
    "name": "Jane Doe",
    "role": "student | recruiter",
    "company_name": "Acme Corp",     // Optional: For recruiters only
    "company_details": "Tech org"   // Optional: For recruiters only
  }
  ```
- **Response**: `{ user: { id, email, role, name, ... }, token: "jwt_token" }`

### `POST /auth/login`
Authenticates an existing user.
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "securepassword"
  }
  ```
- **Response**: `{ user: { ... }, token: "jwt_token" }`

---

## Jobs

### `GET /jobs`
Fetches a list of jobs. Can be searched using the `search` query parameter.
- **Query Params**: `?search=String`
- **Response**: `[ { id, title, description, capacity, skills, ... } ]`

### `POST /jobs`
Creates a new job posting. Requires `recruiter` authentication.
- **Request Body**:
  ```json
  {
    "title": "Software Engineer",
    "description": "Looking for...",
    "capacity": 3,
    "skills": ["JavaScript", "React"],
    "ack_window_hours": 24,
    "threshold_score": 0.70,
    "opening_date": "2023-11-01",
    "closing_date": "2023-12-01"
  }
  ```
- **Response**: `{ id, title, description, capacity, ... }`

### `GET /jobs/:id/waitlist`
Fetches all applicants for a specific job that meet the minimum threshold requirements.
- **Response**: `[ { applicant_data... } ]`

### `GET /jobs/:id/transitions`
Fetches the immutable pipeline events (audit log) for a specific job.
- **Response**: `[ { id, job_id, applicant_id, from_status, to_status, event_type, created_at, ... } ]`

### `GET /stream/jobs/:jobId`
Opens a Server-Sent Events (SSE) stream for real-time waitlist updates.
- **Stream Events**: `promotion`, `state_change`

---

## Applicants

### `POST /applicants`
Submits a job application with a PDF resume. Extracts the text natively. Requires `student` authentication.
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `jobId`: The ID of the targeted job.
  - `name`: Candidate's name.
  - `resume`: The PDF file.
- **Response**:
  ```json
  {
    "id": 1,
    "status": "active_review | waitlisted",
    "final_score": 0.82,
    "skill_match_score": 0.88,
    "semantic_score": 0.73
  }
  ```

### `POST /applicants/:id/acknowledge`
Confirms a promoted spot in `active_review` before the deadline decays the score.
- **Response**: `{ success: true, applicant: { ... } }`

### `POST /applicants/:id/hire`
Recruiter action to securely hire an applicant and trigger the pipeline.
- **Response**: `{ success: true, applicant: { ... } }`

### `POST /applicants/:id/reject`
Recruiter action to gracefully reject an applicant and potentially trigger a cascade queue promotion if a seat is freed.
- **Response**: `{ success: true, applicant: { ... } }`

### `GET /applicants/:id/position`
Fetches the current dynamic queue standing of a waitlisted applicant to populate realtime UI visualizations.
- **Response**:
  ```json
  {
    "position": 3,
    "total_waitlisted": 10,
    "status": "waitlisted",
    "ack_deadline": null
  }
  ```
