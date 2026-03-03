'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthContext';
import Link from 'next/link';
import {
  Users, Shield, Activity,
  TrendingUp, CheckCircle, AlertCircle, Bell,
  ArrowUpRight, Cpu
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface DashboardStats {
  groupsAvailable: number;
  groupsJoined: number;
  trustScore: number;
  roundsCompleted: number;
}

interface Notification {
  id: number;
  type: string;
  priority: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

export default function ClientDashboard() {
  const { token, user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    groupsAvailable: 0,
    groupsJoined: 0,
    trustScore: 1.0,
    roundsCompleted: 0
  });
  const [recentNotifications, setRecentNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!token) return;

      try {
        const groupsRes = await fetch(`${API_URL}/api/groups`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const groupsData = await groupsRes.json();

        const trustRes = await fetch(`${API_URL}/api/trust/scores/${user?.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const trustData = await trustRes.json();

        const notifRes = await fetch(`${API_URL}/api/notifications?limit=5`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const notifData = await notifRes.json();

        setStats({
          groupsAvailable: groupsData.count || 0,
          groupsJoined: 0,
          trustScore: trustData.score || 1.0,
          roundsCompleted: 0
        });

        setRecentNotifications(notifData.notifications || []);
      } catch (e) {
        console.error('Failed to fetch data:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token, user]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'error': return 'text-rose-400';
      case 'warning': return 'text-amber-400';
      case 'success': return 'text-emerald-400';
      default: return 'text-blue-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500 text-xs">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  const trustPercent = (stats.trustScore * 100).toFixed(0);
  const trustColor = stats.trustScore > 0.7 ? 'emerald' : stats.trustScore > 0.4 ? 'amber' : 'rose';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-white">{getGreeting()}, {user?.name || 'Client'}</h1>
        <p className="text-slate-400 text-sm mt-1">Here's your federated learning overview</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card accent-indigo p-5 animate-fade-in" style={{ animationDelay: '0.05s', opacity: 0 }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Available Groups</span>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)' }}>
              <Users className="text-indigo-400" size={17} />
            </div>
          </div>
          <p className="text-3xl font-bold text-white tracking-tight">{stats.groupsAvailable}</p>
        </div>

        <div className="stat-card accent-emerald p-5 animate-fade-in" style={{ animationDelay: '0.1s', opacity: 0 }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Groups Joined</span>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
              <CheckCircle className="text-emerald-400" size={17} />
            </div>
          </div>
          <p className="text-3xl font-bold text-white tracking-tight">{stats.groupsJoined}</p>
        </div>

        <div className="stat-card accent-violet p-5 animate-fade-in" style={{ animationDelay: '0.15s', opacity: 0 }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Trust Score</span>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center`}
              style={{ background: `rgba(${trustColor === 'emerald' ? '16,185,129' : trustColor === 'amber' ? '245,158,11' : '244,63,94'},0.15)` }}>
              <Shield className={`text-${trustColor}-400`} size={17} />
            </div>
          </div>
          <p className="text-3xl font-bold text-white tracking-tight">{trustPercent}%</p>
          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(30,41,59,0.6)' }}>
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out bg-${trustColor}-500`}
              style={{ width: `${stats.trustScore * 100}%` }}
            />
          </div>
        </div>

        <div className="stat-card accent-blue p-5 animate-fade-in" style={{ animationDelay: '0.2s', opacity: 0 }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Rounds Done</span>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.15)' }}>
              <TrendingUp className="text-blue-400" size={17} />
            </div>
          </div>
          <p className="text-3xl font-bold text-white tracking-tight">{stats.roundsCompleted}</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in" style={{ animationDelay: '0.25s', opacity: 0 }}>
        <Link href="/client/groups" className="glass-card p-5 group cursor-pointer">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110"
                style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.1))' }}>
                <Users className="text-emerald-400" size={20} />
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm">Join a Group</h3>
                <p className="text-slate-500 text-xs mt-0.5">Browse and request to join training groups</p>
              </div>
            </div>
            <ArrowUpRight size={16} className="text-slate-600 group-hover:text-emerald-400 transition-colors" />
          </div>
        </Link>

        <Link href="/client/training" className="glass-card p-5 group cursor-pointer">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110"
                style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))' }}>
                <Cpu className="text-indigo-400" size={20} />
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm">Start Training</h3>
                <p className="text-slate-500 text-xs mt-0.5">Begin local model training</p>
              </div>
            </div>
            <ArrowUpRight size={16} className="text-slate-600 group-hover:text-indigo-400 transition-colors" />
          </div>
        </Link>
      </div>

      {/* Recent Notifications */}
      <div className="glass-card p-5 animate-fade-in" style={{ animationDelay: '0.35s', opacity: 0 }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Recent Notifications</h2>
          <Link href="/client/notifications" className="text-emerald-400 text-xs font-medium hover:text-emerald-300 transition flex items-center gap-1">
            View all <ArrowUpRight size={12} />
          </Link>
        </div>

        {recentNotifications.length > 0 ? (
          <div className="space-y-2">
            {recentNotifications.slice(0, 5).map((notif) => (
              <div
                key={notif.id}
                className={`flex items-start gap-3 p-3 rounded-xl transition-colors ${notif.read ? 'opacity-60' : ''
                  }`}
                style={{ background: notif.read ? 'transparent' : 'rgba(30, 41, 59, 0.3)' }}
              >
                {notif.priority === 'error' || notif.priority === 'warning' ? (
                  <AlertCircle className="text-amber-400 shrink-0 mt-0.5" size={16} />
                ) : (
                  <Activity className={getPriorityColor(notif.priority) + ' shrink-0 mt-0.5'} size={16} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{notif.title}</p>
                  <p className="text-slate-500 text-xs truncate mt-0.5">{notif.message}</p>
                </div>
                <span className="text-slate-600 text-[10px] shrink-0 font-mono">
                  {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Bell className="mx-auto mb-2 text-slate-700" size={28} />
            <p className="text-slate-500 text-sm">No notifications yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
