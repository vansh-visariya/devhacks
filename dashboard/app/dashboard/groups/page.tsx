'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthContext';
import Link from 'next/link';
import { Layers, Eye, EyeOff, Play, Pause, Square, RefreshCw, Lock, Clock, Users, Plus, ArrowUpRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Group {
  group_id: string;
  model_id: string;
  status: string;
  is_training: boolean;
  is_locked: boolean;
  join_token: string;
  config: { local_epochs: number; batch_size: number; lr: number; dp_enabled: boolean };
  window_config: { window_size: number; time_limit: number };
  window_status: { pending_updates: number; trigger_reason: string; time_remaining: number };
  client_count: number;
  model_version: number;
}

export default function GroupsPage() {
  const { token, user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const router = useRouter();

  const fetchGroups = async () => {
    try {
      const res = await fetch(`${API_URL}/api/groups`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      }
    } catch (e) {
      console.error('Failed to fetch groups:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchGroups();
    const interval = setInterval(fetchGroups, 2000);
    return () => clearInterval(interval);
  }, [token]);

  const controlGroup = async (groupId: string, action: 'start' | 'pause' | 'resume' | 'stop') => {
    try {
      await fetch(`${API_URL}/api/groups/${groupId}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchGroups();
    } catch (e) {
      console.error(`Failed to ${action} group:`, e);
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'TRAINING': return { bg: 'rgba(16,185,129,0.1)', color: '#34d399', border: 'rgba(16,185,129,0.3)' };
      case 'PAUSED': return { bg: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: 'rgba(245,158,11,0.3)' };
      case 'COMPLETED': return { bg: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: 'rgba(59,130,246,0.3)' };
      case 'FAILED': return { bg: 'rgba(244,63,94,0.1)', color: '#fb7185', border: 'rgba(244,63,94,0.3)' };
      default: return { bg: 'rgba(51,65,85,0.2)', color: '#94a3b8', border: 'rgba(51,65,85,0.5)' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-white">Groups</h1>
          <p className="text-slate-400 text-sm mt-1">Manage federated learning groups</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchGroups}
            className="p-2.5 rounded-xl text-slate-400 hover:text-white transition-all"
            style={{ background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(51, 65, 85, 0.5)' }}
          >
            <RefreshCw size={16} />
          </button>
          {user?.role === 'admin' && (
            <Link href="/dashboard/create" className="btn-primary px-4 py-2.5 text-white text-sm flex items-center gap-2">
              <Plus size={15} /> Create Group
            </Link>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="glass-card p-12 text-center animate-fade-in">
          <Layers size={40} className="mx-auto text-slate-700 mb-3" />
          <h3 className="text-white font-semibold mb-1">No groups yet</h3>
          <p className="text-slate-500 text-sm mb-4">Create your first federated learning group to get started.</p>
          {user?.role === 'admin' && (
            <Link href="/dashboard/create" className="btn-primary inline-flex px-5 py-2.5 text-white text-sm items-center gap-2">
              <Plus size={15} /> Create Group
            </Link>
          )}
        </div>
      ) : (
        <div className="glass-card overflow-hidden animate-fade-in">
          <table className="w-full">
            <thead>
              <tr style={{ background: 'rgba(6, 9, 15, 0.5)' }}>
                <th className="text-left p-4 text-slate-500 text-[11px] font-semibold uppercase tracking-wider">Group</th>
                <th className="text-left p-4 text-slate-500 text-[11px] font-semibold uppercase tracking-wider">Model</th>
                <th className="text-left p-4 text-slate-500 text-[11px] font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left p-4 text-slate-500 text-[11px] font-semibold uppercase tracking-wider">Clients</th>
                <th className="text-left p-4 text-slate-500 text-[11px] font-semibold uppercase tracking-wider">Window</th>
                <th className="text-left p-4 text-slate-500 text-[11px] font-semibold uppercase tracking-wider">Version</th>
                <th className="text-left p-4 text-slate-500 text-[11px] font-semibold uppercase tracking-wider">Join Token</th>
                <th className="text-right p-4 text-slate-500 text-[11px] font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const statusStyle = getStatusStyle(group.status);
                return (
                  <tr key={group.group_id} className="border-t hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'rgba(51,65,85,0.3)' }}>
                    <td className="p-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)' }}>
                          <Layers size={14} className="text-indigo-400" />
                        </div>
                        <span className="text-white font-medium text-sm">{group.group_id}</span>
                        {group.is_locked && <Lock size={12} className="text-amber-500" />}
                      </div>
                    </td>
                    <td className="p-4 text-slate-300 text-sm font-mono">{group.model_id}</td>
                    <td className="p-4">
                      <span
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wider"
                        style={{ background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}` }}
                      >
                        {group.status}
                      </span>
                    </td>
                    <td className="p-4 text-slate-300 text-sm">
                      <div className="flex items-center gap-1.5">
                        <Users size={13} className="text-slate-500" />
                        {group.client_count}
                      </div>
                    </td>
                    <td className="p-4 text-slate-300 text-sm">
                      <div className="flex items-center gap-1.5">
                        <Clock size={13} className="text-slate-500" />
                        {group.window_config.window_size} / {group.window_config.time_limit}s
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-slate-300 text-sm font-mono">v{group.model_version}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5">
                        <code className="text-[11px] px-2 py-1 rounded-lg text-slate-400 font-mono"
                          style={{ background: 'rgba(30,41,59,0.5)' }}>
                          {showToken[group.group_id] ? group.join_token : '••••••••'}
                        </code>
                        <button
                          onClick={() => setShowToken({ ...showToken, [group.group_id]: !showToken[group.group_id] })}
                          className="p-1 text-slate-500 hover:text-white transition"
                        >
                          {showToken[group.group_id] ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {group.is_training && user?.role === 'admin' && (
                          <>
                            <button onClick={() => controlGroup(group.group_id, 'pause')}
                              className="p-2 rounded-lg transition-all hover:scale-105 text-white"
                              style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.8), rgba(217,119,6,0.8))' }}
                              title="Pause">
                              <Pause size={13} />
                            </button>
                            <button onClick={() => controlGroup(group.group_id, 'stop')}
                              className="p-2 rounded-lg transition-all hover:scale-105 text-white"
                              style={{ background: 'linear-gradient(135deg, rgba(244,63,94,0.8), rgba(225,29,72,0.8))' }}
                              title="Stop">
                              <Square size={13} />
                            </button>
                          </>
                        )}
                        {group.status === 'PAUSED' && user?.role === 'admin' && (
                          <button onClick={() => controlGroup(group.group_id, 'resume')}
                            className="p-2 rounded-lg transition-all hover:scale-105 text-white"
                            style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.8), rgba(5,150,105,0.8))' }}
                            title="Resume">
                            <Play size={13} />
                          </button>
                        )}
                        {!group.is_training && group.status !== 'COMPLETED' && group.status !== 'PAUSED' && (
                          <span className="text-[10px] text-slate-600 italic mr-1">Auto-starts</span>
                        )}
                        <button
                          onClick={() => router.push(`/dashboard/groups/${group.group_id}`)}
                          className="p-2 rounded-lg transition-all hover:scale-105 text-slate-400 hover:text-white"
                          style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(51,65,85,0.5)' }}
                          title="View Details">
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
