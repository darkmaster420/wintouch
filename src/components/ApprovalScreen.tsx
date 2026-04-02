"use client";

import { useState } from "react";
import type { LaunchableApp } from "@/lib/types";

type Props = {
  pending: LaunchableApp[];
  onDone: () => void;
};

export function ApprovalScreen({ pending, onDone }: Props) {
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const remaining = pending.filter(
    (app) => !accepted.has(app.path) && !rejected.has(app.path)
  );
  const current = remaining[0] ?? null;
  const progress = pending.length - remaining.length;

  function accept(appPath: string) {
    setAccepted((prev) => new Set([...prev, appPath]));
  }

  function reject(appPath: string) {
    setRejected((prev) => new Set([...prev, appPath]));
  }

  function acceptAll() {
    setAccepted((prev) => {
      const next = new Set(prev);
      for (const app of remaining) next.add(app.path);
      return next;
    });
  }

  function rejectAll() {
    setRejected((prev) => {
      const next = new Set(prev);
      for (const app of remaining) next.add(app.path);
      return next;
    });
  }

  async function finish() {
    setSaving(true);
    const toApprove = [...accepted];
    const toReject = [...rejected];
    if (toApprove.length > 0) await window.wintouch?.approveApps(toApprove);
    if (toReject.length > 0) await window.wintouch?.rejectApps(toReject);
    onDone();
  }

  // Auto-finish when all items are decided
  const allDecided = remaining.length === 0 && pending.length > 0;

  return (
    <main className="setup-shell">
      <section className="setup-card approval-card">
        <h1>Review found apps</h1>
        <p className="setup-subtitle">
          {pending.length} executables found — approve the ones you want in your library.
        </p>

        <div className="approval-progress">
          <div
            className="approval-progress-bar"
            style={{ width: `${pending.length > 0 ? (progress / pending.length) * 100 : 0}%` }}
          />
        </div>
        <p className="approval-count">
          {progress} of {pending.length} reviewed · {accepted.size} added · {rejected.size} skipped
        </p>

        {current && !allDecided ? (
          <div className="approval-item">
            {current.icon && (
              <img className="approval-item-icon" src={current.icon} alt={current.name} draggable={false} />
            )}
            <div className="approval-item-info">
              <span className="approval-item-name">{current.name}</span>
              <span className="folder-path">{current.path}</span>
            </div>
            <div className="approval-item-actions">
              <button
                type="button"
                className="action-button reject-btn"
                onClick={() => reject(current.path)}
              >
                Skip
              </button>
              <button
                type="button"
                className="action-button primary"
                onClick={() => accept(current.path)}
              >
                Add to library
              </button>
            </div>
          </div>
        ) : null}

        <div className="setup-actions">
          {!allDecided && remaining.length > 0 && (
            <>
              <button type="button" className="action-button" onClick={rejectAll}>
                Skip all remaining
              </button>
              <button type="button" className="action-button primary" onClick={acceptAll}>
                Add all remaining
              </button>
            </>
          )}
          {allDecided && (
            <button
              type="button"
              className="action-button primary"
              onClick={() => void finish()}
              disabled={saving}
            >
              {saving ? "Saving..." : `Done — open launcher`}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
