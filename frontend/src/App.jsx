import React, { useState, useEffect } from 'react';
import ApplicantView from './components/ApplicantView';
import AdminView from './components/AdminView';
import { getJobs } from './lib/api';

function App() {
  const [view, setView] = useState('candidate'); // 'candidate' or 'admin'
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);

  useEffect(() => {
    // Poll jobs to refresh capacities
    getJobs().then(data => {
      setJobs(data);
      if(data.length > 0 && !activeJobId) {
        setActiveJobId(data[0]._id);
      }
    });
  }, [activeJobId]);

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-dark">
      {/* Background Orbs to look impressive */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/20 blur-[150px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-secondary/20 blur-[150px] rounded-full pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 glass-panel border-x-0 border-t-0 rounded-none px-6 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-primary to-secondary flex items-center justify-center font-bold text-white shadow-lg shadow-primary/50">
            A
          </div>
          <span className="font-bold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            Antigravity ATS
          </span>
        </div>
        <div className="flex bg-white/5 p-1 rounded-xl glass-panel shadow-none border-white/5">
          <button 
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'candidate' ? 'bg-primary shadow-lg shadow-primary/30 text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setView('candidate')}
          >
            Candidate Portal
          </button>
          <button 
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'admin' ? 'bg-secondary shadow-lg shadow-secondary/30 text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setView('admin')}
          >
            Recruiter Auth
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 flex-1 p-6 md:p-12 w-full max-w-7xl mx-auto flex flex-col pt-8">
        {view === 'candidate' ? <ApplicantView jobs={jobs} activeJobId={activeJobId} /> : <AdminView jobs={jobs} activeJobId={activeJobId} setJobs={setJobs} setActiveJobId={setActiveJobId} />}
      </main>
    </div>
  );
}

export default App;
