import React, { useState, useEffect, useCallback } from 'react';
import { submitApplicant, getWaitlist, listenWaitlist, acknowledgeApplicant, getPosition } from '../lib/api';
import { UploadCloud, CheckCircle, RefreshCcw, Bell, TrendingDown, Trophy, XCircle } from 'lucide-react';

const STATUS_META = {
  waitlisted:    { label: 'Waitlisted',    color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  active_review: { label: 'Active Review', color: 'bg-accent/20 text-accent border-accent/50 animate-pulse' },
  acknowledged:  { label: 'Acknowledged',  color: 'bg-green-500/20 text-green-400 border-green-500/50' },
  decayed:       { label: 'Decayed',       color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  hired:         { label: 'Hired 🎉',      color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' },
  rejected:      { label: 'Rejected',      color: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

export default function ApplicantView({ jobs, activeJobId }) {
  const [name, setName]           = useState('');
  const [resumeText, setResumeText] = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const [myStatus, setMyStatus]   = useState(null);
  const [myId, setMyId]           = useState(null);
  const [myScore, setMyScore]     = useState(null);
  const [position, setPosition]   = useState(null); // { position, total_waitlisted, ack_deadline }

  const activeJob = jobs.find(j => (j.id || j._id) === activeJobId);

  // Fetch queue position from the dedicated endpoint
  const fetchPosition = useCallback(async () => {
    if (!myId) return;
    try {
      const pos = await getPosition(myId);
      setPosition(pos);
      setMyStatus(pos.status);
    } catch (err) {
      // fallback: scan waitlist
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeJobId || !name || !resumeText) return;
    setLoading(true);
    setError(null);
    try {
      const res = await submitApplicant({ jobId: activeJobId, name, resume_text: resumeText });
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
    <div className="flex gap-8 max-w-5xl mx-auto w-full flex-col md:flex-row">

      {/* Application Form */}
      <div className="flex-1 animate-fade-in">
        <div className="glass-panel p-8">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-3 bg-primary/20 rounded-xl text-primary">
              <UploadCloud size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Apply Now</h2>
              <p className="text-gray-400 text-sm">Applying for {activeJob?.title || 'Loading...'}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
              <input
                type="text"
                className="glass-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Doe"
                required
                disabled={!!myId}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Resume Text</label>
              <textarea
                rows="8"
                className="glass-input font-mono text-xs whitespace-pre"
                value={resumeText}
                onChange={e => setResumeText(e.target.value)}
                placeholder={`Paste your plain text resume here...\nEnsure skills like Java, PostgreSQL are visible.\n\nTip: more detailed resumes score better with chunk-based matching.`}
                required
                disabled={!!myId}
              />
            </div>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded-lg">
                {error}
              </div>
            )}
            <button
              disabled={loading || !activeJobId || !!myId}
              type="submit"
              className="btn-primary w-full flex justify-center items-center gap-2"
            >
              {loading
                ? <><RefreshCcw size={18} className="animate-spin" /><span>Scoring Resume...</span></>
                : myId
                  ? <span>Application Submitted ✓</span>
                  : <span>Submit Application</span>
              }
            </button>
          </form>

          {/* Score breakdown after submission */}
          {myScore && (
            <div className="mt-6 p-4 bg-darker rounded-xl border border-white/10 space-y-2">
              <div className="text-xs text-gray-500 uppercase tracking-widest font-semibold">Score Breakdown</div>
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
                <span className="text-gray-300 font-semibold">Composite</span>
                <span className="font-mono font-black text-white text-base">
                  {((myScore.final_score || 0) * 100).toFixed(1)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status Panel */}
      <div className="flex-1 space-y-6">
        <div className={`glass-panel p-8 transition-all ${myId ? 'border-primary/50 shadow-primary/20' : 'opacity-50'}`}>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Bell size={20} className={myStatus === 'active_review' ? 'text-accent animate-pulse' : 'text-gray-500'} />
            Waitlist Status
          </h2>

          {!myId ? (
            <p className="text-gray-500 text-sm">Submit your application to track your status in real-time.</p>
          ) : (
            <div className="space-y-4">
              {/* Status badge */}
              <div className="bg-darker p-4 rounded-xl border border-white/5 flex justify-between items-center">
                <span className="text-gray-400 font-medium">Status</span>
                <span className={`status-badge border ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
              </div>

              {/* Waitlisted: show queue position */}
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

              {/* Active review: acknowledge button */}
              {myStatus === 'active_review' && (
                <div className="bg-accent/10 border border-accent/30 p-6 rounded-xl text-center">
                  <h3 className="text-accent font-bold text-lg mb-2">You've been promoted!</h3>
                  <p className="text-sm text-gray-300 mb-4">
                    A slot has opened up. Acknowledge your spot before the deadline or it cascades to the next candidate.
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

              {/* Acknowledged */}
              {myStatus === 'acknowledged' && (
                <div className="bg-green-500/10 border border-green-500/30 p-6 rounded-xl text-center flex flex-col items-center">
                  <CheckCircle className="text-green-400 mb-3" size={48} />
                  <h3 className="text-green-400 font-bold text-lg">Spot Confirmed!</h3>
                  <p className="text-sm text-gray-400">The recruiter has been notified.</p>
                </div>
              )}

              {/* Hired */}
              {myStatus === 'hired' && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-6 rounded-xl text-center flex flex-col items-center">
                  <Trophy className="text-emerald-400 mb-3" size={48} />
                  <h3 className="text-emerald-400 font-bold text-lg">Congratulations!</h3>
                  <p className="text-sm text-gray-400">You have been hired for this position.</p>
                </div>
              )}

              {/* Rejected */}
              {myStatus === 'rejected' && (
                <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-xl text-center flex flex-col items-center">
                  <XCircle className="text-red-400 mb-3" size={48} />
                  <h3 className="text-red-400 font-bold text-lg">Not Selected</h3>
                  <p className="text-sm text-gray-400">Thank you for your interest in this position.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
