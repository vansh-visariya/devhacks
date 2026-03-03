'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthContext';
import { Clock, RefreshCw } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Log {
  timestamp: number;
  type: string;
  message: string;
  group_id: string | null;
  details: Record<string, any>;
}

export default function LogsPage() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      const url = filter
        ? `${API_URL}/api/logs?event_type=${filter}`
        : `${API_URL}/api/logs`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [token, filter]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'training_started': return 'text-emerald-400';
      case 'aggregation': return 'text-blue-400';
      case 'client_joined': return 'text-violet-400';
      case 'client_rejected': return 'text-rose-400';
      default: return 'text-slate-400';
    }
  };

  const getTypeDot = (type: string) => {
    switch (type) {
      case 'training_started': return 'bg-emerald-500';
      case 'aggregation': return 'bg-blue-500';
      case 'client_joined': return 'bg-violet-500';
      case 'client_rejected': return 'bg-rose-500';
      default: return 'bg-slate-500';
    }
  };

  const eventTypes = ['training_started', 'aggregation', 'client_joined', 'client_rejected'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-white">Event Logs</h1>
          <p className="text-slate-400 text-sm mt-1">Server events and training history</p>
        </div>
        <div className="flex gap-2">
          <select
            value={filter || ''}
            onChange={(e) => setFilter(e.target.value || null)}
            className="input-field !w-auto !py-2 text-sm"
          >
            <option value="">All Events</option>
            {eventTypes.map(type => (
              <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <button
            onClick={fetchLogs}
            className="p-2.5 rounded-xl text-slate-400 hover:text-white transition-all"
            style={{ background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(51, 65, 85, 0.5)' }}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="glass-card p-12 text-center animate-fade-in">
          <Clock size={40} className="mx-auto text-slate-700 mb-3" />
          <h3 className="text-white font-semibold mb-1">No logs yet</h3>
          <p className="text-slate-500 text-sm">Events will appear here when training starts</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden animate-fade-in">
          <div className="max-h-[650px] overflow-y-auto">
            {logs.map((log, idx) => (
              <div
                key={idx}
                className="p-4 border-b transition-colors hover:bg-white/[0.02]"
                style={{ borderColor: 'rgba(51,65,85,0.3)' }}
              >
                <div className="flex items-start gap-4">
                  <div className="text-slate-600 text-xs font-mono min-w-[72px] mt-0.5">
                    {formatTime(log.timestamp)}
                  </div>
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${getTypeDot(log.type)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[11px] font-semibold uppercase tracking-wider ${getTypeColor(log.type)}`}>
                        {log.type.replace(/_/g, ' ')}
                      </span>
                      {log.group_id && (
                        <span className="text-[10px] text-slate-600 font-mono px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(30,41,59,0.5)' }}>
                          {log.group_id}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-300 text-sm">{log.message}</p>
                    {log.details && Object.keys(log.details).length > 0 && (
                      <pre className="text-slate-600 text-[11px] mt-1.5 font-mono leading-relaxed">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
