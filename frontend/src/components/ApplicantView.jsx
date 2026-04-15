import React, { useState, useEffect, useCallback } from 'react';
import { getJobs, submitApplicant, getWaitlist, listenWaitlist, acknowledgeApplicant, getPosition } from '../lib/api';
import { UploadCloud, CheckCircle, RefreshCcw, Bell, TrendingDown, Trophy, XCircle, Search, FileText } from 'lucide-react';

const STATUS_META = {
  waitlisted:    { label: 'Waitlisted',    color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  active_review: { label: 'Active Review', color: 'bg-accent/20 text-accent border-accent/50 animate-pulse' },
  acknowledged:  { label: 'Acknowledged',  color: 'bg-green-500/20 text-green-400 border-green-500/50' },
  decayed:       { label: 'Decayed',       color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  hired:         { label: 'Hired 🎉',      color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' },
  rejected:      { label: 'Rejected',      color: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

export default function ApplicantView() {
  const [jobs, setJobs]             = useState([]);
  const [search, setSearch]         = useState('');
  const [activeJobId, setActiveJobId] = useState(null);

  const [name, setName]           = useState('');
  const [resumeFile, setResumeFile] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const [myStatus, setMyStatus]   = useState(null);
  const [myId, setMyId]           = useState(null);
  const [myScore, setMyScore]     = useState(null);
  const [position, setPosition]   = useState(null);

  useEffect(() => {
    const delay = setTimeout(() => {
      getJobs(search).then(data => {
        setJobs(data);
      });
    }, 300);
    return () => clearTimeout(delay);
  }, [search]);

  const activeJob = jobs.find(j => (j.id || j._id) === activeJobId);

  const fetchPosition = useCallback(async () => {
    if (!myId) return;
    try {
      const pos = await getPosition(myId);
      setPosition(pos);
      setMyStatus(pos.status);
    } catch (err) {
      if (!activeJobId) return;
      const waitlist = await getWaitlist(activeJobId);
      const idx = waitlist.findIndex(w => (w.id || w._id) === myId);
      if (idx !== -1) {
        setMyStatus(waitlist[idx].status);
        setPosition({ position: idx + 1, total_waitlisted: waitlist.filter(w => w.status === 'waitlisted').length });
      }
    }
  }, [myId, activeJobId]);

  useEffect(() => {
    if (!activeJobId || !myId) return;

    fetchPosition();

    const es = listenWaitlist(activeJobId, (data) => {
      setTimeout(fetchPosition, 500);
      if (data.type === 'promotion' && (data.applicant?.id === myId || data.applicant?._id === myId)) {
        setMyStatus('active_review');
      }
    });

    return () => es.close();
  }, [activeJobId, myId, fetchPosition]);

  // Reset form when clicking a different job
  useEffect(() => {
    setMyId(null);
    setMyStatus(null);
    setMyScore(null);
    setPosition(null);
    setResumeFile(null);
    setError(null);
  }, [activeJobId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeJobId || !name || !resumeFile) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('jobId', activeJobId);
      formData.append('name', name);
      formData.append('resume', resumeFile);

      const res = await submitApplicant(formData);
      setMyId(res.id || res._id);
      setMyStatus(res.status);
      setMyScore(res);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || err.message);
    }
    setLoading(false);
  };

  const handleAcknowledge = async () => {
    try {
      const res = await acknowledgeApplicant(myId);
      setMyStatus(res.applicant.status);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || err.message);
    }
  };

  const statusInfo = STATUS_META[myStatus] || { label: myStatus, color: 'bg-gray-500/20 text-gray-300' };

  return (
    <div className="flex gap-8 max-w-7xl mx-auto w-full flex-col lg:flex-row animate-fade-in">
      {/* Sidebar: Job Board */}
      <div className="w-full lg:w-[400px] flex flex-col gap-4">
        <div className="glass-panel p-6">
          <h2 className="text-xl font-bold mb-4">Job Board</h2>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Search jobs..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="glass-input pl-10 w-full"
            />
          </div>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
            {jobs.length === 0 && <p className="text-gray-500 text-sm italic">No jobs found.</p>}
            {jobs.map(job => {
               const jid = job.id || job._id;
               const isActive = activeJobId === jid;
               return (
                 <div 
                   key={jid} 
                   onClick={() => setActiveJobId(jid)}
                   className={`p-4 rounded-xl border cursor-pointer transition-all ${isActive ? 'bg-primary/20 border-primary/50 text-white' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                 >
                   <div className="font-semibold">{job.title}</div>
                   <div className="text-xs mt-2 line-clamp-2 text-gray-400">{job.description}</div>
                   <div className="mt-3 flex gap-2 flex-wrap">
                     {job.skills?.slice(0, 3).map((s, i) => (
                       <span key={i} className="text-[10px] bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">{s}</span>
                     ))}
                   </div>
                 </div>
               )
            })}
          </div>
        </div>
      </div>

      {/* Main Panel: Application */}
      <div className="flex-1 space-y-6">
        {!activeJobId ? (
          <div className="glass-panel flex flex-col items-center justify-center p-16 text-gray-500 text-center min-h-[400px]">
             <Search size={48} className="mb-4 opacity-30" />
             <p className="text-xl font-medium text-white mb-2">Find your next role</p>
             <p>Select a job from the list to view details and apply.</p>
          </div>
        ) : (
          <div className="glass-panel p-8">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-3 bg-primary/20 rounded-xl text-primary">
                <UploadCloud size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Apply Now</h2>
                <p className="text-gray-400 text-sm">Applying for {activeJob?.title}</p>
              </div>
            </div>

            {/* Description */}
            <div className="mb-8 p-4 bg-dark/50 border border-white/5 rounded-xl text-sm text-gray-300">
              <p className="whitespace-pre-wrap">{activeJob?.description}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                <input
                  type="text"
                  className="glass-input w-full"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Jane Doe"
                  required
                  disabled={!!myId}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Resume (PDF Only)</label>
                {!myId ? (
                  <label className="flex items-center gap-3 w-full cursor-pointer bg-dark/50 hover:bg-darker border border-dashed border-white/20 rounded-xl p-4 transition-colors">
                    <FileText className="text-primary" />
                    <span className="text-gray-400 font-medium">
                      {resumeFile ? resumeFile.name : 'Click to select or drag and drop a PDF file'}
                    </span>
                    <input 
                      type="file" 
                      accept="application/pdf" 
                      className="hidden" 
                      onChange={e => setResumeFile(e.target.files[0])}
                      required
                    />
                  </label>
                ) : (
                  <div className="flex items-center gap-3 w-full bg-darker border border-white/10 rounded-xl p-4">
                    <CheckCircle className="text-green-500" />
                    <span className="text-gray-400 font-medium line-through">PDF Uploaded Successfully</span>
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded-lg">
                  {error}
                </div>
              )}

              <button
                disabled={loading || !activeJobId || !!myId}
                type="submit"
                className="btn-primary w-full flex justify-center items-center gap-2 mt-4"
              >
                {loading
                  ? <><RefreshCcw size={18} className="animate-spin" /><span>Extracting Text & Scoring...</span></>
                  : myId
                    ? <span>Application Submitted ✓</span>
                    : <span>Submit Application</span>
                }
              </button>
            </form>

            {myScore && (
              <div className="mt-6 p-4 bg-darker rounded-xl border border-white/10 space-y-2">
                <div className="text-xs text-gray-500 uppercase tracking-widest font-semibold">Score Breakdown (Internal ATS Matching)</div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Skill Match</span>
                  <span className="font-mono font-bold text-primary">
                    {((myScore.skill_match_score || 0) * 100).toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Semantic</span>
                  <span className="font-mono font-bold text-secondary">
                    {((myScore.semantic_score || 0) * 100).toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-t border-white/10 pt-2">
                  <span className="text-gray-300 font-semibold">Composite final score</span>
                  <span className="font-mono font-black text-white text-base">
                    {((myScore.final_score || 0) * 100).toFixed(1)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status Tracker */}
        {myId && (
          <div className={`glass-panel p-8 transition-all border-primary/50 shadow-primary/20`}>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Bell size={20} className={myStatus === 'active_review' ? 'text-accent animate-pulse' : 'text-gray-500'} />
              Waitlist Status Tracker
            </h2>

            <div className="space-y-4">
              <div className="bg-darker p-4 rounded-xl border border-white/5 flex justify-between items-center">
                <span className="text-gray-400 font-medium">Status</span>
                <span className={`status-badge border ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
              </div>

              {(myStatus === 'waitlisted' || myStatus === 'decayed') && position && (
                <div className="bg-darker p-6 rounded-xl border border-white/5 text-center">
                  {myStatus === 'decayed' && (
                    <div className="flex items-center justify-center gap-1 text-orange-400 text-xs mb-3">
                      <TrendingDown size={14} /> Score decayed — back in queue
                    </div>
                  )}
                  <p className="text-gray-400 text-sm mb-2">You are currently</p>
                  <div className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
                    #{position.position || '?'}
                  </div>
                  <p className="text-gray-500 text-xs mt-2">
                    of {position.total_waitlisted} in the queue
                  </p>
                </div>
              )}

              {myStatus === 'active_review' && (
                <div className="bg-accent/10 border border-accent/30 p-6 rounded-xl text-center">
                  <h3 className="text-accent font-bold text-lg mb-2">You've been selected for review!</h3>
                  <p className="text-sm text-gray-300 mb-4">
                    A slot has opened up. Acknowledge your spot before the deadline.
                  </p>
                  {position?.ack_deadline && (
                    <p className="text-xs text-accent/70 mb-4">
                      Deadline: {new Date(position.ack_deadline).toLocaleString()}
                    </p>
                  )}
                  <button
                    onClick={handleAcknowledge}
                    className="bg-accent hover:bg-pink-400 text-white font-bold py-2 px-6 rounded-full shadow-lg shadow-accent/40 w-full transition-all active:scale-95"
                  >
                    Acknowledge Spot
                  </button>
                </div>
              )}

              {myStatus === 'acknowledged' && (
                <div className="bg-green-500/10 border border-green-500/30 p-6 rounded-xl text-center flex flex-col items-center">
                  <CheckCircle className="text-green-400 mb-3" size={48} />
                  <h3 className="text-green-400 font-bold text-lg">Spot Confirmed!</h3>
                  <p className="text-sm text-gray-400">The recruiter has been notified.</p>
                </div>
              )}

              {myStatus === 'hired' && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-6 rounded-xl text-center flex flex-col items-center">
                  <Trophy className="text-emerald-400 mb-3" size={48} />
                  <h3 className="text-emerald-400 font-bold text-lg">Congratulations!</h3>
                  <p className="text-sm text-gray-400">You have been hired for this position.</p>
                </div>
              )}

              {myStatus === 'rejected' && (
                <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-xl text-center flex flex-col items-center">
                  <XCircle className="text-red-400 mb-3" size={48} />
                  <h3 className="text-red-400 font-bold text-lg">Not Selected</h3>
                  <p className="text-sm text-gray-400">Thank you for your interest in this position.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
