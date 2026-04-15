import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginUser, registerUser } from '../lib/api';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [role, setRole] = useState('student'); // 'student' or 'recruiter'
  const [formData, setFormData] = useState({ email: '', password: '', name: '', company_name: '', company_details: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    try {
      let res;
      if (isLogin) {
        res = await loginUser({ email: formData.email, password: formData.password });
      } else {
        res = await registerUser({ ...formData, role });
      }

      localStorage.setItem('ats_token', res.token);
      localStorage.setItem('ats_role', res.user.role);
      
      if (res.user.role === 'recruiter') navigate('/recruiter');
      else navigate('/student');

    } catch (err) {
      setError(err.response?.data?.error || 'Authentication error occurred');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full max-w-md mx-auto">
      <div className="glass-panel w-full p-8 rounded-2xl relative overflow-hidden">
        <h2 className="text-3xl font-bold mb-6 text-center text-white">
          {isLogin ? 'Welcome Back' : 'Create an Account'}
        </h2>

        {/* Role Toggle for Registration */}
        {!isLogin && (
          <div className="flex bg-white/5 p-1 mb-6 rounded-lg glass-panel w-full shadow-none border-white/5">
            <button 
              type="button"
              className={`flex-1 px-4 py-2 rounded-md font-medium transition-all ${role === 'student' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setRole('student')}
            >Student</button>
            <button 
              type="button"
              className={`flex-1 px-4 py-2 rounded-md font-medium transition-all ${role === 'recruiter' ? 'bg-secondary text-white shadow-lg shadow-secondary/30' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setRole('recruiter')}
            >Recruiter</button>
          </div>
        )}

        {error && <div className="text-red-400 bg-red-400/10 p-3 rounded-lg mb-4 text-sm text-center font-medium border border-red-500/20">{error}</div>}

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
              <input 
                type="text" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-dark/50 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                placeholder="John Doe"
              />
            </div>
          )}

          {!isLogin && role === 'recruiter' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Company Name</label>
                <input 
                  type="text" required value={formData.company_name} onChange={e => setFormData({ ...formData, company_name: e.target.value })}
                  className="w-full bg-dark/50 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Company Details</label>
                <textarea 
                  value={formData.company_details} onChange={e => setFormData({ ...formData, company_details: e.target.value })}
                  className="w-full bg-dark/50 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all h-24"
                  placeholder="Tell us about the company..."
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input 
              type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
              className="w-full bg-dark/50 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input 
              type="password" required value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })}
              className="w-full bg-dark/50 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="••••••••"
            />
          </div>

          <button type="submit" className="w-full py-3 mt-6 rounded-xl font-bold bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90 shadow-lg shadow-primary/30 transition-all">
            {isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-gray-400 text-sm">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button type="button" onClick={() => setIsLogin(!isLogin)} className="text-white hover:text-primary font-medium underline transition-colors">
            {isLogin ? 'Sign Up' : 'Log In'}
          </button>
        </p>
      </div>
    </div>
  );
}
