import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import AuthPage from './pages/AuthPage';
import ApplicantView from './components/ApplicantView';
import AdminView from './components/AdminView';

function PrivateRoute({ children, role }) {
  const token = localStorage.getItem('ats_token');
  const userRole = localStorage.getItem('ats_role');

  if (!token) return <Navigate to="/auth" />;
  if (role && userRole !== role) return <Navigate to="/" />;

  return children;
}

function DefaultRedirect() {
  const token = localStorage.getItem('ats_token');
  const userRole = localStorage.getItem('ats_role');
  if (!token) return <Navigate to="/auth" />;
  return <Navigate to={userRole === 'recruiter' ? '/recruiter' : '/student'} />;
}

function App() {
  return (
    <Router>
      <div className="min-h-screen flex flex-col relative overflow-hidden bg-dark text-white">
        {/* Background Orbs to look impressive */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/20 blur-[150px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-secondary/20 blur-[150px] rounded-full pointer-events-none" />

        {/* Nav */}
        <nav className="relative z-10 glass-panel border-x-0 border-t-0 rounded-none px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-primary to-secondary flex items-center justify-center font-bold text-white shadow-lg shadow-primary/50">
              A
            </div>
            <Link to="/">
              <span className="font-bold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                Xcelcrowd ATS
              </span>
            </Link>
          </div>
          <div className="flex space-x-4">
            <button
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all text-gray-400 hover:text-white"
              onClick={() => {
                localStorage.clear();
                window.location.href = '/auth';
              }}
            >
              Sign Out
            </button>
          </div>
        </nav>

        {/* Main Content */}
        <main className="relative z-10 flex-1 p-6 md:p-12 w-full max-w-7xl mx-auto flex flex-col pt-8">
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/student" element={<PrivateRoute role="student"><ApplicantView /></PrivateRoute>} />
            <Route path="/recruiter" element={<PrivateRoute role="recruiter"><AdminView /></PrivateRoute>} />
            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
