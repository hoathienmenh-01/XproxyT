import React, {useEffect, useState} from 'react';
import {useI18n} from '../i18n';

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

function MetricCard({label, value, sub, icon, color}: {label: string; value: string; sub?: string; icon: React.ReactNode; color?: string}) {
  return (
    <article className="metric-card">
      <div className="metric-card-icon" style={color ? {color} : undefined}>{icon}</div>
      <h3>{label}</h3>
      <p className="metric-value">{value}</p>
      {sub && <p className="muted" style={{marginTop: 'var(--sp-1)', fontSize: '0.75rem'}}>{sub}</p>}
    </article>
  );
}

function BarChart({data, maxVal}: {data: Array<{label: string; value: number}>; maxVal: number}) {
  if (data.length === 0) return <p className="muted" style={{padding: 'var(--sp-4)'}}>No data</p>;
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)'}}>
      {data.map((item, i) => (
        <div key={i} style={{display: 'flex', alignItems: 'center', gap: 'var(--sp-3)'}}>
          <span style={{minWidth: 120, fontSize: '0.78rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={item.label}>
            {item.label}
          </span>
          <div style={{flex: 1, height: 20, background: 'var(--bg-raised)', borderRadius: 'var(--r-sm)', overflow: 'hidden', position: 'relative'}}>
            <div style={{
              height: '100%',
              width: maxVal > 0 ? `${Math.max(2, (item.value / maxVal) * 100)}%` : '0%',
              background: 'linear-gradient(90deg, var(--accent), var(--accent-bright))',
              borderRadius: 'var(--r-sm)',
              transition: 'width 0.5s var(--ease)',
              opacity: 0.8,
            }} />
          </div>
          <span style={{minWidth: 40, fontSize: '0.75rem', color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textAlign: 'right'}}>
            {formatNumber(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniSparkline({data}: {data: number[]}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 200;
  const h = 40;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  return (
    <svg width={w} height={h} style={{display: 'block', opacity: 0.8}}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#sparkGrad)" />
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TestModelSection({models}: {models: string[]}) {
  const [testModel, setTestModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);

  async function runTest() {
    const model = customModel || testModel;
    if (!model) return;
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await fetch('/api/test-model', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model}),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult(data);
      } else {
        setTestError(data.error || 'Test failed');
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="surface-card" style={{marginBottom: 'var(--sp-4)'}}>
      <div className="surface-card-head">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign: '-2px', marginRight: 6}}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Test Model
        </h3>
        <span className="muted" style={{fontSize: '0.72rem'}}>Check if a model is responding</span>
      </div>
      <div style={{padding: 'var(--sp-5)'}}>
        <div style={{display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', marginBottom: 'var(--sp-3)', flexWrap: 'wrap'}}>
          <select
            className="form-select"
            value={testModel}
            onChange={e => { setTestModel(e.target.value); setCustomModel(''); }}
            style={{padding: '6px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-3)', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: '0.82rem', minWidth: 180}}
          >
            <option value="">— Select model —</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="muted" style={{fontSize: '0.75rem'}}>or</span>
          <input
            type="text"
            placeholder="Custom model name..."
            value={customModel}
            onChange={e => { setCustomModel(e.target.value); setTestModel(''); }}
            style={{padding: '6px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-3)', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: '0.82rem', flex: 1, minWidth: 160}}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={runTest}
            disabled={testing || (!testModel && !customModel)}
          >
            {testing ? '⏳ Testing…' : '⚡ Run Test'}
          </button>
        </div>

        {testError && (
          <div style={{padding: 'var(--sp-3) var(--sp-4)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--r-sm)', color: 'var(--danger)', fontSize: '0.82rem'}}>
            ❌ {testError}
          </div>
        )}

        {testResult && (
          <div style={{padding: 'var(--sp-4)', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 'var(--r-sm)'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)'}}>
              <span style={{fontSize: '0.85rem', fontWeight: 600, color: 'var(--ok)'}}>✅ Model is working</span>
              <span className="badge badge-accent">{testResult.model}</span>
            </div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)'}}>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-4)'}}>Latency</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-1)'}}>{(testResult.durationMs / 1000).toFixed(1)}s</div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-4)'}}>Input Tokens</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)'}}>{formatNumber(testResult.usage?.prompt_tokens || 0)}</div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-4)'}}>Output Tokens</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--ok)'}}>{formatNumber(testResult.usage?.completion_tokens || 0)}</div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-4)'}}>Total Tokens</div>
                <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-1)'}}>{formatNumber(testResult.usage?.total_tokens || 0)}</div>
              </div>
            </div>
            {testResult.response && (
              <div style={{padding: 'var(--sp-2) var(--sp-3)', background: 'var(--bg-raised)', borderRadius: 'var(--r-sm)', fontSize: '0.78rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap'}}>
                Response: "{testResult.response}"
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Analytics() {
  const {t} = useI18n();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/usage');
      if (res.ok) setData(await res.json());
    } catch {} finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Usage Analytics</p>
          <h2>Analytics</h2>
          <p className="muted">Request volume, token usage, cost estimation, and model breakdown.</p>
        </div>
        <div className="action-row">
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="loading-container">
          <div className="spinner spinner-lg" />
          <p>Loading analytics…</p>
        </div>
      ) : data ? (
        <>
          {/* Primary Metrics */}
          <div className="metric-grid metric-grid-primary">
            <MetricCard
              label="Total Requests"
              value={formatNumber(data.totalRequests)}
              sub={`${data.successfulRequests} ok · ${data.failedRequests} failed`}
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
              }
            />
            <MetricCard
              label="Avg Latency"
              value={data.avgDurationMs > 0 ? `${(data.avgDurationMs / 1000).toFixed(1)}s` : '—'}
              sub="Per request"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              }
            />
            <MetricCard
              label="Success Rate"
              value={data.totalRequests > 0 ? `${Math.round((data.successfulRequests / data.totalRequests) * 100)}%` : '—'}
              sub={`${data.successfulRequests} / ${data.totalRequests}`}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              }
            />
            <MetricCard
              label="Streaming"
              value={formatNumber(data.streamingRequests)}
              sub={`of ${formatNumber(data.totalRequests)} total`}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              }
            />
          </div>

          {/* Usage Section */}
          <div className="surface-card" style={{marginBottom: 'var(--sp-4)'}}>
            <div className="surface-card-head">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign: '-2px', marginRight: 6}}>
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                </svg>
                Token Usage
              </h3>
            </div>
            <div style={{padding: 'var(--sp-5)'}}>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)'}}>
                <div style={{textAlign: 'center'}}>
                  <div style={{fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 4}}>Input Tokens</div>
                  <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent)'}}>{formatNumber(data.estimatedInputTokens)}</div>
                  <div style={{fontSize: '0.7rem', color: 'var(--text-5)', marginTop: 2}}>prompt</div>
                </div>
                <div style={{textAlign: 'center'}}>
                  <div style={{fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 4}}>Output Tokens</div>
                  <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--ok)'}}>{formatNumber(data.estimatedOutputTokens)}</div>
                  <div style={{fontSize: '0.7rem', color: 'var(--text-5)', marginTop: 2}}>completion</div>
                </div>
                <div style={{textAlign: 'center'}}>
                  <div style={{fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 4}}>Total Tokens</div>
                  <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-1)'}}>{formatNumber(data.totalTokens)}</div>
                  <div style={{fontSize: '0.7rem', color: 'var(--text-5)', marginTop: 2}}>combined</div>
                </div>
                <div style={{textAlign: 'center'}}>
                  <div style={{fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 4}}>Est. Cost</div>
                  <div style={{fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--warn)'}}>${data.estimatedCost.toFixed(3)}</div>
                  <div style={{fontSize: '0.7rem', color: 'var(--text-5)', marginTop: 2}}>Qwen pricing</div>
                </div>
              </div>
              {/* Usage bar */}
              <div style={{display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-3) 0'}}>
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
            </div>
          </div>

          {/* Charts Row */}
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)'}}>
            {/* Requests by Model */}
            <div className="surface-card">
              <div className="surface-card-head">
                <h3>Requests by Model</h3>
                <span className="badge badge-accent">{data.byModel.length} models</span>
              </div>
              <div style={{padding: 'var(--sp-5)'}}>
                <BarChart
                  data={data.byModel.map(m => ({label: m.model, value: m.count}))}
                  maxVal={Math.max(...data.byModel.map(m => m.count), 1)}
                />
              </div>
            </div>

            {/* Requests per Hour (sparkline) */}
            <div className="surface-card">
              <div className="surface-card-head">
                <h3>Requests per Hour</h3>
                <span className="muted" style={{fontSize: '0.72rem'}}>Last 24h</span>
              </div>
              <div style={{padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)'}}>
                {data.requestsPerHour.length > 0 ? (
                  <>
                    <MiniSparkline data={data.requestsPerHour.map(h => h.count)} />
                    <div style={{display: 'flex', justifyContent: 'space-between'}}>
                      <span style={{fontSize: '0.72rem', color: 'var(--text-5)', fontFamily: 'var(--font-mono)'}}>
                        {data.requestsPerHour[0]?.hour || ''}
                      </span>
                      <span style={{fontSize: '0.72rem', color: 'var(--text-5)', fontFamily: 'var(--font-mono)'}}>
                        {data.requestsPerHour[data.requestsPerHour.length - 1]?.hour || ''}
                      </span>
                    </div>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--sp-3)'}}>
                      <div style={{textAlign: 'center'}}>
                        <div style={{fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--font-mono)'}}>
                          {Math.max(...data.requestsPerHour.map(h => h.count))}
                        </div>
                        <div style={{fontSize: '0.68rem', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em'}}>Peak</div>
                      </div>
                      <div style={{textAlign: 'center'}}>
                        <div style={{fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--font-mono)'}}>
                          {Math.round(data.requestsPerHour.reduce((s, h) => s + h.count, 0) / data.requestsPerHour.length)}
                        </div>
                        <div style={{fontSize: '0.68rem', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em'}}>Avg/hr</div>
                      </div>
                      <div style={{textAlign: 'center'}}>
                        <div style={{fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--font-mono)'}}>
                          {data.requestsPerHour.length}
                        </div>
                        <div style={{fontSize: '0.68rem', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em'}}>Hours</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="muted">No hourly data yet</p>
                )}
              </div>
            </div>
          </div>

          {/* Test Model */}
          <TestModelSection models={data.byModel.map(m => m.model)} />

          {/* Error Breakdown */}
          {data.errors.length > 0 && (
            <div className="surface-card">
              <div className="surface-card-head">
                <h3>Error Breakdown</h3>
                <span className="badge badge-danger">{data.failedRequests} errors</span>
              </div>
              <div style={{padding: 'var(--sp-5)'}}>
                <BarChart
                  data={data.errors.map(e => ({label: e.error, value: e.count}))}
                  maxVal={Math.max(...data.errors.map(e => e.count), 1)}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-title">No usage data</div>
          <div className="empty-state-desc">Start making requests through the proxy to see analytics.</div>
        </div>
      )}
    </section>
  );
}