'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthContext';
import {
  Layers, ArrowLeft, Play, Pause, Square, Clock, Users,
  Shield, Activity, Zap, TrendingUp, ScrollText, RefreshCw,
  Download, Box
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface GroupMetrics {
  version: number;
  timestamp: number;
  accuracy: number;
  loss: number;
  clients: number;
}

interface Group {
  group_id: string;
  model_id: string;
  status: string;
  is_training: boolean;
  is_locked: boolean;
  config: { local_epochs: number; batch_size: number; lr: number; dp_enabled: boolean };
  window_config: { window_size: number; time_limit: number };
  window_status: { pending_updates: number; trigger_reason: string; time_remaining: number };
  client_count: number;
  model_version: number;
  metrics_history: GroupMetrics[];
  completed_rounds: number;
}

interface Client {
  client_id: string;
  group_id: string;
  status: string;
  trust_score: number;
  local_accuracy: number;
  local_loss: number;
  updates_count: number;
}

interface Log {
  timestamp: number;
  type: string;
  message: string;
  group_id: string | null;
  details: Record<string, any>;
}

export default function GroupDetailPage() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [logFilter, setLogFilter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [joinRequests, setJoinRequests] = useState<any[]>([]);

  const fetchData = async () => {
    try {
      const logsUrl = logFilter
        ? `${API_URL}/api/logs?group_id=${id}&event_type=${logFilter}`
        : `${API_URL}/api/logs?group_id=${id}`;

      const requestsPromise = user?.role === 'admin'
        ? fetch(`${API_URL}/api/join/join-requests?group_id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } })
        : Promise.resolve({ ok: true, json: async () => ({ requests: [] }) });

      const [groupRes, clientsRes, logsRes, requestsRes] = await Promise.all([
        fetch(`${API_URL}/api/groups/${id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/clients`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(logsUrl, { headers: { 'Authorization': `Bearer ${token}` } }),
        requestsPromise
      ]);

      if (groupRes.ok) {
        const groupData = await groupRes.json();
        setGroup(groupData.group);
      }

      if (clientsRes.ok) {
        const clientsData = await clientsRes.json();
        setClients((clientsData.clients || []).filter((c: Client) => c.group_id === id));
      }

      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData.logs || []);
      }

      if (requestsRes.ok) {
        const requestsData = await requestsRes.json();
        setJoinRequests(requestsData.requests || []);
      }
    } catch (e) {
      console.error('Failed to fetch data:', e);
    }
  };

  const handleApproveRequest = async (requestId: number) => {
    await fetch(`${API_URL}/api/join/join-requests/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, group_id: id, join_token: 'AUTO' })
    });
    fetchData();
  };

  const handleRejectRequest = async (requestId: number) => {
    await fetch(`${API_URL}/api/join/join-requests/reject`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, group_id: id, reason: 'Rejected' })
    });
    fetchData();
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [id, token, logFilter]);

  const controlGroup = async (action: 'start' | 'pause' | 'resume' | 'stop') => {
    try {
      await fetch(`${API_URL}/api/groups/${id}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchData();
    } catch (e) {
      console.error(`Failed to ${action}:`, e);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'TRAINING': return 'bg-green-900/50 text-green-400';
      case 'PAUSED': return 'bg-yellow-900/50 text-yellow-400';
      case 'COMPLETED': return 'bg-blue-900/50 text-blue-400';
      default: return 'bg-gray-700 text-gray-400';
    }
  };

  const formatAccuracyPercent = (value: number | null | undefined) => {
    const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const pct = v <= 1 ? v * 100 : v;
    return `${pct.toFixed(1)}%`;
  };

  if (!group) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const progress = (group.window_status?.pending_updates || 0) / group.window_config.window_size;
  const latestMetric = group.metrics_history && group.metrics_history.length > 0
    ? group.metrics_history[group.metrics_history.length - 1]
    : null;
  const avgClientAccuracy = clients.length > 0
    ? clients.reduce((sum, c) => sum + (c.local_accuracy || 0), 0) / clients.length
    : 0;
  const avgClientLoss = clients.length > 0
    ? clients.reduce((sum, c) => sum + (c.local_loss || 0), 0) / clients.length
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => router.push('/dashboard/groups')} className="p-2 hover:bg-gray-800 rounded-lg transition">
          <ArrowLeft size={20} className="text-gray-400" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{group.group_id}</h1>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(group.status)}`}>
              {group.status}
            </span>
          </div>
          <p className="text-gray-400">{group.model_id} • Version {group.model_version}</p>
        </div>

        {user?.role === 'admin' && (
          <div className="flex gap-2">
            {group.is_training && (
              <>
                <button onClick={() => controlGroup('pause')} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg text-white font-medium transition flex items-center gap-2">
                  <Pause size={16} /> Pause
                </button>
                <button onClick={() => controlGroup('stop')} className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white font-medium transition flex items-center gap-2">
                  <Square size={16} /> Stop
                </button>
              </>
            )}
            {group.status === 'PAUSED' && (
              <button onClick={() => controlGroup('resume')} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-white font-medium transition flex items-center gap-2">
                <Play size={16} /> Resume
              </button>
            )}
            {!group.is_training && group.status !== 'COMPLETED' && group.status !== 'PAUSED' && (
              <div className="text-sm text-gray-400 italic">
                Training will start automatically when clients join
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-b border-gray-800">
        {['overview', 'participants', 'models', 'logs', 'privacy'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-sm font-medium capitalize transition border-b-2 ${activeTab === tab
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-gray-400 hover:text-white'
              }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          {!group.is_training && group.status !== 'COMPLETED' && (
            <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 flex items-start gap-3">
              <Activity size={20} className="text-blue-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-300">Auto-Start Enabled</p>
                <p className="text-xs text-blue-400 mt-1">
                  Training will automatically start when the first client joins this group. No manual start required.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <Users size={18} className="text-blue-400" />
                <span className="text-gray-400 text-sm">Clients</span>
              </div>
              <p className="text-2xl font-bold text-white">{group.client_count}</p>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp size={18} className="text-green-400" />
                <span className="text-gray-400 text-sm">Accuracy</span>
              </div>
              <p className="text-2xl font-bold text-green-400">
                {((latestMetric ? latestMetric.accuracy : avgClientAccuracy) * 100).toFixed(1)}%
              </p>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <Activity size={18} className="text-red-400" />
                <span className="text-gray-400 text-sm">Loss</span>
              </div>
              <p className="text-2xl font-bold text-red-400">
                {(latestMetric ? latestMetric.loss : avgClientLoss).toFixed(4)}
              </p>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <Activity size={18} className="text-indigo-400" />
                <span className="text-gray-400 text-sm">Version</span>
              </div>
              <p className="text-2xl font-bold text-white">v{group.model_version}</p>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Async Window</h3>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Updates: {group.window_status?.pending_updates || 0} / {group.window_config.window_size}</span>
                  <span className="text-gray-400">Time: {group.window_status?.time_remaining?.toFixed(1) || 0}s</span>
                </div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, progress * 100)}%` }} />
                </div>
              </div>
            </div>
            <p className="text-gray-400 text-sm">
              Hybrid: {group.window_config.window_size} updates OR {group.window_config.time_limit}s
            </p>
          </div>

          {group.metrics_history && group.metrics_history.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Accuracy Curve</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={group.metrics_history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="version" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} domain={[0, 1]} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                    <Area type="monotone" dataKey="accuracy" stroke="#22c55e" strokeWidth={2} fill="#22c55e" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Loss Curve</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={group.metrics_history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="version" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                    <Area type="monotone" dataKey="loss" stroke="#ef4444" strokeWidth={2} fill="#ef4444" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'participants' && (
        <div className="space-y-6">
          {/* Debug info */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-sm">User: {user?.username} | Role: {user?.role} | Requests: {joinRequests.length} | debug: {joinRequests.filter((r: any) => r.status === 'pending').length}</p>
          </div>

          {/* Pending Join Requests - Show for admin */}
          {(user?.role === 'admin') && joinRequests.filter((r: any) => r.status === 'pending').length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-yellow-400 mb-4">Pending Join Requests</h3>
              <div className="space-y-3">
                {joinRequests.filter((r: any) => r.status === 'pending').map((req: any) => (
                  <div key={req.id} className="flex items-center justify-between bg-gray-900 rounded-lg p-4">
                    <div>
                      <p className="text-white font-medium">User ID: {req.user_id} | Group: {req.group_id}</p>
                      <p className="text-gray-400 text-sm">{new Date(req.requested_at).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleApproveRequest(req.id)} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-white text-sm">Approve</button>
                      <button onClick={() => handleRejectRequest(req.id)} className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white text-sm">Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Show all join requests for debugging */}
          {user?.role === 'admin' && joinRequests.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <p className="text-white text-sm mb-2">All requests in state:</p>
              {joinRequests.map((r: any) => (
                <p key={r.id} className="text-gray-400 text-xs">ID={r.id}, group={r.group_id}, status={r.status}, user_id={r.user_id}</p>
              ))}
            </div>
          )}

          {/* Connected Clients */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {clients.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <Users size={48} className="mx-auto mb-4 opacity-50" />
                <p>No participants connected</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-950">
                  <tr>
                    <th className="text-left p-4 text-gray-400">Client</th>
                    <th className="text-left p-4 text-gray-400">Status</th>
                    <th className="text-left p-4 text-gray-400">Updates</th>
                    <th className="text-left p-4 text-gray-400">Accuracy</th>
                    <th className="text-left p-4 text-gray-400">Loss</th>
                    <th className="text-left p-4 text-gray-400">Trust</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client) => (
                    <tr key={client.client_id} className="border-t border-gray-800">
                      <td className="p-4 text-white font-mono">{client.client_id}</td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs ${client.status === 'active' ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                          {client.status}
                        </span>
                      </td>
                      <td className="p-4 text-gray-300">{client.updates_count || 0}</td>
                      <td className="p-4 text-green-400">{formatAccuracyPercent(client.local_accuracy)}</td>
                      <td className="p-4 text-red-400">{(client.local_loss || 0).toFixed(4)}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-gray-700 rounded-full">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${(client.trust_score || 0) * 100}%` }} />
                          </div>
                          <span className="text-gray-400 text-sm">{(client.trust_score || 0).toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScrollText size={18} className="text-gray-400" />
              <span className="text-gray-400 text-sm">{logs.length} events</span>
            </div>
            <div className="flex gap-3">
              <select
                value={logFilter || ''}
                onChange={(e) => setLogFilter(e.target.value || null)}
                className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value="">All Events</option>
                <option value="client_joined">Client Joined</option>
                <option value="client_update">Client Update</option>
                <option value="aggregation">Aggregation</option>
                <option value="training_started">Training Started</option>
                <option value="training_started_notify">Training Notify</option>
              </select>
              <button onClick={fetchData} className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition">
                <RefreshCw size={16} className="text-gray-400" />
              </button>
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
              <Clock size={48} className="mx-auto text-gray-600 mb-4" />
              <h3 className="text-white font-semibold mb-2">No logs yet</h3>
              <p className="text-gray-400">Events will appear here as clients train and push updates</p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="max-h-[500px] overflow-y-auto">
                {logs.map((log, idx) => {
                  const typeColor: Record<string, string> = {
                    training_started: 'text-green-400',
                    training_started_notify: 'text-green-400',
                    aggregation: 'text-blue-400',
                    client_joined: 'text-purple-400',
                    client_update: 'text-yellow-400',
                    client_rejected: 'text-red-400',
                  };
                  const typeBg: Record<string, string> = {
                    training_started: 'bg-green-900/20 border-green-900/40',
                    training_started_notify: 'bg-green-900/20 border-green-900/40',
                    aggregation: 'bg-blue-900/20 border-blue-900/40',
                    client_joined: 'bg-purple-900/20 border-purple-900/40',
                    client_update: 'bg-yellow-900/20 border-yellow-900/40',
                    client_rejected: 'bg-red-900/20 border-red-900/40',
                  };
                  return (
                    <div key={idx} className={`p-3 border-b border-gray-800 ${typeBg[log.type] || 'bg-gray-900/20 border-gray-800'}`}>
                      <div className="flex items-start gap-3">
                        <span className="text-gray-500 text-xs font-mono min-w-[70px] pt-0.5">
                          {new Date(log.timestamp * 1000).toLocaleTimeString()}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs font-medium uppercase ${typeColor[log.type] || 'text-gray-400'}`}>
                            {log.type.replace(/_/g, ' ')}
                          </span>
                          <p className="text-white text-sm mt-0.5">{log.message}</p>
                          {log.details && Object.keys(log.details).length > 0 && (
                            <pre className="text-gray-500 text-xs mt-1 font-mono truncate">
                              {JSON.stringify(log.details)}
                            </pre>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'privacy' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Differential Privacy</h3>
            <div className="space-y-3">
              <div className="flex justify-between p-3 bg-gray-950 rounded-lg">
                <span className="text-gray-400">Status</span>
                <span className={group.config.dp_enabled ? 'text-green-400' : 'text-gray-500'}>
                  {group.config.dp_enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Training Config</h3>
            <div className="space-y-3">
              <div className="flex justify-between p-3 bg-gray-950 rounded-lg">
                <span className="text-gray-400">Epochs</span>
                <span className="text-white">{group.config.local_epochs}</span>
              </div>
              <div className="flex justify-between p-3 bg-gray-950 rounded-lg">
                <span className="text-gray-400">Batch Size</span>
                <span className="text-white">{group.config.batch_size}</span>
              </div>
              <div className="flex justify-between p-3 bg-gray-950 rounded-lg">
                <span className="text-gray-400">Learning Rate</span>
                <span className="text-white">{group.config.lr}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'models' && (
        <div className="space-y-6">
          {/* Current Model Info */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Box size={20} className="text-indigo-400" />
                <h3 className="text-lg font-semibold text-white">Global Model</h3>
              </div>
              <button
                onClick={() => window.open(`${API_URL}/api/models/${group.group_id}/download`, '_blank')}
                disabled={group.model_version === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-white text-sm font-medium transition flex items-center gap-2"
              >
                <Download size={16} />
                Download Latest (v{group.model_version})
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-gray-950 rounded-lg">
                <p className="text-gray-400 text-sm">Model</p>
                <p className="text-white font-medium mt-1">{group.model_id}</p>
              </div>
              <div className="p-4 bg-gray-950 rounded-lg">
                <p className="text-gray-400 text-sm">Current Version</p>
                <p className="text-white font-medium mt-1">v{group.model_version}</p>
              </div>
              <div className="p-4 bg-gray-950 rounded-lg">
                <p className="text-gray-400 text-sm">Completed Rounds</p>
                <p className="text-white font-medium mt-1">{group.completed_rounds || 0}</p>
              </div>
            </div>
          </div>

          {/* Accuracy/Loss Chart */}
          {group.metrics_history && group.metrics_history.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Training Progress</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={group.metrics_history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis
                      dataKey="version"
                      stroke="#6b7280"
                      label={{ value: 'Round', position: 'insideBottomRight', offset: -5, fill: '#6b7280' }}
                    />
                    <YAxis stroke="#6b7280" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                      labelFormatter={(v) => `Round ${v}`}
                    />
                    <Area type="monotone" dataKey="accuracy" stroke="#818cf8" fill="#818cf844" name="Accuracy" />
                    <Area type="monotone" dataKey="loss" stroke="#f87171" fill="#f8717144" name="Loss" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Version History Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Version History</h3>
            {group.metrics_history && group.metrics_history.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-400 py-3 px-4 font-medium">Version</th>
                      <th className="text-left text-gray-400 py-3 px-4 font-medium">Accuracy</th>
                      <th className="text-left text-gray-400 py-3 px-4 font-medium">Loss</th>
                      <th className="text-left text-gray-400 py-3 px-4 font-medium">Clients</th>
                      <th className="text-left text-gray-400 py-3 px-4 font-medium">Timestamp</th>
                      <th className="text-right text-gray-400 py-3 px-4 font-medium">Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...group.metrics_history].reverse().map((metric: GroupMetrics, i: number) => (
                      <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition">
                        <td className="py-3 px-4 text-white font-medium">v{metric.version}</td>
                        <td className="py-3 px-4">
                          <span className="text-indigo-400 font-mono">
                            {formatAccuracyPercent(metric.accuracy)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-red-400 font-mono">
                            {typeof metric.loss === 'number' ? metric.loss.toFixed(4) : '—'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-300">{metric.clients || '—'}</td>
                        <td className="py-3 px-4 text-gray-400 text-xs">
                          {metric.timestamp ? new Date(metric.timestamp * 1000).toLocaleString() : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => window.open(`${API_URL}/api/models/${group.group_id}/download?version=${metric.version}`, '_blank')}
                            className="p-1.5 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-indigo-400"
                            title={`Download v${metric.version}`}
                          >
                            <Download size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No training rounds completed yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
