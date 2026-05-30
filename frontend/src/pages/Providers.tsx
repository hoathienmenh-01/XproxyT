import React, {useEffect, useState} from 'react';
import {useI18n} from '../i18n';

type ProviderAccountConfig = { id: string; name?: string; enabled?: boolean; credentials?: Record<string,string>; maxConcurrentRuns?: number; networkProfileId?: string; status?: string };
type ProviderConfig = { id: string; name?: string; credentials?: Record<string,string>; oauth?: any; accounts?: ProviderAccountConfig[] };
type ProviderStatus = 'alive' | 'warn' | 'dead';

type ApiKey = {
  id: string;
  display_suffix: string;
  client_name: string;
  account_id: string | null;
  is_active: number;
  created_at: string;
};

const builtinProviders = [
  { id: 'qwen-ai', name: 'Qwen AI', subtitle: 'International • Alibaba Cloud', loginUrl: 'https://chat.qwen.ai', icon: '🧠' },
];

// Provider logo/icon component
function ProviderIcon({id, size = 44}: {id: string; size?: number}) {
  const colors: Record<string, string> = {
    'qwen-ai': 'linear-gradient(135deg, #6366f1, #8b5cf6)',
  };
  const bg = colors[id] || 'linear-gradient(135deg, var(--accent), var(--info))';
  return (
    <div style={{
      width: size, height: size,
      borderRadius: 'var(--r-lg)',
      background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45,
      flexShrink: 0,
      boxShadow: '0 4px 16px rgba(99,102,241,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
      border: '1px solid rgba(255,255,255,0.1)',
    }}>
      {id === 'qwen-ai' ? '🧠' : '⚡'}
    </div>
  );
}

// Status indicator with label
function StatusIndicator({status}: {status: ProviderStatus}) {
  const cls = status === 'alive' ? 'status-alive' : status === 'warn' ? 'status-warn' : 'status-dead';
  const label = status === 'alive' ? 'Connected' : status === 'warn' ? 'Pending' : 'Disconnected';
  return (
    <span className={`status-pill ${cls}`}>
      {label}
    </span>
  );
}

// Credential pill component
function CredentialPill({name, value}: {name: string; value: string}) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)',
      padding: '4px 10px',
      background: 'var(--bg-raised)',
      border: '1px solid var(--border-2)',
      borderRadius: 'var(--r-full)',
      fontSize: '0.72rem',
      fontFamily: 'var(--font-mono)',
    }}>
      <span style={{color: 'var(--text-4)', fontWeight: 500}}>{name}:</span>
      <span style={{color: 'var(--text-2)'}}>{value.slice(0, 16)}…</span>
    </div>
  );
}

