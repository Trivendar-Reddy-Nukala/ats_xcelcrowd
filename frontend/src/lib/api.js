import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5000'
});

// Jobs
export const getJobs        = ()     => api.get('/jobs').then(r => r.data);
export const createJob      = (data) => api.post('/jobs', data).then(r => r.data);

// Applicants
export const submitApplicant    = (data) => api.post('/applicants', data).then(r => r.data);
export const acknowledgeApplicant = (id) => api.post(`/applicants/${id}/acknowledge`).then(r => r.data);
export const hireApplicant      = (id)   => api.post(`/applicants/${id}/hire`).then(r => r.data);
export const rejectApplicant    = (id)   => api.post(`/applicants/${id}/reject`).then(r => r.data);
export const getPosition        = (id)   => api.get(`/applicants/${id}/position`).then(r => r.data);

// Admin
export const getWaitlist    = (jobId) => api.get(`/jobs/${jobId}/waitlist`).then(r => r.data);
export const getTransitions = (jobId) => api.get(`/jobs/${jobId}/transitions`).then(r => r.data);

// SSE — returns the EventSource so the caller can close it on unmount
export const listenWaitlist = (jobId, onEvent) => {
  const eventSource = new EventSource(`http://localhost:5000/stream/jobs/${jobId}`);
  eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    onEvent(data);
  };
  eventSource.onerror = (err) => {
    console.warn('SSE connection error — will reconnect automatically', err);
  };
  return eventSource;
};
