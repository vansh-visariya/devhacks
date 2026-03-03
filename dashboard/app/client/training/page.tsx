'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthContext';
import Link from 'next/link';
import {
  Cpu, Activity, CheckCircle, XCircle,
  Wifi, WifiOff, Clock, TrendingUp, Shield,
  Terminal, Copy, Check, ArrowUpRight, RefreshCw,
  Layers, AlertCircle, Zap
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface TrainingSession {
  client_id: string;
  group_id: string;
  model_id: string;
  group_status: string;
  is_training: boolean;
  local_accuracy: number;
  local_loss: number;
  trust_score: number;
  updates_count: number;
  last_update: number | null;
  status: string;
  model_version: number;
  global_accuracy?: number;
  global_loss?: number;
  window_status?: {
    pending_updates: number;
    trigger_reason: string;
    time_remaining: number;
  };
}

interface PendingActivation {
  group_id: string;
  model_id: string;
  status: string;
}

interface TrainingStatus {
  username: string;
  sessions: TrainingSession[];
  pending_activations: PendingActivation[];
  connected_clients: string[];
  has_active_training: boolean;
}

export default function ClientTrainingPage() {
  const { token, user } = useAuth();
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const fetchStatus = async () => {
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/client/training-status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setError(null);
      } else {
        setError('Failed to fetch training status');
      }
    } catch (e) {
      setError('Cannot connect to server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [token]);

  const copyCommand = (groupId: string, joinToken?: string) => {
    const cmd = `python client_app/client_app.py --server ${API_URL} --client-id ${user?.username || 'client'}_${groupId} --group-id ${groupId} --username ${user?.username || 'client'} --password YOUR_PASSWORD${joinToken ? ` --join-token ${joinToken}` : ''}`;
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const formatTime = (ts: number | null) => {
    if (!ts) return 'Never';
    const d = new Date(ts * 1000);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 10) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getGroupStatusStyle = (status: string) => {
    switch (status) {
      case 'TRAINING': return { bg: 'rgba(16,185,129,0.1)', color: '#34d399', border: 'rgba(16,185,129,0.3)', label: 'Training' };
      case 'PAUSED': return { bg: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: 'rgba(245,158,11,0.3)', label: 'Paused' };
      case 'COMPLETED': return { bg: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: 'rgba(59,130,246,0.3)', label: 'Completed' };
      default: return { bg: 'rgba(51,65,85,0.2)', color: '#94a3b8', border: 'rgba(51,65,85,0.5)', label: status || 'Idle' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500 text-xs">Loading training status...</span>
        </div>
      </div>
    );
  }

  const hasNoSessions = !status?.sessions?.length;
  const hasPending = (status?.pending_activations?.length || 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-white">Training Monitor</h1>
          <p className="text-slate-400 text-sm mt-1">Real-time status of your federated learning sessions</p>
        </div>
        <button
          onClick={fetchStatus}
          className="p-2.5 rounded-xl text-slate-400 hover:text-white transition-all"
          style={{ background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(51, 65, 85, 0.5)' }}
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {error && (
        <div className="glass-card p-4 animate-fade-in" style={{ borderColor: 'rgba(244,63,94,0.3)' }}>
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="text-rose-400 shrink-0" />
            <p className="text-rose-300 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Connection Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in" style={{ animationDelay: '0.05s', opacity: 0 }}>
        <div className="stat-card accent-emerald p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Active Sessions</span>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
              <Cpu className="text-emerald-400" size={17} />
            </div>
          </div>
          <p className="text-3xl font-bold text-white tracking-tight">{status?.sessions?.length || 0}</p>
        </div>

        <div className="stat-card accent-indigo p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Connected Clients</span>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)' }}>
              {(status?.connected_clients?.length || 0) > 0
                ? <Wifi className="text-indigo-400" size={17} />
                : <WifiOff className="text-slate-500" size={17} />
              }
            </div>
          </div>
          <p className="text-3xl font-bold text-white tracking-tight">{status?.connected_clients?.length || 0}</p>
          <p className="text-slate-500 text-[11px] mt-1">
            {(status?.connected_clients?.length || 0) > 0 ? 'Python client connected via WebSocket' : 'No Python client running'}
          </p>
        </div>

        <div className="stat-card accent-blue p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Training Active</span>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: status?.has_active_training ? 'rgba(16,185,129,0.15)' : 'rgba(51,65,85,0.2)' }}>
              {status?.has_active_training
                ? <Zap className="text-emerald-400" size={17} />
                : <Activity className="text-slate-500" size={17} />
              }
            </div>
          </div>
          <p className={`text-lg font-bold ${status?.has_active_training ? 'text-emerald-400' : 'text-slate-500'}`}>
            {status?.has_active_training ? 'In Progress' : 'Idle'}
          </p>
        </div>
      </div>

      {/* Pending Activations */}
      {hasPending && (
        <div className="glass-card p-5 animate-fade-in" style={{ animationDelay: '0.1s', opacity: 0, borderColor: 'rgba(245,158,11,0.3)' }}>
          <div className="flex items-center gap-3 mb-3">
            <AlertCircle size={18} className="text-amber-400" />
            <h3 className="text-white font-semibold text-sm">Approved Groups — Activation Required</h3>
          </div>
          <p className="text-slate-400 text-sm mb-3">These groups have approved your join request. Activate them to start training.</p>
          <div className="space-y-2">
            {status!.pending_activations.map((pa) => (
              <div key={pa.group_id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'rgba(30,41,59,0.4)' }}>
                <div className="flex items-center gap-3">
                  <Layers size={16} className="text-amber-400" />
                  <div>
                    <span className="text-white text-sm font-medium">{pa.group_id}</span>
                    <span className="text-slate-500 text-xs ml-2">({pa.model_id})</span>
                  </div>
                </div>
                <Link href="/client/groups" className="btn-emerald text-white text-xs px-3 py-1.5">
                  Activate
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Training Sessions */}
      {hasNoSessions ? (
        <div className="glass-card p-10 text-center animate-fade-in" style={{ animationDelay: '0.15s', opacity: 0 }}>
          <Cpu className="mx-auto mb-3 text-slate-700" size={40} />
          <h3 className="text-white font-semibold mb-1">No Active Training Sessions</h3>
          <p className="text-slate-500 text-sm mb-5">Join a group and activate it to start training</p>
          <Link href="/client/groups" className="btn-emerald inline-flex text-white text-sm px-5 py-2.5 items-center gap-2">
            <Layers size={15} /> Browse Groups
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {status!.sessions.map((session, idx) => {
            const gs = getGroupStatusStyle(session.group_status);
            const isConnected = status!.connected_clients.includes(session.client_id);
            return (
              <div key={session.client_id} className="glass-card p-5 animate-fade-in" style={{ animationDelay: `${0.15 + idx * 0.05}s`, opacity: 0 }}>
                {/* Session Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: gs.bg }}>
                      <Layers size={18} style={{ color: gs.color }} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-semibold">{session.group_id}</h3>
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider"
                          style={{ background: gs.bg, color: gs.color, border: `1px solid ${gs.border}` }}>
                          {gs.label}
                        </span>
                      </div>
                      <p className="text-slate-500 text-xs mt-0.5">
                        Model: <span className="text-slate-400 font-mono">{session.model_id}</span> ·
                        Client: <span className="text-slate-400 font-mono">{session.client_id}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isConnected ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-emerald-400"
                        style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full pulse-dot green" /> Connected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-500"
                        style={{ background: 'rgba(51,65,85,0.2)', border: '1px solid rgba(51,65,85,0.3)' }}>
                        <WifiOff size={11} /> Disconnected
                      </span>
                    )}
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                  <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.5)' }}>
                    <p className="text-slate-500 text-[10px] font-medium uppercase tracking-wider">Local Accuracy</p>
                    <p className="text-xl font-bold text-white mt-1">
                      {session.local_accuracy ? `${(session.local_accuracy * 100).toFixed(1)}%` : '—'}
                    </p>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.5)' }}>
                    <p className="text-slate-500 text-[10px] font-medium uppercase tracking-wider">Local Loss</p>
                    <p className="text-xl font-bold text-white mt-1">
                      {session.local_loss ? session.local_loss.toFixed(4) : '—'}
                    </p>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.5)' }}>
                    <p className="text-slate-500 text-[10px] font-medium uppercase tracking-wider">Updates Sent</p>
                    <p className="text-xl font-bold text-white mt-1">{session.updates_count}</p>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.5)' }}>
                    <p className="text-slate-500 text-[10px] font-medium uppercase tracking-wider">Trust Score</p>
                    <p className={`text-xl font-bold mt-1 ${session.trust_score > 0.7 ? 'text-emerald-400' : session.trust_score > 0.4 ? 'text-amber-400' : 'text-rose-400'}`}>
                      {(session.trust_score * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.5)' }}>
                    <p className="text-slate-500 text-[10px] font-medium uppercase tracking-wider">Last Update</p>
                    <p className="text-sm font-medium text-white mt-1.5">{formatTime(session.last_update)}</p>
                  </div>
                </div>

                {/* Global Model Info */}
                <div className="flex items-center gap-4 p-3 rounded-xl text-xs" style={{ background: 'rgba(15,23,42,0.3)' }}>
                  <span className="text-slate-500">Global Model:</span>
                  <span className="text-slate-300">v{session.model_version}</span>
                  {session.global_accuracy !== undefined && (
                    <>
                      <span className="text-slate-600">|</span>
                      <span className="text-slate-400">Acc: <span className="text-emerald-400">{(session.global_accuracy * 100).toFixed(1)}%</span></span>
                    </>
                  )}
                  {session.window_status && (
                    <>
                      <span className="text-slate-600">|</span>
                      <span className="text-slate-400">Window: {session.window_status.pending_updates} pending</span>
                    </>
                  )}
                </div>

                {/* Launch Command (if not connected) */}
                {!isConnected && (
                  <div className="mt-4 p-4 rounded-xl" style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.3)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Terminal size={14} className="text-indigo-400" />
                      <span className="text-slate-400 text-xs font-medium">Start your Python FL client to begin training:</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[11px] text-emerald-300 font-mono p-2.5 rounded-lg overflow-x-auto whitespace-nowrap"
                        style={{ background: 'rgba(6,9,15,0.8)' }}>
                        python client_app/client_app.py --server {API_URL} --client-id {session.client_id} --group-id {session.group_id} --username {user?.username || 'client'} --password YOUR_PASSWORD
                      </code>
                      <button
                        onClick={() => copyCommand(session.group_id)}
                        className="p-2 rounded-lg text-slate-500 hover:text-white transition shrink-0"
                        style={{ background: 'rgba(30,41,59,0.5)' }}
                        title="Copy command"
                      >
                        {copiedCmd ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* How It Works */}
      <div className="glass-card p-5 animate-fade-in" style={{ animationDelay: '0.3s', opacity: 0 }}>
        <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Terminal size={15} className="text-indigo-400" /> How Training Works
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { step: '1', title: 'Join a Group', desc: 'Request to join from Available Groups page', icon: Layers },
            { step: '2', title: 'Activate Membership', desc: 'Once approved, activate your join request', icon: CheckCircle },
            { step: '3', title: 'Run Python Client', desc: 'Start the CLI client with your credentials', icon: Terminal },
            { step: '4', title: 'Monitor Here', desc: 'Watch real-time metrics on this page', icon: Activity },
          ].map((item) => (
            <div key={item.step} className="p-3 rounded-xl" style={{ background: 'rgba(15,23,42,0.4)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold text-indigo-400"
                  style={{ background: 'rgba(99,102,241,0.15)' }}>
                  {item.step}
                </span>
                <item.icon size={14} className="text-slate-500" />
              </div>
              <p className="text-white text-xs font-medium">{item.title}</p>
              <p className="text-slate-500 text-[11px] mt-0.5">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
