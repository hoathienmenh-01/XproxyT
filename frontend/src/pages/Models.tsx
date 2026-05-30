import React, {useCallback, useEffect, useState} from 'react';
import {useI18n} from '../i18n';

type ModelItem = {
  id: string;
  name: string;
  description?: string;
  maxContextLength?: string;
  maxSummaryGenerationLength?: string;
  maxGenerationLength?: string;
  maxThinkingGenerationLength?: string;
  modality?: string[];
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function TestModelSection({models}: {models: string[]}) {
  const [testModel, setTestModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
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
      const res = await fetch('/api/admin/test-model', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model, prompt: customPrompt || undefined}),
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
        <div style={{marginBottom: 'var(--sp-3)'}}>
          <textarea
            placeholder="Type your custom prompt here... (leave empty for default 'Hello, respond with just OK')"
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border-3)',
              background: 'var(--bg-raised)',
              color: 'var(--text-2)',
              fontSize: '0.82rem',
              fontFamily: 'var(--font-mono)',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-1)'}}>
            <span className="muted" style={{fontSize: '0.72rem'}}>Custom prompt sent to the model (optional)</span>
            {customPrompt && (
              <button className="btn btn-secondary btn-sm" style={{fontSize: '0.7rem', padding: '2px 8px'}} onClick={() => setCustomPrompt('')}>Clear</button>
            )}
          </div>
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

export default function Models() {
  const {t} = useI18n();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelItem | null>(null);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      setModels(items);
      setUpdatedAt(data?.updatedAt || null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('models.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  async function refreshModels() {
    setRefreshing(true);
    setMessage(t('models.refreshingCatalog'));
    try {
      const res = await fetch('/api/models/refresh', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data?.error || t('models.refreshFailed'));
        return;
      }
      setMessage(t('models.loadedCatalog', {count: data.count}));
      await loadModels();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('models.refreshFailed'));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section aria-labelledby="models-title" className="page-panel models-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('models.eyebrow')}</p>
          <h2 id="models-title">{t('nav.models')}</h2>
        </div>
        <span className="status-pill status-alive">{t('models.count', {count: models.length})}</span>
      </div>

      <div className="surface-card">
        <p className="muted">{t('models.providerSource')}</p>
        <div className="action-row">
        <button onClick={refreshModels} disabled={refreshing || loading}>
          {refreshing ? t('models.refreshing') : t('models.refreshCatalog')}
        </button>
        {updatedAt ? <span className="muted">{t('common.updated')}: {new Date(updatedAt).toLocaleString()}</span> : null}
        </div>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      {loading ? <p className="muted">{t('models.loading')}</p> : null}
      {!loading && models.length === 0 ? <p className="muted">{t('models.empty')}</p> : null}

      <ul className="model-grid">
        {models.map((m) => (
          <li
            key={m.id}
            className="model-item clickable-row"
            tabIndex={0}
            onClick={() => setSelectedModel(m)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setSelectedModel(m);
            }}
          >
            <div className="model-name">{m.name}</div>
            <div className="model-meta muted">{m.id}</div>
            {m.maxContextLength ? <div className="model-meta muted">{t('models.context')}: {m.maxContextLength}</div> : null}
          </li>
        ))}
      </ul>

      {/* Test Model Section — moved from Analytics */}
      <TestModelSection models={models.map(m => m.name || m.id)} />

      {selectedModel ? (
        <div className="detail-overlay" role="dialog" aria-modal="true" aria-labelledby="model-detail-title">
          <aside className="detail-panel">
            <button className="modal-close-btn" aria-label={t('common.close')} onClick={() => setSelectedModel(null)}>×</button>
            <div className="detail-heading">
              <p className="eyebrow">{t('models.detail')}</p>
              <h3 id="model-detail-title">{selectedModel.name}</h3>
              <p className="muted">{selectedModel.id}</p>
            </div>

            <div className="detail-content" style={{marginTop: 16}}>
              {selectedModel.description ? <p style={{marginTop: 0}}>{selectedModel.description}</p> : null}
              <dl className="detail-grid">
                <dt>{t('models.maxContext')}</dt><dd>{selectedModel.maxContextLength || '-'}</dd>
                <dt>{t('models.maxSummary')}</dt><dd>{selectedModel.maxSummaryGenerationLength || '-'}</dd>
                <dt>{t('models.maxGeneration')}</dt><dd>{selectedModel.maxGenerationLength || '-'}</dd>
                <dt>{t('models.maxThinking')}</dt><dd>{selectedModel.maxThinkingGenerationLength || '-'}</dd>
                <dt>{t('models.modality')}</dt><dd>{selectedModel.modality?.join(', ') || '-'}</dd>
              </dl>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}