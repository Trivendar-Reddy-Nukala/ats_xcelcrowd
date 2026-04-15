import React, { useState, useEffect } from 'react';
import { getJobs, createJob, getWaitlist, listenWaitlist, hireApplicant, rejectApplicant } from '../lib/api';
import { Briefcase, Users, Plus, BrainCircuit, Activity, CheckCircle, XCircle } from 'lucide-react';

const STATUS_STYLES = {
  waitlisted:    'bg-gray-500/20 text-gray-300 border-gray-500/30',
  active_review: 'bg-accent/20 text-accent border-accent/50 animate-pulse',
  acknowledged:  'bg-green-500/20 text-green-400 border-green-500/50',
  decayed:       'bg-orange-500/20 text-orange-400 border-orange-500/30',
  hired:         'bg-emerald-500/20 text-emerald-400 border-emerald-500/50',
  rejected:      'bg-red-500/20 text-red-400 border-red-500/30',
};

const ROW_STYLES = {
  active_review: 'bg-accent/10 border-accent/50 shadow-lg shadow-accent/10',
  acknowledged:  'bg-green-500/10 border-green-500/30',
  hired:         'bg-emerald-500/10 border-emerald-500/30',
  rejected:      'bg-red-500/10 border-red-500/20 opacity-60',
  decayed:       'bg-orange-500/10 border-orange-500/20 opacity-70',
  waitlisted:    'bg-white/5 border-white/10',
};

