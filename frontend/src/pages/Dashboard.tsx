import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useI18n} from '../i18n';

type ConfigData = {
  providers?: Array<{id: string; name?: string; credentials?: Record<string, string>}>;
  proxy?: {host?: string; port?: number; key?: string};
  models?: Array<{id: string; name: string}>;
  modelsUpdatedAt?: number;
  settings?: Record<string, any>;
};

type LogItem = {level: string; message: string; timestamp: number};
type LogStats = {total: number; errors: number; chatRequests: number};
type HealthData = {
  status: string;
  version?: string;
  uptime?: number;
  uptimeHuman?: string;
  activeSessions?: number;
  activeRuns?: number;
  memory?: { rss?: string; heapUsed?: string; heapTotal?: string };
  timestamp?: string;
};
type RuntimeRun = {
  id: string;
  status: string;
  providerId?: string;
  accountId?: string;
  providerChatId?: string;
  sessionId?: string;
  workerId?: string;
  startedAt?: number;
};
type RuntimeData = {
  config?: Record<string, any>;
  locks?: Record<string, {locked?: boolean; ownerId?: string; capacity?: number; capacityMax?: number; queued?: number}>;
  activeRuns?: RuntimeRun[];
  leases?: Array<{runId: string; capacityKeys: string[]; lockKeys: string[]; released: boolean}>;
  workers?: Array<{id: string; providerId?: string; status?: string; lastVerifiedIp?: string}>;
};

function parseLog(log: LogItem): Record<string, any> {
  try {
    return JSON.parse(log.message);
  } catch {
    return {message: log.message};
  }
}

function SkeletonCard() {
  return (
    <article className="metric-card">
      <div className="skeleton skeleton-text" style={{width: '60%', height: 10, marginBottom: 12}} />
      <div className="skeleton skeleton-text" style={{width: '40%', height: 28, marginBottom: 8}} />
      <div className="skeleton skeleton-text" style={{width: '80%', height: 10}} />
    </article>
  );
}

