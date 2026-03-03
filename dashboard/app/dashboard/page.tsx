'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthContext';
import { Layers, Users, Activity, Shield, Zap, TrendingUp, Plus, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface SystemMetrics {
  total_groups: number;
  active_groups: number;
  total_participants: number;
  active_participants: number;
  dp_enabled_groups: number;
  total_aggregations: number;
  latest_group_id?: string | null;
  latest_accuracy?: number;
  latest_loss?: number;
  latest_version?: number;
  latest_timestamp?: number;
}

export default function DashboardPage() {
  const { token, user } = useAuth();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch(`${API_URL}/api/system/metrics`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setMetrics(data);
        }
      } catch (e) {
        console.error('Failed to fetch metrics:', e);
      }
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, [token]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const formatPercent = (value?: number) => `${((value || 0) * 100).toFixed(1)}%`;
  const formatLoss = (value?: number) => (value ?? 0).toFixed(4);

  const statCards = [
    { label: 'Total Groups', value: metrics?.total_groups || 0, icon: Layers, accent: 'accent-indigo', iconBg: 'rgba(99,102,241,0.15)', iconColor: 'text-indigo-400' },
    { label: 'Active Groups', value: metrics?.active_groups || 0, icon: Activity, accent: 'accent-emerald', iconBg: 'rgba(16,185,129,0.15)', iconColor: 'text-emerald-400' },
    { label: 'Total Participants', value: metrics?.total_participants || 0, icon: Users, accent: 'accent-blue', iconBg: 'rgba(59,130,246,0.15)', iconColor: 'text-blue-400' },
    { label: 'Active Participants', value: metrics?.active_participants || 0, icon: Zap, accent: 'accent-amber', iconBg: 'rgba(245,158,11,0.15)', iconColor: 'text-amber-400' },
    { label: 'DP Enabled', value: metrics?.dp_enabled_groups || 0, icon: Shield, accent: 'accent-violet', iconBg: 'rgba(139,92,246,0.15)', iconColor: 'text-violet-400' },
    { label: 'Total Rounds', value: metrics?.total_aggregations || 0, icon: TrendingUp, accent: 'accent-rose', iconBg: 'rgba(244,63,94,0.15)', iconColor: 'text-rose-400' },
  ];

  const performanceCards = [
    { label: 'Latest Accuracy', value: formatPercent(metrics?.latest_accuracy), sub: metrics?.latest_group_id ? `Group: ${metrics.latest_group_id}` : 'No data', color: 'emerald' },
    { label: 'Latest Loss', value: formatLoss(metrics?.latest_loss), sub: `Round v${metrics?.latest_version || 0}`, color: 'blue' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-white">{getGreeting()}, {user?.name || 'Admin'}</h1>
        <p className="text-slate-400 text-sm mt-1">Here's your federated learning overview</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((stat, idx) => (
          <div key={idx} className={`stat-card ${stat.accent} p-5 animate-fade-in`} style={{ animationDelay: `${idx * 0.05}s`, opacity: 0 }}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">{stat.label}</span>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: stat.iconBg }}>
                <stat.icon size={17} className={stat.iconColor} />
              </div>
            </div>
            <p className="text-3xl font-bold text-white tracking-tight">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Performance Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {performanceCards.map((card, idx) => (
          <div key={idx} className="stat-card accent-emerald p-5 animate-fade-in" style={{ animationDelay: `${0.35 + idx * 0.05}s`, opacity: 0 }}>
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">{card.label}</span>
            <p className="text-3xl font-bold text-white tracking-tight mt-3">{card.value}</p>
            <p className="text-slate-500 text-xs mt-2">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in" style={{ animationDelay: '0.45s', opacity: 0 }}>
        <Link href="/dashboard/groups" className="glass-card p-5 group cursor-pointer">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110"
                style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))' }}>
                <Layers size={20} className="text-indigo-400" />
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm">Manage Groups</h3>
                <p className="text-slate-500 text-xs mt-0.5">View and control federated groups</p>
              </div>
            </div>
            <ArrowUpRight size={16} className="text-slate-600 group-hover:text-indigo-400 transition-colors" />
          </div>
        </Link>

        <Link href="/dashboard/create" className="glass-card p-5 group cursor-pointer">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110"
                style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.1))' }}>
                <Plus size={20} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm">Create New Group</h3>
                <p className="text-slate-500 text-xs mt-0.5">Start a new federated learning experiment</p>
              </div>
            </div>
            <ArrowUpRight size={16} className="text-slate-600 group-hover:text-emerald-400 transition-colors" />
          </div>
        </Link>
      </div>
    </div>
  );
}
