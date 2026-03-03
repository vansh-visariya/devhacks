'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Lock, User, Mail, UserPlus } from 'lucide-react';
import { useAuth } from '@/components/AuthContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type AuthMode = 'login' | 'signup';

function LoginForm() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('client');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await login(username, password);
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        router.push(storedUser.role === 'admin' ? '/dashboard' : '/client');
      } else {
        const response = await fetch(`${API_URL}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            role,
            email: email || null,
            full_name: fullName || null
          })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Signup failed');

        await login(username, password);
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        router.push(storedUser.role === 'admin' ? '/dashboard' : '/client');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen login-bg grid-bg flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-30 animate-float"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)' }} />
      <div className="absolute bottom-1/3 right-1/4 w-80 h-80 rounded-full opacity-20 animate-float"
        style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)', animationDelay: '2s' }} />

      <div className="w-full max-w-[420px] relative z-10">
        <div className="glass-card p-8 animate-fade-in">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Layers size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">ASTRA</h1>
              <p className="text-slate-500 text-xs font-medium">Federated AI Platform</p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="flex mb-6 p-1 rounded-xl" style={{ background: 'rgba(30, 41, 59, 0.5)' }}>
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${mode === 'login'
                  ? 'btn-primary text-white'
                  : 'text-slate-400 hover:text-white'
                }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${mode === 'signup'
                  ? 'btn-primary text-white'
                  : 'text-slate-400 hover:text-white'
                }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-xl text-sm animate-fade-in">
                {error}
              </div>
            )}

            <div>
              <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wider">Username</label>
              <div className="relative">
                <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-field pl-10"
                  placeholder="Enter username"
                  required
                />
              </div>
            </div>

            {mode === 'signup' && (
              <>
                <div className="animate-fade-in">
                  <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wider">Full Name</label>
                  <div className="relative">
                    <UserPlus size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="input-field pl-10"
                      placeholder="Enter your name"
                    />
                  </div>
                </div>

                <div className="animate-fade-in">
                  <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wider">Email (Optional)</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input-field pl-10"
                      placeholder="your@email.com"
                    />
                  </div>
                </div>

                <div className="animate-fade-in">
                  <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wider">Account Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole('client')}
                      className={`p-3.5 rounded-xl text-sm font-medium transition-all duration-200 ${role === 'client'
                          ? 'text-white border-brand-500/50'
                          : 'text-slate-400 border-slate-700/50 hover:border-slate-600'
                        }`}
                      style={{
                        background: role === 'client' ? 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))' : 'rgba(15,23,42,0.6)',
                        border: `1px solid ${role === 'client' ? 'rgba(99,102,241,0.3)' : 'rgba(51,65,85,0.5)'}`
                      }}
                    >
                      <div className="font-semibold">Client</div>
                      <div className="text-[11px] opacity-60 mt-0.5">Participate in FL</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('admin')}
                      className={`p-3.5 rounded-xl text-sm font-medium transition-all duration-200 ${role === 'admin'
                          ? 'text-white'
                          : 'text-slate-400 hover:border-slate-600'
                        }`}
                      style={{
                        background: role === 'admin' ? 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))' : 'rgba(15,23,42,0.6)',
                        border: `1px solid ${role === 'admin' ? 'rgba(99,102,241,0.3)' : 'rgba(51,65,85,0.5)'}`
                      }}
                    >
                      <div className="font-semibold">Admin</div>
                      <div className="text-[11px] opacity-60 mt-0.5">Full control</div>
                    </button>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pl-10"
                  placeholder="Enter password"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary text-white py-3 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : mode === 'login' ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800/50">
            <p className="text-slate-500 text-[10px] text-center uppercase tracking-widest font-medium mb-3">Demo Credentials</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(30, 41, 59, 0.4)' }}>
                <p className="text-slate-500 text-[10px] font-medium">Admin</p>
                <p className="text-white font-mono text-[11px] mt-0.5">admin / adminpass</p>
              </div>
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(30, 41, 59, 0.4)' }}>
                <p className="text-slate-500 text-[10px] font-medium">Client</p>
                <p className="text-white font-mono text-[11px] mt-0.5">sign up to create</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}
