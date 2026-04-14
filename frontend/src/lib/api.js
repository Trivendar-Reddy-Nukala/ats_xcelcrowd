import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5000'
});

export const getJobs = () => api.get('/jobs').then(r => r.data);
export const createJob = (data) => api.post('/jobs', data).then(r => r.data);
export const submitApplicant = (data) => api.post('/applicants', data).then(r => r.data);
export const acknowledgeApplicant = (id) => api.post(`/applicants/${id}/acknowledge`).then(r => r.data);
export const getWaitlist = (jobId) => api.get(`/jobs/${jobId}/waitlist`).then(r => r.data);

// Also need a function to hook SSE up easily
export const listenWaitlist = (jobId, onEvent) => {
  const eventSource = new EventSource(`http://localhost:5000/stream/jobs/${jobId}`);
  eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    onEvent(data);
  };
  return eventSource;
};
