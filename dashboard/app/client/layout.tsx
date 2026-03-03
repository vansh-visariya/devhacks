'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Layers, LogOut, Bell,
  Users, Activity, Shield,
  Sparkles, ChevronRight, Cpu
} from 'lucide-react';
import { useAuth } from '@/components/AuthContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const clientNav = [
  { href: '/client', label: 'Dashboard', icon: Activity },
  { href: '/client/groups', label: 'Available Groups', icon: Users },
  { href: '/client/training', label: 'Training', icon: Cpu },
  { href: '/client/recommendations', label: 'Model Advisor', icon: Sparkles },
  { href: '/client/trust', label: 'Trust Score', icon: Shield },
  { href: '/client/notifications', label: 'Notifications', icon: Bell },
];

export default function ClientDashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, token, logout, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!isLoading && !token) {
      router.push('/login');
    }
  }, [token, isLoading, router]);

  useEffect(() => {
    if (user && user.role === 'admin') {
      router.push('/dashboard');
    }
  }, [user, router]);

  useEffect(() => {
    if (!token) return;
    const fetchNotifications = async () => {
      try {
        const res = await fetch(`${API_URL}/api/notifications/unread-count`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.count || 0);
        }
      } catch { }
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [token]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500 text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (!token || !user || user.role === 'admin') return null;

  const initials = (user.name || user.username || 'U').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <aside className="w-[260px] glass-sidebar flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
              <Layers size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-[15px] tracking-tight">ASTRA</h1>
              <p className="text-slate-500 text-[11px] font-medium">Client Portal</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-4 mb-2">Navigation</p>
          {clientNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActive ? 'active-emerald' : ''}`}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
                {item.href === '/client/notifications' && unreadCount > 0 && (
                  <span className="ml-auto bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                    {unreadCount}
                  </span>
                )}
                {isActive && item.href !== '/client/notifications' && (
                  <ChevronRight size={14} className="ml-auto opacity-60" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="p-4 mx-3 mb-3 rounded-xl" style={{ background: 'rgba(30, 41, 59, 0.4)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-emerald-300"
              style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(5,150,105,0.15))' }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{user.name || user.username}</p>
              <p className="text-slate-500 text-[11px] capitalize">{user.role}</p>
            </div>
            <button
              onClick={logout}
              className="p-2 text-slate-500 hover:text-white hover:bg-slate-800/50 rounded-lg transition"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 glass-header flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full pulse-dot green" />
              <span className="text-slate-500 text-xs font-medium">Connected</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/client/notifications"
              className="relative p-2 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition"
            >
              <Bell size={17} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-rose-500 text-white text-[10px] font-bold rounded-full px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
