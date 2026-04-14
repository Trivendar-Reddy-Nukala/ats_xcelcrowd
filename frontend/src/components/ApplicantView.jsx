import React, { useState, useEffect } from 'react';
import { submitApplicant, getWaitlist, listenWaitlist, acknowledgeApplicant } from '../lib/api';
import { UploadCloud, CheckCircle, RefreshCcw, Bell } from 'lucide-react';

export default function ApplicantView({ jobs, activeJobId }) {
  const [name, setName] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Track this user's submission details directly
  const [myStatus, setMyStatus] = useState(null);
  const [myId, setMyId] = useState(null);
  const [waitlistPos, setWaitlistPos] = useState(null);
  
  const activeJob = jobs.find(j => j._id === activeJobId);

  useEffect(() => {
    if (!activeJobId) return;
    
    // Initial fetch to get positions if applicant is in waitlist
    const fetchPositions = async () => {
      const waitlist = await getWaitlist(activeJobId);
      if(myId) {
        const index = waitlist.findIndex(w => w._id === myId);
        if (index !== -1) {
          setMyStatus(waitlist[index].status);
          setWaitlistPos(index + 1);
        }
      }
    };
    fetchPositions();

    const es = listenWaitlist(activeJobId, (data) => {
      // If someone else got promoted or acknowledged, waitlist changes, refetch positions
      // Wait a tiny bit just in case
      setTimeout(fetchPositions, 500);
      
      // If WE got promoted
      if (data.type === 'promotion' && data.applicant._id === myId) {
        setMyStatus('active_review');
      }
    });

    return () => es.close();
  }, [activeJobId, myId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeJobId || !name || !resumeText) return;
    setLoading(true);
    try {
      const res = await submitApplicant({ jobId: activeJobId, name, resume_text: resumeText });
      setMyId(res.id);
      setMyStatus(res.status);
    } catch(err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleAcknowledge = async () => {
    try {
      const res = await acknowledgeApplicant(myId);
      setMyStatus(res.applicant.status);
    } catch(err) {
      console.error(err);
    }
  };

  return (
    <div className="flex gap-8 max-w-5xl mx-auto w-full flex-col md:flex-row">
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
              <input type="text" className="glass-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Jane Doe" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Resume Text</label>
              <textarea 
                rows="6"
                className="glass-input font-mono text-xs whitespace-pre" 
                value={resumeText} 
                onChange={e=>setResumeText(e.target.value)} 
                placeholder="Paste your plain text resume here... \nEnsure skills like Java, PostgreSQL are visible."
                required
              ></textarea>
            </div>
            <button disabled={loading || !activeJobId} type="submit" className="btn-primary w-full flex justify-center items-center gap-2">
              {loading ? <RefreshCcw size={18} className="animate-spin" /> : <span>Submit Application</span>}
            </button>
          </form>
        </div>
      </div>

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
              <div className="bg-darker p-4 rounded-xl border border-white/5 flex justify-between items-center">
                <span className="text-gray-400 font-medium">Status</span>
                <span className={`status-badge ${
                  myStatus === 'waitlisted' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' :
                  myStatus === 'active_review' ? 'bg-accent/20 text-accent border-accent/50 animate-pulse' :
                  'bg-green-500/20 text-green-400 border-green-500/50'
                }`}>
                  {myStatus.replace('_', ' ').toUpperCase()}
                </span>
              </div>
              
              {myStatus === 'waitlisted' && (
                <div className="bg-darker p-6 rounded-xl border border-white/5 text-center">
                  <p className="text-gray-400 text-sm mb-2">You are currently</p>
                  <div className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
                    #{waitlistPos || '?'}
                  </div>
                  <p className="text-gray-500 text-xs mt-2">in the queue</p>
                </div>
              )}

              {myStatus === 'active_review' && (
                <div className="bg-accent/10 border border-accent/30 p-6 rounded-xl text-center">
                  <h3 className="text-accent font-bold text-lg mb-2">You've been promoted!</h3>
                  <p className="text-sm text-gray-300 mb-4">A slot has opened up. You have 30 seconds to acknowledge your spot before it cascades to the next candidate.</p>
                  <button onClick={handleAcknowledge} className="bg-accent hover:bg-pink-400 text-white font-bold py-2 px-6 rounded-full shadow-lg shadow-accent/40 w-full transition-all active:scale-95">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
