import React, {useEffect, useState} from 'react';
import {useI18n} from '../i18n';

type WorkspaceDiagnostics = {
  activeLocks: number;
  trackedSessions: number;
  recentChangeCount: number;
  hotFiles: string[];
};

type GitStatus = {
  isRepo: boolean;
  branch: string;
  dirtyFiles: string[];
  ahead: number;
  behind: number;
  lastCommit: string;
  lastCommitMessage: string;
};

export default function Workspace() {
  const {t} = useI18n();
  const [diag, setDiag] = useState<WorkspaceDiagnostics | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [cleanupResult, setCleanupResult] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadWorkspace() {
    try {
      const [diagRes, gitRes] = await Promise.all([
        fetch('/api/workspace/diagnostics'),
        fetch('/api/workspace/git-status'),
      ]);
      if (diagRes.ok) setDiag(await diagRes.json());
      if (gitRes.ok) setGit(await gitRes.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace data');
    } finally {
      setLoading(false);
    }
  }

  async function cleanupLocks() {
    try {
      const res = await fetch('/api/workspace/cleanup-locks', {method: 'POST'});
      if (res.ok) {
        const data = await res.json();
        setCleanupResult(data.cleaned);
        await loadWorkspace();
      }
    } catch {}
  }

  useEffect(() => {
    loadWorkspace();
    const timer = window.setInterval(loadWorkspace, 5000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading) return (
    <section className="page-panel">
      <div className="loading-container">
        <div className="spinner spinner-lg" />
        <p>Loading workspace...</p>
      </div>
    </section>
  );

  return (
    <section className="page-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Phase 8 — Workspace Scheduler</p>
          <h2>Workspace Diagnostics</h2>
          <p className="muted">File locks, git status, and conflict detection for multi-agent coordination.</p>
        </div>
      </div>

      {error && (
        <div className="inline-message error" style={{marginBottom: 'var(--sp-4)'}}>
          ✗ {error}
        </div>
      )}

      <div className="metric-grid">
        <article className="metric-card">
          <h3>Active File Locks</h3>
          <p className="metric-value">{diag?.activeLocks ?? 0}</p>
        </article>
        <article className="metric-card">
          <h3>Tracked Sessions</h3>
          <p className="metric-value">{diag?.trackedSessions ?? 0}</p>
        </article>
        <article className="metric-card">
          <h3>Recent Changes</h3>
          <p className="metric-value">{diag?.recentChangeCount ?? 0}</p>
        </article>
        <article className="metric-card">
          <h3>Hot Files</h3>
          <p className="metric-value">{diag?.hotFiles?.length ?? 0}</p>
        </article>
      </div>

      <section className="surface-card" style={{marginBottom: 16}}>
        <div className="surface-card-head">
          <h3>Hot Files (Currently Locked)</h3>
          <button className="btn btn-sm btn-secondary" onClick={cleanupLocks}>Cleanup Locks</button>
        </div>
        {diag?.hotFiles && diag.hotFiles.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>File Path</th></tr>
              </thead>
              <tbody>
                {diag.hotFiles.map((file, i) => (
                  <tr key={i}><td style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{file}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No files currently locked.</p>
        )}
        {cleanupResult !== null && (
          <p className="muted" style={{marginTop: 8}}>Cleaned up {cleanupResult} expired lock(s).</p>
        )}
      </section>

      <section className="surface-card">
        <div className="surface-card-head">
          <h3>Git Status</h3>
        </div>
        {git?.isRepo ? (
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                <tr><td><strong>Branch</strong></td><td>{git.branch}</td></tr>
                <tr><td><strong>Last Commit</strong></td><td>{git.lastCommit} — {git.lastCommitMessage}</td></tr>
                <tr><td><strong>Dirty Files</strong></td><td>{git.dirtyFiles.length}</td></tr>
                <tr><td><strong>Ahead/Behind</strong></td><td>{git.ahead} ahead, {git.behind} behind</td></tr>
              </tbody>
            </table>
            {git.dirtyFiles.length > 0 && (
              <div style={{marginTop: 12}}>
                <h4 style={{marginBottom: 8}}>Modified Files</h4>
                <ul style={{margin: 0, paddingLeft: 20}}>
                  {git.dirtyFiles.slice(0, 30).map((file, i) => (
                    <li key={i} style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{file}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="muted">Not inside a git repository, or git is not available.</p>
        )}
      </section>
    </section>
  );
}