export default function Providers() {
  const {t} = useI18n();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'config'|'oauth'>('config');
  const [tokenValue, setTokenValue] = useState('');
  const [cookieValue, setCookieValue] = useState('');
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [validationType, setValidationType] = useState<'ok'|'error'|'info'|null>(null);
  const [oauthPolling, setOauthPolling] = useState(false);
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({});
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showAccountKeyGen, setShowAccountKeyGen] = useState<string | null>(null);
  const [accountKeyName, setAccountKeyName] = useState('');
  const [generatingAccountKey, setGeneratingAccountKey] = useState(false);
  const [generatedAccountKey, setGeneratedAccountKey] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState<string | null>(null); // providerId
  const [newAccountId, setNewAccountId] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountToken, setNewAccountToken] = useState('');
  const [newAccountCookies, setNewAccountCookies] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  const [addAccountError, setAddAccountError] = useState<string | null>(null);
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState<{providerId: string; accountId: string} | null>(null);

  useEffect(() => { loadConfig(); loadApiKeys(); }, []);

  async function loadApiKeys() {
    try {
      const res = await fetch('/api/admin/keys');
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch {}
  }

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const items = data.providers || [];
      setProviders(items);
      await Promise.all(
        items.map(async (p: ProviderConfig) => {
          try {
            const s = await fetch(`/api/provider/status?providerId=${encodeURIComponent(p.id)}`);
            const d = await s.json();
            if (d?.status) setProviderStatus(prev => ({...prev, [p.id]: d.status as ProviderStatus}));
          } catch {
            setProviderStatus(prev => ({...prev, [p.id]: 'warn'}));
          }
        }),
      );
    } catch {
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }

  const configured = providers.filter(p => p.credentials && Object.keys(p.credentials).length > 0);

  // Get all accounts for a provider (including implicit "local" account from provider-level credentials)
  function getProviderAccounts(p: ProviderConfig): ProviderAccountConfig[] {
    if (p.accounts && p.accounts.length > 0) return p.accounts;
    // Implicit "local" account from provider-level credentials
    if (p.credentials && Object.keys(p.credentials).length > 0) {
      return [{ id: p.id, name: p.name || p.id, enabled: true, credentials: p.credentials }];
    }
    return [];
  }

  function getKeysForAccount(accountId: string): ApiKey[] {
    return apiKeys.filter(k => k.account_id === accountId);
  }

  function getSharedKeys(): ApiKey[] {
    return apiKeys.filter(k => !k.account_id);
  }

  async function addAccount() {
    if (!showAddAccount || !newAccountId.trim()) return;
    setAddingAccount(true);
    setAddAccountError(null);
    try {
      const credentials: Record<string, string> = {};
      if (newAccountToken.trim()) credentials.token = newAccountToken.trim();
      if (newAccountCookies.trim()) credentials.cookies = newAccountCookies.trim();
      const res = await fetch(`/api/admin/providers/${showAddAccount}/accounts`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({id: newAccountId.trim(), name: newAccountName.trim() || newAccountId.trim(), credentials}),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setShowAddAccount(null);
        setNewAccountId('');
        setNewAccountName('');
        setNewAccountToken('');
        setNewAccountCookies('');
        loadConfig();
      } else {
        setAddAccountError(data.error || 'Failed to add account');
      }
    } catch (err) {
      setAddAccountError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setAddingAccount(false);
    }
  }

  async function deleteAccount(providerId: string, accountId: string) {
    try {
      const res = await fetch(`/api/admin/providers/${providerId}/accounts/${accountId}`, {method: 'DELETE'});
      if (res.ok) {
        setDeleteAccountConfirm(null);
        loadConfig();
        loadApiKeys();
      }
    } catch {}
  }

  // Total accounts across all providers (including implicit)
  function getTotalAccounts(): number {
    return configured.reduce((sum, p) => sum + getProviderAccounts(p).length, 0);
  }

  async function generateKeyForAccount(accountId: string, accountName: string) {
    if (!accountKeyName.trim()) return;
    setGeneratingAccountKey(true);
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({client_name: accountKeyName.trim(), account_id: accountId}),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setGeneratedAccountKey(data.rawApiKey);
        setShowAccountKeyGen(null);
        setAccountKeyName('');
        loadApiKeys();
      }
    } catch {} finally {
      setGeneratingAccountKey(false);
    }
  }

  function openAdd() {
    setSelected(null);
    setTokenValue('');
    setCookieValue('');
    setActiveTab('config');
    setValidationMsg(null);
    setValidationType(null);
    setShowModal(true);
  }

  function openEditor(p: ProviderConfig) {
    const built = builtinProviders.find(b => b.id === p.id) || {id: p.id, name: p.name || p.id, subtitle: 'Custom Provider', loginUrl: 'https://chat.qwen.ai', icon: '⚡'};
    setSelected(built);
    setTokenValue(p.credentials?.token || '');
    setCookieValue(p.credentials?.cookies || p.credentials?.cookie || '');
    setActiveTab('config');
    setValidationMsg(null);
    setValidationType(null);
    setShowModal(true);
  }

  function msg(text: string, type: 'ok'|'error'|'info') {
    setValidationMsg(text);
    setValidationType(type);
  }

  async function startOAuth() {
    if (!selected) return;
    setOauthPolling(true);
    msg(t('providers.oauthOpening'), 'info');
    try {
      const resp = await fetch('/api/provider/oauth/capture', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({providerId: selected.id, timeout: 300000}),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        msg(data.error || t('providers.oauthFailed'), 'error');
        return;
      }
      const creds = data.credentials || {};
      if (creds.token) setTokenValue(creds.token);
      if (creds.cookies) setCookieValue(creds.cookies);
      await loadConfig();
      msg(t('providers.oauthCaptured'), 'ok');
    } catch (err) {
      msg(err instanceof Error ? err.message : t('providers.oauthStartFailed'), 'error');
    } finally {
      setOauthPolling(false);
    }
  }

  async function validate() {
    if (!selected) return;
    msg(t('providers.checking'), 'info');
    const creds: any = {};
    const tokenKey = selected.id === 'qwen-ai' ? 'token' : 'ticket';
    const cookieKey = selected.id === 'qwen-ai' ? 'cookies' : 'cookie';
    if (tokenValue.trim()) creds[tokenKey] = tokenValue.trim();
    if (cookieValue.trim()) creds[cookieKey] = cookieValue.trim();
    if (Object.keys(creds).length === 0) {
      msg(activeTab === 'oauth' ? t('providers.startFirst') : t('providers.provideCredential'), 'error');
      return;
    }
    try {
      const resp = await fetch('/api/provider/validate', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({providerId: selected.id, credentials: creds}),
      });
      const data = await resp.json();
      msg(data?.ok ? t('providers.valid') : t('providers.invalid'), data?.ok ? 'ok' : 'error');
    } catch {
      msg(t('providers.validationFailed'), 'error');
    }
  }

  async function save() {
    if (!selected) return;
    const tokenKey = selected.id === 'qwen-ai' ? 'token' : 'ticket';
    const cookieKey = selected.id === 'qwen-ai' ? 'cookies' : 'cookie';
    const credentials: Record<string, string> = {};
    if (tokenValue.trim()) credentials[tokenKey] = tokenValue.trim();
    if (cookieValue.trim()) credentials[cookieKey] = cookieValue.trim();
    if (Object.keys(credentials).length === 0) {
      msg(t('providers.nothingToSave'), 'error');
      return;
    }
    await fetch('/api/provider/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({providerId: selected.id, credentials}),
    });
    await loadConfig();
    setShowModal(false);
  }

  return (
    <section className="page-panel">
      {/* Page Header */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('providers.config')}</p>
          <h2>{t('nav.providers')}</h2>
          <p className="muted" style={{marginTop: 'var(--sp-1)'}}>Quản lý kết nối đến AI providers để sử dụng qua proxy gateway</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={openAdd}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {t('providers.add')}
        </button>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="loading-container" style={{minHeight: 300}}>
          <div className="spinner spinner-lg" />
          <p>{t('common.loading')}</p>
        </div>
      ) : configured.length === 0 ? (
        /* Empty State */
        <div className="surface-card" style={{
          border: '1px dashed var(--border-3)',
          background: 'transparent',
        }}>
          <div className="empty-state">
            <div className="empty-state-icon">🔌</div>
            <div className="empty-state-title">Chưa có provider nào</div>
            <div className="empty-state-desc" style={{marginBottom: 'var(--sp-6)'}}>
              Thêm nhà cung cấp AI để bắt đầu proxy requests qua gateway
            </div>
            <button className="btn btn-primary" onClick={openAdd}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {t('providers.add')}
            </button>
          </div>
        </div>
      ) : (
        /* Provider Cards */
        <div className="management-panel">
          <div className="management-panel-header">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{opacity: 0.6}}>
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              Configured Providers
            </h3>
            <span className="badge badge-accent">{configured.length} active</span>
          </div>
          <div className="item-list" style={{padding: 'var(--sp-4) var(--sp-5)'}}>
            {configured.map(p => {
              const status = providerStatus[p.id] || 'warn';
              const credKeys = p.credentials ? Object.keys(p.credentials) : [];
              const builtin = builtinProviders.find(b => b.id === p.id);
              return (
                <div
                  key={p.id}
                  className="item-row"
                  onClick={() => openEditor(p)}
                  style={{cursor: 'pointer', padding: 'var(--sp-5)'}}
                >
                  {/* Left: Icon + Info */}
                  <div className="item-row-info" style={{gap: 'var(--sp-4)'}}>
                    <ProviderIcon id={p.id} size={48} />
                    <div style={{flex: 1, minWidth: 0}}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                        marginBottom: 'var(--sp-2)',
                      }}>
                        <span className="item-row-name" style={{fontSize: '0.95rem'}}>
                          {builtin?.name || p.name || p.id}
                        </span>
                        <span className="badge badge-accent">{p.id}</span>
                      </div>
                      <div style={{
                        fontSize: '0.78rem', color: 'var(--text-3)',
                        marginBottom: 'var(--sp-2)',
                      }}>
                        {builtin?.subtitle || 'Custom Provider'}
                      </div>
                      <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)',
                        alignItems: 'center',
                      }}>
                        {credKeys.map(k => (
                          <CredentialPill key={k} name={k} value={p.credentials![k] || ''} />
                        ))}
                        <span style={{
                          fontSize: '0.7rem', color: 'var(--text-5)',
                          fontFamily: 'var(--font-mono)',
                        }}>
                          {credKeys.length} credential{credKeys.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Status + Actions */}
                  <div className="item-row-actions">
                    <StatusIndicator status={status} />
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={(e) => { e.stopPropagation(); openEditor(p); }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                      {t('common.edit')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Accounts & API Keys Section */}
      {configured.length > 0 && (
        <div className="management-panel" style={{marginTop: 'var(--sp-6)'}}>
          <div className="management-panel-header">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{opacity: 0.6}}>
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
              </svg>
              Accounts & API Keys
            </h3>
            <span className="badge badge-accent">{getTotalAccounts()} accounts</span>
          </div>
          <div style={{padding: 'var(--sp-4) var(--sp-5)'}}>
            <p style={{fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: 'var(--sp-4)'}}>
              Mỗi tài khoản có thể gán API key riêng. Client dùng key nào sẽ chạy qua account đó — độc lập, không chia sẻ.
            </p>
            {configured.map(p => {
              const accounts = getProviderAccounts(p);
              return (
                <div key={p.id} style={{marginBottom: 'var(--sp-5)'}}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                    marginBottom: 'var(--sp-3)',
                  }}>
                    <ProviderIcon id={p.id} size={24} />
                    <span style={{fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-1)'}}>
                      {builtinProviders.find(b => b.id === p.id)?.name || p.name || p.id}
                    </span>
                    <span className="badge badge-accent" style={{fontSize: '0.68rem'}}>{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
                    {/* Add Account button for this provider */}
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={(e) => { e.stopPropagation(); setShowAddAccount(p.id); setAddAccountError(null); }}
                      style={{marginLeft: 'auto'}}
                    >
                      ➕ Thêm Tài Khoản
                    </button>
                  </div>

                  {accounts.map(acc => {
                    const isImplicitAccount = !p.accounts || p.accounts.length === 0;
                    const boundKeys = getKeysForAccount(acc.id);
                    return (
                      <div key={acc.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-4)',
                        padding: 'var(--sp-4) var(--sp-5)',
                        background: 'var(--bg-raised)',
                        border: '1px solid var(--border-2)',
                        borderRadius: 'var(--r-md)',
                        marginBottom: 'var(--sp-3)',
                      }}>
                        {/* Account info */}
                        <div style={{flex: 1, minWidth: 0}}>
                          <div style={{display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)'}}>
                            <span style={{
                              fontFamily: 'var(--font-mono)', fontSize: '0.82rem',
                              fontWeight: 600, color: 'var(--text-1)',
                            }}>
                              {acc.name || acc.id}
                            </span>
                            <span className={`status-pill status-${acc.enabled !== false ? 'alive' : 'dead'}`} style={{fontSize: '0.68rem'}}>
                              {acc.enabled !== false ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <div style={{fontSize: '0.72rem', color: 'var(--text-4)', fontFamily: 'var(--font-mono)', marginBottom: 'var(--sp-2)'}}>
                            ID: {acc.id}
                          </div>

                          {/* Keys for this account */}
                          {boundKeys.length > 0 ? (
                            <div style={{display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)'}}>
                              {boundKeys.map(k => (
                                <div key={k.id} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)',
                                  padding: '3px 10px',
                                  background: k.is_active === 1 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                                  border: `1px solid ${k.is_active === 1 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                                  borderRadius: 'var(--r-full)',
                                  fontSize: '0.72rem',
                                  fontFamily: 'var(--font-mono)',
                                }}>
                                  <span style={{color: k.is_active === 1 ? 'var(--ok)' : 'var(--danger)'}}>
                                    {k.is_active === 1 ? '🔑' : '🚫'}
                                  </span>
                                  <span style={{color: 'var(--text-2)'}}>
                                    sk-luna-...{k.display_suffix}
                                  </span>
                                  <span style={{color: 'var(--text-4)', fontSize: '0.68rem'}}>
                                    ({k.client_name || 'unnamed'})
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{fontSize: '0.75rem', color: 'var(--text-5)', marginTop: 'var(--sp-1)'}}>
                              Chưa có key nào — nhấn nút bên phải để tạo
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div style={{flexShrink: 0, display: 'flex', gap: 'var(--sp-2)', flexDirection: 'column'}}>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => setShowAccountKeyGen(acc.id)}
                            style={{whiteSpace: 'nowrap'}}
                          >
                            🔑 Tạo Key
                          </button>
                          {!isImplicitAccount && (
                            <button
                              className="btn btn-sm"
                              style={{background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', whiteSpace: 'nowrap'}}
                              onClick={() => setDeleteAccountConfirm({providerId: p.id, accountId: acc.id})}
                            >
                              🗑️ Xóa
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Shared keys (not bound to any account) */}
            {getSharedKeys().length > 0 && (
              <div style={{
                marginTop: 'var(--sp-3)',
                padding: 'var(--sp-4) var(--sp-5)',
                background: 'var(--bg-raised)',
                border: '1px dashed var(--border-3)',
                borderRadius: 'var(--r-md)',
              }}>
                <div style={{fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 'var(--sp-2)'}}>
                  🔓 Shared Keys (load-balanced across all accounts)
                </div>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)'}}>
                  {getSharedKeys().map(k => (
                    <div key={k.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)',
                      padding: '3px 10px',
                      background: 'rgba(99,102,241,0.1)',
                      border: '1px solid rgba(99,102,241,0.3)',
                      borderRadius: 'var(--r-full)',
                      fontSize: '0.72rem',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      <span style={{color: 'var(--accent)'}}>🔑</span>
                      <span style={{color: 'var(--text-2)'}}>sk-luna-...{k.display_suffix}</span>
                      <span style={{color: 'var(--text-4)', fontSize: '0.68rem'}}>({k.client_name || 'unnamed'})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Generate Key for Account Modal */}
      {showAccountKeyGen && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}} onClick={() => setShowAccountKeyGen(null)}>
          <div style={{background: 'var(--bg-1)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)', maxWidth: 450, width: '90%'}} onClick={e => e.stopPropagation()}>
            <h3 style={{marginBottom: 'var(--sp-4)'}}>🔑 Tạo Key cho Account</h3>
            <div style={{
              padding: 'var(--sp-3)', background: 'var(--bg-raised)',
              borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-4)',
              fontFamily: 'var(--font-mono)', fontSize: '0.82rem',
              border: '1px solid var(--border-2)',
            }}>
              <span style={{color: 'var(--text-4)'}}>Account: </span>
              <span style={{color: 'var(--accent)'}}>{showAccountKeyGen}</span>
            </div>
            <div style={{marginBottom: 'var(--sp-4)'}}>
              <label style={{display: 'block', fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: 'var(--sp-2)'}}>
                Tên client (mô tả)
              </label>
              <input
                type="text"
                value={accountKeyName}
                onChange={e => setAccountKeyName(e.target.value)}
                placeholder="e.g. my-app, claude-code-1..."
                style={{width: '100%', padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-3)', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: '0.85rem'}}
                onKeyDown={e => e.key === 'Enter' && generateKeyForAccount(showAccountKeyGen, showAccountKeyGen)}
              />
            </div>
            <div style={{display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAccountKeyGen(null)}>Hủy</button>
              <button className="btn btn-primary btn-sm" onClick={() => generateKeyForAccount(showAccountKeyGen, showAccountKeyGen)} disabled={generatingAccountKey || !accountKeyName.trim()}>
                {generatingAccountKey ? 'Đang tạo...' : 'Tạo Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generated Account Key Modal */}
      {generatedAccountKey && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}} onClick={() => setGeneratedAccountKey(null)}>
          <div style={{background: 'var(--bg-1)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)', maxWidth: 600, width: '90%'}} onClick={e => e.stopPropagation()}>
            <h3 style={{color: 'var(--ok)', marginBottom: 'var(--sp-4)'}}>✅ Key đã tạo thành công!</h3>
            <div style={{background: 'var(--bg-raised)', padding: 'var(--sp-4)', borderRadius: 'var(--r-sm)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', wordBreak: 'break-all', color: 'var(--text-1)', marginBottom: 'var(--sp-4)'}}>
              {generatedAccountKey}
            </div>
            <div style={{background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)'}}>
              <p style={{color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600, margin: 0}}>
                ⚠️ Copy key này ngay! Sẽ không hiển thị lại.
              </p>
            </div>
            <div style={{display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(generatedAccountKey)}>
                📋 Copy
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setGeneratedAccountKey(null)}>
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {showAddAccount && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}} onClick={() => setShowAddAccount(null)}>
          <div style={{background: 'var(--bg-1)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)', maxWidth: 500, width: '90%'}} onClick={e => e.stopPropagation()}>
            <h3 style={{marginBottom: 'var(--sp-4)'}}>➕ Thêm Tài Khoản Mới</h3>
            <div style={{padding: 'var(--sp-3)', background: 'var(--bg-raised)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-4)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', border: '1px solid var(--border-2)'}}>
              <span style={{color: 'var(--text-4)'}}>Provider: </span>
              <span style={{color: 'var(--accent)'}}>{showAddAccount}</span>
            </div>
            <div style={{marginBottom: 'var(--sp-4)'}}>
              <label style={{display: 'block', fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: 'var(--sp-2)'}}>ID tài khoản (duy nhất)</label>
              <input type="text" value={newAccountId} onChange={e => setNewAccountId(e.target.value)} placeholder="e.g. account-2, my-qwen-account..." style={{width: '100%', padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-3)', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)'}} />
            </div>
            <div style={{marginBottom: 'var(--sp-4)'}}>
              <label style={{display: 'block', fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: 'var(--sp-2)'}}>Tên hiển thị</label>
              <input type="text" value={newAccountName} onChange={e => setNewAccountName(e.target.value)} placeholder="e.g. Qwen Account #2..." style={{width: '100%', padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-3)', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: '0.85rem'}} />
            </div>
            <div style={{marginBottom: 'var(--sp-4)'}}>
              <label style={{display: 'block', fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: 'var(--sp-2)'}}>Token</label>
              <input type="text" value={newAccountToken} onChange={e => setNewAccountToken(e.target.value)} placeholder="tongyi_sso_ticket_xxx..." style={{width: '100%', padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-3)', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)'}} />
            </div>
            <div style={{marginBottom: 'var(--sp-4)'}}>
              <label style={{display: 'block', fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: 'var(--sp-2)'}}>Cookies</label>
              <textarea value={newAccountCookies} onChange={e => setNewAccountCookies(e.target.value)} placeholder="cna=xxx; token=xxx; xlly_s=xxx..." style={{width: '100%', padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-3)', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', minHeight: 70, resize: 'vertical'}} />
            </div>
            {addAccountError && (
              <div style={{background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)', color: 'var(--danger)', fontSize: '0.82rem'}}>{addAccountError}</div>
            )}
            <div style={{display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAddAccount(null)}>Hủy</button>
              <button className="btn btn-primary btn-sm" onClick={addAccount} disabled={addingAccount || !newAccountId.trim()}>
                {addingAccount ? 'Đang thêm...' : '➕ Thêm Tài Khoản'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation */}
      {deleteAccountConfirm && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}} onClick={() => setDeleteAccountConfirm(null)}>
          <div style={{background: 'var(--bg-1)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)', maxWidth: 400, width: '90%'}} onClick={e => e.stopPropagation()}>
            <h3 style={{color: 'var(--danger)', marginBottom: 'var(--sp-4)'}}>⚠️ Xóa Tài Khoản</h3>
            <p style={{fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: 'var(--sp-4)'}}>
              Bạn có chắc muốn xóa tài khoản <code>{deleteAccountConfirm.accountId}</code>? Các API key gán cho account này sẽ trở thành "shared".
            </p>
            <div style={{display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setDeleteAccountConfirm(null)}>Hủy</button>
              <button className="btn btn-danger btn-sm" onClick={() => deleteAccount(deleteAccountConfirm.providerId, deleteAccountConfirm.accountId)}>Xóa</button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Provider Modal */}
      {showModal && (
        <div className="confirm-overlay" onClick={() => setShowModal(false)}>
          <div
            className="modal-panel"
            style={{
              maxWidth: 580,
              padding: 0,
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--sp-5) var(--sp-6)',
              borderBottom: '1px solid var(--border-2)',
              background: 'var(--bg-raised)',
            }}>
              <div style={{display: 'flex', alignItems: 'center', gap: 'var(--sp-4)'}}>
                {selected && <ProviderIcon id={selected.id} size={36} />}
                <div>
                  <h3 style={{fontSize: '1rem', fontWeight: 700, color: 'var(--text-1)', margin: 0, lineHeight: 1.3}}>
                    {selected ? selected.name : t('providers.add')}
                  </h3>
                  {selected && (
                    <p style={{
                      fontSize: '0.75rem', color: 'var(--text-4)', margin: 0, marginTop: 'var(--sp-1)',
                      fontFamily: 'var(--font-mono)', letterSpacing: '0.02em',
                    }}>
                      {selected.subtitle || selected.id}
                    </p>
                  )}
                </div>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setShowModal(false)}
                style={{position: 'relative', top: 0, right: 0}}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Modal Body */}
            <div style={{padding: 'var(--sp-6)'}}>
              {/* Step 1: Select Provider */}
              {!selected ? (
                <div>
                  <p style={{
                    fontSize: '0.88rem', color: 'var(--text-3)', marginBottom: 'var(--sp-5)',
                    fontWeight: 500, lineHeight: 1.6,
                  }}>
                    Chọn nhà cung cấp AI để kết nối:
                  </p>
                  <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)'}}>
                    {builtinProviders.map(bp => (
                      <button
                        key={bp.id}
                        onClick={() => { setSelected(bp); setTokenValue(''); setCookieValue(''); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 'var(--sp-4)',
                          padding: 'var(--sp-5)',
                          background: 'var(--bg-raised)',
                          border: '1px solid var(--border-2)',
                          borderRadius: 'var(--r-lg)',
                          cursor: 'pointer',
                          transition: 'all var(--t-normal) var(--ease)',
                          textAlign: 'left',
                          width: '100%',
                          color: 'var(--text-2)',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                          (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)';
                          (e.currentTarget as HTMLElement).style.boxShadow = '0 0 16px var(--accent-soft)';
                          (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLElement).style.borderColor = '';
                          (e.currentTarget as HTMLElement).style.background = '';
                          (e.currentTarget as HTMLElement).style.boxShadow = '';
                          (e.currentTarget as HTMLElement).style.transform = '';
                        }}
                      >
                        <ProviderIcon id={bp.id} size={44} />
                        <div style={{flex: 1}}>
                          <div style={{fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-1)', marginBottom: 'var(--sp-1)'}}>{bp.name}</div>
                          <div style={{fontSize: '0.78rem', color: 'var(--text-4)'}}>{bp.subtitle}</div>
                        </div>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* Step 2: Configure Provider */
                <div>
                  {/* Tab Bar */}
                  <div className="tab-bar" style={{marginBottom: 'var(--sp-6)'}}>
                    <button
                      className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
                      onClick={() => setActiveTab('config')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{verticalAlign: '-2px', marginRight: 6}}>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                      {t('providers.config')}
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'oauth' ? 'active' : ''}`}
                      onClick={() => setActiveTab('oauth')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{verticalAlign: '-2px', marginRight: 6}}>
                        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                      </svg>
                      OAuth
                    </button>
                  </div>

                  {/* Config Tab */}
                  {activeTab === 'config' ? (
                    <div className="form-grid" style={{padding: 0, gap: 'var(--sp-5)'}}>
                      {/* Token Field */}
                      <div className="field">
                        <span style={{
                          display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" strokeWidth="2" strokeLinecap="round">
                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01"/>
                          </svg>
                          {t('providers.token')}
                        </span>
                        <input
                          type="text"
                          value={tokenValue}
                          onChange={e => setTokenValue(e.target.value)}
                          placeholder="tongyi_sso_ticket_xxx..."
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                          }}
                        />
                        <p className="field-hint">{t('providers.tokenHint')}</p>
                      </div>

                      {/* Cookie Field */}
                      <div className="field">
                        <span style={{
                          display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" strokeWidth="2" strokeLinecap="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                          </svg>
                          {t('providers.cookie')}
                        </span>
                        <textarea
                          value={cookieValue}
                          onChange={e => setCookieValue(e.target.value)}
                          placeholder="cna=xxx; token=xxx; xlly_s=xxx..."
                          style={{
                            minHeight: 90,
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.82rem',
                            resize: 'vertical',
                          }}
                        />
                      </div>

                      {/* Quick Actions */}
                      <div style={{
                        display: 'flex', gap: 'var(--sp-3)',
                        padding: 'var(--sp-4)',
                        background: 'var(--bg-raised)',
                        borderRadius: 'var(--r-md)',
                        border: '1px solid var(--border-2)',
                      }}>
                        <button className="btn btn-sm btn-secondary" style={{flex: 1}} onClick={() => window.open(selected.loginUrl || 'https://chat.qwen.ai', '_blank')}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          {t('providers.openLogin')}
                        </button>
                        <button className="btn btn-sm btn-secondary" style={{flex: 1}} onClick={startOAuth} disabled={oauthPolling}>
                          {oauthPolling ? (
                            <>
                              <div className="spinner" style={{width: 12, height: 12}} />
                              {t('providers.waitLogin')}
                            </>
                          ) : (
                            <>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                              {t('providers.startOAuth')}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* OAuth Tab */
                    <div>
                      <div style={{
                        padding: 'var(--sp-5)',
                        background: 'var(--bg-raised)',
                        borderRadius: 'var(--r-md)',
                        border: '1px solid var(--border-2)',
                        marginBottom: 'var(--sp-5)',
                      }}>
                        <div style={{
                          display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)',
                        }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" style={{flexShrink: 0, marginTop: 2}}>
                            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                          </svg>
                          <p style={{fontSize: '0.85rem', color: 'var(--text-3)', margin: 0, lineHeight: 1.7}}>
                            {t('providers.oauthHint')}
                          </p>
                        </div>
                      </div>
                      <button
                        className="btn btn-primary btn-lg"
                        onClick={startOAuth}
                        disabled={oauthPolling}
                        style={{width: '100%'}}
                      >
                        {oauthPolling ? (
                          <>
                            <div className="spinner" style={{width: 16, height: 16, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white'}} />
                            {t('providers.waitLogin')}
                          </>
                        ) : (
                          <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                            {t('providers.startOAuth')}
                          </>
                        )}
                      </button>
                      {(tokenValue || cookieValue) && (
                        <div style={{
                          marginTop: 'var(--sp-5)',
                          padding: 'var(--sp-4)',
                          background: 'var(--bg-raised)',
                          borderRadius: 'var(--r-md)',
                          border: '1px solid var(--border-2)',
                        }}>
                          <div style={{
                            fontSize: '0.68rem', color: 'var(--text-5)',
                            textTransform: 'uppercase', letterSpacing: '0.1em',
                            fontWeight: 700, marginBottom: 'var(--sp-3)',
                            fontFamily: 'var(--font-mono)',
                          }}>
                            Captured Credentials
                          </div>
                          <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)'}}>
                            {tokenValue && (
                              <div style={{
                                fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
                                color: 'var(--text-3)', padding: 'var(--sp-2) var(--sp-3)',
                                background: 'var(--bg-overlay)', borderRadius: 'var(--r-sm)',
                                border: '1px solid var(--border-1)',
                              }}>
                                <span style={{color: 'var(--text-5)', fontWeight: 600}}>token:</span> {tokenValue.slice(0, 24)}…
                              </div>
                            )}
                            {cookieValue && (
                              <div style={{
                                fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
                                color: 'var(--text-3)', padding: 'var(--sp-2) var(--sp-3)',
                                background: 'var(--bg-overlay)', borderRadius: 'var(--r-sm)',
                                border: '1px solid var(--border-1)',
                              }}>
                                <span style={{color: 'var(--text-5)', fontWeight: 600}}>cookies:</span> {cookieValue.slice(0, 24)}…
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Validation Message */}
                  {validationMsg && (
                    <div
                      className={`inline-message ${validationType === 'ok' ? 'ok' : validationType === 'error' ? 'error' : 'info'}`}
                      style={{marginTop: 'var(--sp-5)', width: '100%', justifyContent: 'center'}}
                    >
                      {validationType === 'ok' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                      ) : validationType === 'error' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      ) : (
                        <div className="spinner" style={{width: 14, height: 14}} />
                      )}
                      {validationMsg}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {selected && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 'var(--sp-4) var(--sp-6)',
                borderTop: '1px solid var(--border-2)',
                background: 'var(--bg-raised)',
              }}>
                <button className="btn btn-sm btn-ghost" onClick={() => { setSelected(null); setValidationMsg(null); }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                  Back
                </button>
                <div style={{display: 'flex', gap: 'var(--sp-3)'}}>
                  <button className="btn btn-secondary" onClick={validate}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {t('providers.validate')}
                  </button>
                  <button className="btn btn-primary" onClick={save}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    {t('providers.save')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}