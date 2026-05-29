import React, {useEffect, useState} from 'react';

type UsageData = {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  byModel: Array<{model: string; count: number}>;
  requestsPerHour: Array<{hour: string; count: number}>;
  errors: Array<{error: string; count: number}>;
  estimatedCost: number;
  streamingRequests: number;
  nonStreamingRequests: number;
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function MetricCard({label, value, sub, icon, color, highlight}: {label: string; value: string; sub?: string; icon: React.ReactNode; color?: string; highlight?: boolean}) {
  return (
    <div style={{
      background: highlight ? 'linear-gradient(135deg, rgba(129,140,248,0.08), rgba(168,85,247,0.04))' : 'var(--bg-surface)',
      border: '1px solid var(--border-2)',
      borderRadius: 'var(--r-lg)',
      padding: '20px',
      position: 'relative' as const,
      overflow: 'hidden',
      transition: 'all 180ms ease',
    }}>
      {highlight && <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--accent), #a78bfa, var(--ok))'}} />}
      <div style={{color: color || 'var(--accent)', opacity: 0.7, marginBottom: 10}}>{icon}</div>
      <div style={{fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--text-4)', marginBottom: 6}}>{label}</div>
      <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.02em', lineHeight: 1.15}}>{value}</div>
      {sub && <div style={{marginTop: 4, fontSize: '0.75rem', color: 'var(--text-4)'}}>{sub}</div>}
    </div>
  );
}

function BarChart({data, maxVal}: {data: Array<{label: string; value: number}>; maxVal: number}) {
  if (data.length === 0) return <p style={{color: 'var(--text-4)', fontSize: '0.82rem', padding: 16}}>No data</p>;
  return (
    <div style={{display: 'flex', flexDirection: 'column' as const, gap: 8}}>
      {data.map((item, i) => (
        <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <span style={{minWidth: 140, fontSize: '0.78rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const}} title={item.label}>
            {item.label}
          </span>
          <div style={{flex: 1, height: 22, background: 'var(--bg-raised)', borderRadius: 'var(--r-sm)', overflow: 'hidden'}}>
            <div style={{
              height: '100%',
              width: maxVal > 0 ? `${Math.max(2, (item.value / maxVal) * 100)}%` : '0%',
              background: 'linear-gradient(90deg, var(--accent), var(--accent-bright))',
              borderRadius: 'var(--r-sm)',
              transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
              opacity: 0.85,
            }} />
          </div>
          <span style={{minWidth: 50, fontSize: '0.75rem', color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textAlign: 'right' as const}}>
            {formatNumber(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniSparkline({data, width = 240, height = 50}: {data: number[]; width?: number; height?: number}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * (height - 4) - 2}`).join(' ');
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} style={{display: 'block', opacity: 0.9}}>
      <defs>
        <linearGradient id="sparkGrad2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#sparkGrad2)" />
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Card({title, badge, children}: {title: string; badge?: React.ReactNode; children: React.ReactNode}) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-2)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.03)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 20px',
        borderBottom: '1px solid var(--border-1)',
      }}>
        <h3 style={{fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-1)', margin: 0}}>{title}</h3>
        {badge}
      </div>
      <div style={{padding: '20px'}}>{children}</div>
    </div>
  );
}

export default function AnalyticsWindow() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/usage');
      if (res.ok) {
        setData(await res.json());
        setLastUpdated(Date.now());
      }
    } catch {} finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-void)',
      color: 'var(--text-2)',
      fontFamily: 'var(--font-sans)',
      padding: '32px 40px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 32,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.68rem', fontWeight: 600,
            letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            color: 'var(--accent)', opacity: 0.8, marginBottom: 4,
          }}>Usage Analytics</div>
          <h1 style={{
            fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.025em',
            color: 'var(--text-1)', margin: 0, lineHeight: 1.25,
          }}>Analytics Dashboard</h1>
          <p style={{color: 'var(--text-4)', fontSize: '0.82rem', marginTop: 4}}>
            Request volume, token usage, cost estimation, and model breakdown.
          </p>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <span style={{fontSize: '0.72rem', color: 'var(--text-5)', fontFamily: 'var(--font-mono)'}}>
            Updated {new Date(lastUpdated).toLocaleTimeString()}
          </span>
          <button
            onClick={load}
            disabled={loading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', border: '1px solid var(--border-3)',
              borderRadius: 'var(--r-md)', background: 'var(--bg-raised)',
              color: 'var(--text-2)', fontSize: '0.82rem', fontWeight: 500,
              cursor: 'pointer', transition: 'all 180ms ease',
            }}
          >
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
          <a
            href="/"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', border: '1px solid var(--border-3)',
              borderRadius: 'var(--r-md)', background: 'var(--bg-raised)',
              color: 'var(--text-3)', fontSize: '0.82rem', fontWeight: 500,
              textDecoration: 'none', transition: 'all 180ms ease',
            }}
          >
            ← Back to Dashboard
          </a>
        </div>
      </div>

      {loading && !data ? (
        <div style={{display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 16}}>
          <div style={{width: 28, height: 28, border: '2.5px solid var(--border-3)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.6s linear infinite'}} />
          <p style={{color: 'var(--text-4)', fontSize: '0.82rem'}}>Loading analytics…</p>
        </div>
      ) : data ? (
        <>
          {/* Primary Metrics */}
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20}}>
            <MetricCard
              highlight
              label="Total Requests"
              value={formatNumber(data.totalRequests)}
              sub={`${data.successfulRequests} ok · ${data.failedRequests} failed`}
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
            />
            <MetricCard
              highlight
              label="Avg Latency"
              value={data.avgDurationMs > 0 ? `${(data.avgDurationMs / 1000).toFixed(1)}s` : '—'}
              sub="Per request"
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
            />
            <MetricCard
              highlight
              label="Success Rate"
              value={data.totalRequests > 0 ? `${Math.round((data.successfulRequests / data.totalRequests) * 100)}%` : '—'}
              sub={`${data.successfulRequests} / ${data.totalRequests}`}
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
            />
            <MetricCard
              highlight
              label="Streaming"
              value={formatNumber(data.streamingRequests)}
              sub={`of ${formatNumber(data.totalRequests)} total`}
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>}
            />
          </div>

          {/* Usage Section */}
          <Card title="Token Usage" badge={<span style={{fontSize: '0.72rem', color: 'var(--text-4)'}}>Token consumption</span>}>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 24, marginBottom: 20}}>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6}}>Input Tokens</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)'}}>{formatNumber(data.estimatedInputTokens)}</div>
                <div style={{fontSize: '0.7rem', color: 'var(--text-5)', marginTop: 2}}>prompt</div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6}}>Output Tokens</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--ok)'}}>{formatNumber(data.estimatedOutputTokens)}</div>
                <div style={{fontSize: '0.7rem', color: 'var(--text-5)', marginTop: 2}}>completion</div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6}}>Total Tokens</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-1)'}}>{formatNumber(data.totalTokens)}</div>
                <div style={{fontSize: '0.7rem', color: 'var(--text-5)', marginTop: 2}}>combined</div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6}}>Est. Cost</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--warn)'}}>${data.estimatedCost.toFixed(3)}</div>
                <div style={{fontSize: '0.7rem', color: 'var(--text-5)', marginTop: 2}}>Qwen pricing</div>
              </div>
            </div>
            {/* Usage bar */}
            <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0'}}>
              <span style={{fontSize: '0.72rem', color: 'var(--text-4)', minWidth: 50}}>Input</span>
              <div style={{flex: 1, height: 10, background: 'var(--bg-raised)', borderRadius: 'var(--r-full)', overflow: 'hidden'}}>
                <div style={{
                  height: '100%',
                  width: data.totalTokens > 0 ? `${(data.estimatedInputTokens / data.totalTokens) * 100}%` : '50%',
                  background: 'linear-gradient(90deg, var(--accent), var(--accent-bright))',
                  borderRadius: 'var(--r-full)',
                }} />
              </div>
              <span style={{fontSize: '0.72rem', color: 'var(--text-4)', minWidth: 50, textAlign: 'right'}}>Output</span>
              <div style={{flex: 1, height: 10, background: 'var(--bg-raised)', borderRadius: 'var(--r-full)', overflow: 'hidden'}}>
                <div style={{
                  height: '100%',
                  width: data.totalTokens > 0 ? `${(data.estimatedOutputTokens / data.totalTokens) * 100}%` : '50%',
                  background: 'linear-gradient(90deg, var(--ok), #34d399)',
                  borderRadius: 'var(--r-full)',
                }} />
              </div>
            </div>
          </Card>

          {/* Charts Row */}
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16}}>
            <Card
              title="Requests by Model"
              badge={<span style={{
                display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
                borderRadius: 'var(--r-full)', fontFamily: 'var(--font-mono)', fontSize: '0.62rem',
                fontWeight: 600, background: 'var(--accent-soft)', color: 'var(--accent-bright)',
                border: '1px solid rgba(129,140,248,0.12)',
              }}>{data.byModel.length} models</span>}
            >
              <BarChart
                data={data.byModel.map(m => ({label: m.model, value: m.count}))}
                maxVal={Math.max(...data.byModel.map(m => m.count), 1)}
              />
            </Card>

            <Card title="Requests per Hour" badge={<span style={{fontSize: '0.72rem', color: 'var(--text-4)'}}>Last 24h</span>}>
              {data.requestsPerHour.length > 0 ? (
                <div style={{display: 'flex', flexDirection: 'column' as const, gap: 16}}>
                  <div style={{display: 'flex', justifyContent: 'center'}}>
                    <MiniSparkline data={data.requestsPerHour.map(h => h.count)} width={400} height={60} />
                  </div>
                  <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-5)', fontFamily: 'var(--font-mono)'}}>
                    <span>{data.requestsPerHour[0]?.hour || ''}</span>
                    <span>{data.requestsPerHour[data.requestsPerHour.length - 1]?.hour || ''}</span>
                  </div>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, textAlign: 'center' as const}}>
                    <div>
                      <div style={{fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--font-mono)'}}>
                        {Math.max(...data.requestsPerHour.map(h => h.count))}
                      </div>
                      <div style={{fontSize: '0.68rem', color: 'var(--text-4)', textTransform: 'uppercase' as const, letterSpacing: '0.06em'}}>Peak</div>
                    </div>
                    <div>
                      <div style={{fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--font-mono)'}}>
                        {Math.round(data.requestsPerHour.reduce((s, h) => s + h.count, 0) / Math.max(data.requestsPerHour.length, 1))}
                      </div>
                      <div style={{fontSize: '0.68rem', color: 'var(--text-4)', textTransform: 'uppercase' as const, letterSpacing: '0.06em'}}>Avg / hr</div>
                    </div>
                    <div>
                      <div style={{fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--font-mono)'}}>
                        {data.requestsPerHour.length}
                      </div>
                      <div style={{fontSize: '0.68rem', color: 'var(--text-4)', textTransform: 'uppercase' as const, letterSpacing: '0.06em'}}>Active Hours</div>
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{color: 'var(--text-4)', fontSize: '0.82rem'}}>No hourly data yet</p>
              )}
            </Card>
          </div>

          {/* Error Breakdown */}
          {data.errors.length > 0 && (
            <Card
              title="Error Breakdown"
              badge={<span style={{
                display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
                borderRadius: 'var(--r-full)', fontFamily: 'var(--font-mono)', fontSize: '0.62rem',
                fontWeight: 600, background: 'var(--danger-soft)', color: 'var(--danger)',
                border: '1px solid rgba(248,113,113,0.12)',
              }}>{data.failedRequests} errors</span>}
            >
              <BarChart
                data={data.errors.map(e => ({label: e.error, value: e.count}))}
                maxVal={Math.max(...data.errors.map(e => e.count), 1)}
              />
            </Card>
          )}
        </>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '80px 0'}}>
          <div style={{fontSize: '2.5rem', opacity: 0.3, marginBottom: 16}}>📊</div>
          <div style={{fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 8}}>No usage data</div>
          <div style={{fontSize: '0.82rem', color: 'var(--text-4)', maxWidth: 360, textAlign: 'center' as const, lineHeight: 1.6}}>
            Start making requests through the proxy to see analytics.
          </div>
        </div>
      )}

      {/* Keyframes for spinner */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        a:hover { color: var(--accent-bright) !important; }
        button:hover { background: var(--bg-hover) !important; border-color: var(--border-4) !important; color: var(--text-1) !important; }
        @media (max-width: 1024px) {
          div[style*="grid-template-columns: repeat(4"] { grid-template-columns: repeat(2, 1fr) !important; }
          div[style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
          div[style*="grid-template-columns: repeat(4"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}