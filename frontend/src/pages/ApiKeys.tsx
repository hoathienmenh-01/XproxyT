import React, {useCallback, useEffect, useState} from 'react';
import {useI18n} from '../i18n';

type ApiKey = {
  id: string;
  display_suffix: string;
  client_name: string;
  is_active: number;
  created_at: string;
};

export default function ApiKeys() {
  const {t} = useI18n();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [clientName, setClientName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  async function generateKey() {
    if (!clientName.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({client_name: clientName.trim()}),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setGeneratedKey(data.rawApiKey);
        setShowGenerate(false);
        setClientName('');
        loadKeys();
      } else {
        setError(data.error || 'Failed to generate key');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setGenerating(false);
    }
  }

  async function toggleKey(id: string) {
    try {
      const res = await fetch(`/api/admin/keys/${id}/toggle`, {method: 'PATCH'});
      if (res.ok) {
        loadKeys();
      }
    } catch {}
  }

  return (
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Security</p>
          <h2>API Keys Management</h2>
          <p className="muted">Manage API keys for accessing the proxy's /v1 endpoints. Keys are required for external clients.</p>
        </div>
        <div className="action-row">
          <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>
            + Generate New Key
          </button>
        </div>
      </div>

      {/* Generated key modal */}
      {generatedKey && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}} onClick={() => setGeneratedKey(null)}>
          <div style={{background: 'var(--bg-1)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)', maxWidth: 600, width: '90%'}} onClick={e => e.stopPropagation()}>
            <h3 style={{color: 'var(--ok)', marginBottom: 'var(--sp-4)'}}>✅ API Key Generated</h3>
            <div style={{background: 'var(--bg-raised)', padding: 'var(--sp-4)', borderRadius: 'var(--r-sm)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', wordBreak: 'break-all', color: 'var(--text-1)', marginBottom: 'var(--sp-4)'}}>
              {generatedKey}
            </div>
            <div style={{background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)'}}>
              <p style={{color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600, margin: 0}}>
                ⚠️ Copy this key now! It will NOT be shown again for security reasons.
              </p>
            </div>
            <div style={{display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => {
                navigator.clipboard.writeText(generatedKey);
              }}>
                📋 Copy Key
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setGeneratedKey(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate form */}
      {showGenerate && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}} onClick={() => setShowGenerate(false)}>
          <div style={{background: 'var(--bg-1)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)', maxWidth: 400, width: '90%'}} onClick={e => e.stopPropagation()}>
            <h3 style={{marginBottom: 'var(--sp-4)'}}>Generate New API Key</h3>
            <div style={{marginBottom: 'var(--sp-4)'}}>
              <label style={{display: 'block', fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: 'var(--sp-2)'}}>
                Client Name
              </label>
              <input
                type="text"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder="e.g. my-app, team-alpha..."
                style={{width: '100%', padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-3)', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: '0.85rem'}}
                onKeyDown={e => e.key === 'Enter' && generateKey()}
              />
            </div>
            {error && (
              <div style={{background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)', color: 'var(--danger)', fontSize: '0.82rem'}}>
                {error}
              </div>
            )}
            <div style={{display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowGenerate(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={generateKey} disabled={generating || !clientName.trim()}>
                {generating ? 'Generating...' : 'Generate Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keys table */}
      {loading ? (
        <div className="loading-container">
          <div className="spinner spinner-lg" />
          <p>Loading API keys...</p>
        </div>
      ) : (
        <div className="surface-card">
          <div className="surface-card-head">
            <h3>Active Keys</h3>
            <span className="badge badge-accent">{keys.length} keys</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Key Suffix</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{textAlign: 'center', padding: 'var(--sp-6)', color: 'var(--text-4)'}}>
                      No API keys yet. Generate one to get started.
                    </td>
                  </tr>
                ) : (
                  keys.map(key => (
                    <tr key={key.id}>
                      <td style={{fontFamily: 'var(--font-mono)', fontSize: '0.78rem'}}>{key.client_name || 'unnamed'}</td>
                      <td><code style={{background: 'var(--bg-raised)', padding: '2px 6px', borderRadius: 'var(--r-sm)'}}>sk-luna-...{key.display_suffix}</code></td>
                      <td>
                        <span className={`status-pill status-${key.is_active === 1 ? 'alive' : 'dead'}`}>
                          {key.is_active === 1 ? 'Active' : 'Revoked'}
                        </span>
                      </td>
                      <td style={{fontSize: '0.78rem', color: 'var(--text-3)'}}>{new Date(key.created_at).toLocaleDateString()}</td>
                      <td>
                        <button
                          className={`btn btn-sm ${key.is_active === 1 ? 'btn-danger' : 'btn-secondary'}`}
                          onClick={() => toggleKey(key.id)}
                        >
                          {key.is_active === 1 ? 'Revoke' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}