export default function AdminView() {
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [waitlist, setWaitlist]     = useState([]);
  const [showNewJob, setShowNewJob] = useState(true);
  const [creating, setCreating]     = useState(false);
  const [actionId, setActionId]     = useState(null); // id currently being hired/rejected
  const [formData, setFormData]     = useState({
    title:       'Senior Software Engineer',
    capacity:    2,
    description: 'Looking for a Senior Software Engineer with strong experience in Backend systems. You should know Java and PostgreSQL and understand microservices.',
    skills:      'Java, PostgreSQL, microservices',
    threshold_score: 70,
    opening_date: '',
    closing_date: '',
  });

  useEffect(() => {
    getJobs().then(data => {
      setJobs(data);
      if(data.length > 0 && !activeJobId) {
        setActiveJobId(data[0].id || data[0]._id);
        setShowNewJob(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!activeJobId) return;

    const fetchW = () => getWaitlist(activeJobId).then(setWaitlist);
    fetchW();

    const es       = listenWaitlist(activeJobId, () => fetchW());
    const interval = setInterval(fetchW, 5000); // polling fallback

    return () => { es.close(); clearInterval(interval); };
  }, [activeJobId]);

  const handleCreateJob = async (e) => {
    e.preventDefault();
    setCreating(true);
    const skillsArray = formData.skills.split(',').map(s => s.trim()).filter(Boolean);
    try {
      const payload = {
        ...formData,
        skills: skillsArray,
        threshold_score: formData.threshold_score ? parseFloat(formData.threshold_score) / 100 : 0
      };
      if (!payload.opening_date) delete payload.opening_date;
      if (!payload.closing_date) delete payload.closing_date;

      const newJob = await createJob(payload);
      setJobs(prev => [newJob, ...prev]);
      setActiveJobId(newJob.id || newJob._id);
      setShowNewJob(false);
    } catch (err) {
      console.error('Create job error:', err);
      alert('Failed to create job: ' + (err.response?.data?.error || err.message));
    }
    setCreating(false);
  };

  const handleHire = async (id) => {
    setActionId(id);
    try {
      await hireApplicant(id);
      getWaitlist(activeJobId).then(setWaitlist);
    } catch (err) {
      console.error('Hire error:', err);
    }
    setActionId(null);
  };

  const handleReject = async (id) => {
    setActionId(id);
    try {
      await rejectApplicant(id);
      getWaitlist(activeJobId).then(setWaitlist);
    } catch (err) {
      console.error('Reject error:', err);
    }
    setActionId(null);
  };

  const activeJob  = jobs.find(j => (j.id || j._id) === activeJobId);
  const activeCount = waitlist.filter(w => ['active_review', 'acknowledged'].includes(w.status)).length;

  return (
    <div className="flex gap-8 w-full flex-col lg:flex-row animate-fade-in">
      {/* Sidebar */}
      <div className="w-full lg:w-[350px] space-y-6">
        <div className="glass-panel p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Briefcase size={20} className="text-primary" /> My Jobs
            </h2>
            <button
              onClick={() => setShowNewJob(true)}
              className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {jobs.map(job => {
              const jid = job.id || job._id;
              return (
                <div
                  key={jid}
                  onClick={() => { setActiveJobId(jid); setShowNewJob(false); }}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    activeJobId === jid && !showNewJob
                      ? 'bg-primary/20 border-primary/50 text-white'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <div className="font-semibold">{job.title}</div>
                  <div className="text-xs mt-1 flex justify-between text-gray-400">
                    <span>Limit: {job.capacity || job.active_capacity}</span>
                    <span>Filter: {((job.threshold_score || 0)*100).toFixed(0)}</span>
                  </div>
                </div>
              );
            })}
            {jobs.length === 0 && <div className="text-gray-500 text-sm italic">No jobs found</div>}
          </div>
        </div>

        {activeJob && !showNewJob && (
          <div className="glass-panel p-6 bg-gradient-to-br from-darker to-dark">
            <h3 className="font-bold flex items-center gap-2 text-secondary mb-4">
              <Activity size={18} /> Live Tracker
            </h3>
            <div className="space-y-4">
              <div>
                <div className="text-xs text-gray-500 mb-1">Available Slots</div>
                <div className="text-3xl font-black">
                  {Math.max(0, (activeJob.capacity || activeJob.active_capacity) - activeCount)}
                  <span className="text-base font-normal text-gray-500">
                    {' '}/ {activeJob.capacity || activeJob.active_capacity}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-400 italic">
                Only passing candidates ({((activeJob.threshold_score || 0)*100).toFixed(0)}%+) are shown.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Main Panel */}
      <div className="flex-1">
        {showNewJob ? (
          <div className="glass-panel p-8">
            <h2 className="text-2xl font-bold mb-6">Create New Job Posting</h2>
            <form onSubmit={handleCreateJob} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Title</label>
                  <input className="glass-input w-full" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Target Skills (comma separated)</label>
                  <input className="glass-input w-full" value={formData.skills} onChange={e => setFormData({ ...formData, skills: e.target.value })} required />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Candidate Limit</label>
                  <input type="number" min="1" className="glass-input w-full" value={formData.capacity} onChange={e => setFormData({ ...formData, capacity: parseInt(e.target.value) })} required />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">ATS Threshold Filter (0-100)</label>
                  <input type="number" min="0" max="100" className="glass-input w-full" value={formData.threshold_score} onChange={e => setFormData({ ...formData, threshold_score: parseInt(e.target.value) })} required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Opening Date</label>
                  <input type="date" className="glass-input w-full" value={formData.opening_date} onChange={e => setFormData({ ...formData, opening_date: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Closing Date</label>
                  <input type="date" className="glass-input w-full" value={formData.closing_date} onChange={e => setFormData({ ...formData, closing_date: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Description (for Semantic Matching)</label>
                <textarea rows="4" className="glass-input w-full" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} required />
              </div>
              
              <button type="submit" disabled={creating} className="btn-primary w-full mt-4">
                {creating ? 'Generating Vector Embeddings...' : 'Publish Job'}
              </button>
            </form>
          </div>
        ) : (
          <div className="glass-panel p-8 min-h-[500px]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Users className="text-secondary" /> Applied Candidates
              </h2>
              <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-400">
                Filter applied: &ge; {((activeJob?.threshold_score || 0)*100).toFixed(0)}%
              </div>
            </div>

            {waitlist.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-gray-500 text-center border border-dashed border-white/10 rounded-xl">
                <BrainCircuit size={48} className="mb-4 opacity-50" />
                <p>No candidates met the threshold requirements yet.</p>
                <p className="text-sm mt-2">Only candidates scoring above your threshold will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {waitlist.map((w, i) => {
                  const wid = w.id || w._id;
                  const isTerminal = ['hired', 'rejected'].includes(w.status);
                  const isActive   = ['active_review', 'acknowledged'].includes(w.status);
                  return (
                    <div key={wid} className={`p-4 rounded-xl border flex items-center justify-between transition-all ${ROW_STYLES[w.status] || 'bg-white/5 border-white/10'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${w.status === 'waitlisted' ? 'bg-white/10' : 'bg-primary text-white'}`}>
                          #{i + 1}
                        </div>
                        <div>
                          <div className="font-bold flex items-center gap-2 flex-wrap text-white">
                            {w.name}
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLES[w.status] || 'bg-gray-500/20 text-gray-300'}`}>
                              {w.status.replace(/_/g, ' ')}
                            </span>
                            {w.resume_file_path && (
                               <a href={`http://localhost:5000/uploads/${w.resume_file_path.split('-').slice(1).join('-')}`} target="_blank" rel="noreferrer" className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/40">
                                 View PDF
                               </a>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {w.email} · Decay Lvl: {w.decay_count}
                            {w.ack_deadline && isActive && (
                              <span className="ml-2 text-accent">
                                · Deadline: {new Date(w.ack_deadline).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="bg-darker border border-white/10 px-3 py-1 pb-1.5 rounded-lg">
                            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-0.5">Score</div>
                            <div className="font-mono text-xl font-black text-primary leading-none">
                              {(w.final_score * 100).toFixed(1)}
                            </div>
                          </div>
                          <div className="flex gap-2 mt-1 text-[10px] font-mono text-gray-400 justify-end">
                            <span>S:{(w.semantic_score * 100).toFixed(0)}</span>
                            <span>K:{((w.skills_score || w.skill_match_score || 0) * 100).toFixed(0)}</span>
                          </div>
                        </div>

                        {isActive && (
                          <div className="flex flex-col gap-1.5">
                            <button onClick={() => handleHire(wid)} disabled={actionId === wid} title="Hire" className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/40 text-emerald-400 rounded-lg transition-colors disabled:opacity-40"><CheckCircle size={16} /></button>
                            <button onClick={() => handleReject(wid)} disabled={actionId === wid} title="Reject" className="p-1.5 bg-red-500/20 hover:bg-red-500/40 border border-red-500/40 text-red-400 rounded-lg transition-colors disabled:opacity-40"><XCircle size={16} /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