function SkeletonTable({rows = 3, cols = 5}: {rows?: number; cols?: number}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {Array.from({length: cols}).map((_, i) => (
              <th key={i}><div className="skeleton" style={{height: 10, width: `${50 + Math.random() * 40}%`}} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({length: rows}).map((_, ri) => (
            <tr key={ri}>
              {Array.from({length: cols}).map((_, ci) => (
                <td key={ci}><div className="skeleton" style={{height: 12, width: `${40 + Math.random() * 50}%`}} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  const {t} = useI18n();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logStats, setLogStats] = useState<LogStats>({total: 0, errors: 0, chatRequests: 0});
  const [runtime, setRuntime] = useState<RuntimeData | null>(null);
  const [health, setHealth] = useState<'online' | 'offline' | 'checking'>('checking');
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const requestInFlight = useRef(false);

  async function loadDashboard(initial = false) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (initial) setLoading(true);
    try {
      const [configRes, logsRes, statsRes, runtimeRes, healthRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/logs?limit=20'),
        fetch('/api/logs/stats'),
        fetch('/api/runtime'),
        fetch('/health'),
      ]);
      if (configRes.ok) setConfig(await configRes.json());
      if (logsRes.ok) setLogs(await logsRes.json());
      if (statsRes.ok) setLogStats(await statsRes.json());
      if (runtimeRes.ok) setRuntime(await runtimeRes.json());
      if (healthRes.ok) {
        setHealth('online');
        setHealthData(await healthRes.json());
      } else {
        setHealth('offline');
        setHealthData(null);
      }
      setLastUpdated(Date.now());
    } catch {
      setHealth('offline');
    } finally {
      if (initial) setLoading(false);
      requestInFlight.current = false;
    }
  }

  useEffect(() => {
    let active = true;
    const tick = async () => {
      if (!active) return;
      await loadDashboard(true);
    };
    void tick();
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const stats = useMemo(() => {
    const providers = config?.providers || [];
    const configuredProviders = providers.filter(p => p.credentials && Object.keys(p.credentials).length > 0);
    const activeRuns = runtime?.activeRuns || [];
    const locks = runtime?.locks || {};
    const queued = Object.values(locks).reduce((sum, lock) => sum + Number(lock.queued || 0), 0);
    const activeCapacity = Object.values(locks).reduce((sum, lock) => sum + Number(lock.capacity || 0), 0);
    return {
      providers: configuredProviders.length,
      activeRuns: activeRuns.length,
      queued,
      activeCapacity,
      requests: logStats.chatRequests,
      errors: logStats.errors,
    };
  }, [config, logStats, runtime]);

  return (
    <section aria-labelledby="dashboard-title" className="page-panel dashboard-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('dashboard.eyebrow')}</p>
          <h2 id="dashboard-title">{t('dashboard.title')}</h2>
          <p className="muted">{t('dashboard.autoUpdate')}</p>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          {lastUpdated ? (
            <span className="muted" style={{fontSize: '0.72rem', fontFamily: 'var(--font-mono)'}}>
              {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          ) : null}
          <span className={`status-pill status-${health === 'online' ? 'alive' : health === 'offline' ? 'dead' : 'warn'}`}>
            {health}
          </span>
        </div>
      </div>

      {/* Primary metrics */}
      {loading ? (
        <div className="metric-grid metric-grid-primary">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : (
        <>
          <div className="metric-grid metric-grid-primary">
            <article className="metric-card metric-card-highlight">
              <div className="metric-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <h3>{t('dashboard.proxyHealth')}</h3>
              <p className="metric-value">
                <span className={`status-pill status-${health === 'online' ? 'alive' : health === 'offline' ? 'dead' : 'warn'}`}>
                  {health === 'online' ? t('dashboard.ready') : health === 'offline' ? t('dashboard.down') : t('dashboard.checking')}
                </span>
              </p>
              {healthData?.uptimeHuman && <p className="muted">⏱ Uptime: {healthData.uptimeHuman}</p>}
              {healthData?.memory && <p className="muted">💾 RAM: {healthData.memory.heapUsed} / {healthData.memory.rss}</p>}
              {healthData?.version && <p className="muted">v{healthData.version}</p>}
            </article>
            <article className="metric-card">
              <h3>{t('dashboard.activeRuns')}</h3>
              <p className="metric-value">{stats.activeRuns}</p>
              <p className="muted">Live sessions: {healthData?.activeSessions ?? '-'}</p>
            </article>
            <article className="metric-card">
              <h3>{t('dashboard.configuredProviders')}</h3>
              <p className="metric-value">{stats.providers}</p>
              <p className="muted">{t('dashboard.schedulerState')}</p>
            </article>
            <article className="metric-card">
              <h3>{t('dashboard.queuedRuns')}</h3>
              <p className="metric-value">{stats.queued}</p>
              <p className="muted">{t('dashboard.waitingCapacity')}</p>
            </article>
          </div>

          {/* Secondary metrics */}
          <div className="metric-grid">
            <article className="metric-card">
              <h3>{t('dashboard.capacityInUse')}</h3>
              <p className="metric-value">{stats.activeCapacity}</p>
            </article>
            <article className="metric-card">
              <h3>{t('dashboard.recentRequests')}</h3>
              <p className="metric-value">{stats.requests}</p>
            </article>
            <article className="metric-card">
              <h3>{t('dashboard.recentErrors')}</h3>
              <p className="metric-value" style={{color: stats.errors > 0 ? 'var(--danger)' : undefined}}>{stats.errors}</p>
            </article>
          </div>
        </>
      )}

      {/* Runtime Scheduler */}
      <section className="surface-card" aria-labelledby="runtime-title" style={{marginBottom: 16}}>
        <div className="surface-card-head">
          <h3 id="runtime-title">{t('dashboard.runtimeScheduler')}</h3>
          {lastUpdated ? <span className="muted">{t('common.updated')} {new Date(lastUpdated).toLocaleTimeString()}</span> : null}
        </div>
        {loading ? (
          <div style={{padding: 'var(--sp-5)'}}>
            <SkeletonTable rows={3} cols={7} />
          </div>
        ) : runtime?.activeRuns?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('nav.runs')}</th>
                  <th>{t('label.status')}</th>
                  <th>{t('label.provider')}</th>
                  <th>{t('label.account')}</th>
                  <th>{t('label.session')}</th>
                  <th>{t('label.worker')}</th>
                  <th>{t('label.started')}</th>
                </tr>
              </thead>
              <tbody>
                {runtime.activeRuns.map((run) => (
                  <tr key={run.id}>
                    <td style={{fontFamily: 'var(--font-mono)', fontSize: '0.78rem'}}>{run.id.slice(0, 8)}</td>
                    <td><span className={`status-pill status-${run.status === 'streaming' ? 'alive' : run.status === 'queued' ? 'warn' : 'alive'}`}>{run.status}</span></td>
                    <td>{run.providerId || '-'}</td>
                    <td>{run.accountId || '-'}</td>
                    <td style={{fontFamily: 'var(--font-mono)', fontSize: '0.78rem'}}>{run.sessionId ? run.sessionId.slice(0, 8) : '-'}</td>
                    <td>{run.workerId || '-'}</td>
                    <td>{run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{padding: 'var(--sp-5)'}}>{t('dashboard.noActiveRuns')}</p>
        )}
        {!loading && runtime?.locks && Object.keys(runtime.locks).length > 0 ? (
          <div className="table-wrap" style={{borderTop: '1px solid var(--border-1)'}}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('dashboard.lockCapacityKey')}</th>
                  <th>{t('label.active')}</th>
                  <th>{t('label.max')}</th>
                  <th>{t('label.queued')}</th>
                  <th>{t('label.owner')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(runtime.locks).map(([key, lock]) => (
                  <tr key={key}>
                    <td style={{fontFamily: 'var(--font-mono)', fontSize: '0.78rem'}}>{key}</td>
                    <td>{lock.capacity || 0}</td>
                    <td>{lock.capacityMax || '-'}</td>
                    <td>{lock.queued || 0}</td>
                    <td style={{fontFamily: 'var(--font-mono)', fontSize: '0.78rem'}}>{lock.ownerId ? lock.ownerId.slice(0, 8) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* Recent Requests */}
      <section className="surface-card" aria-labelledby="recent-title">
        <div className="surface-card-head">
          <h3 id="recent-title">{t('dashboard.recentRequests')}</h3>
          {lastUpdated ? <span className="muted">{t('common.updated')} {new Date(lastUpdated).toLocaleTimeString()}</span> : null}
        </div>
        {loading ? (
          <div style={{padding: 'var(--sp-5)'}}>
            <SkeletonTable rows={5} cols={5} />
          </div>
        ) : logs.length === 0 ? (
          <p className="muted" style={{padding: 'var(--sp-5)'}}>{t('dashboard.noRequestLogs')}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('label.time')}</th>
                  <th>{t('label.level')}</th>
                  <th>{t('label.path')}</th>
                  <th>{t('label.model')}</th>
                  <th>{t('label.status')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 20).map((log, index) => {
                  const meta = parseLog(log);
                  return (
                    <tr key={`${log.timestamp}-${index}`}>
                      <td>{new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td><span className={`status-pill status-${log.level === 'error' ? 'dead' : 'alive'}`}>{log.level}</span></td>
                      <td>{meta.path || '-'}</td>
                      <td>{meta.model || '-'}</td>
                      <td>{meta.status || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}