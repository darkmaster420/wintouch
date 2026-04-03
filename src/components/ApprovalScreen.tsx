"use client";

import { useState } from "react";
import type { LaunchableApp } from "@/lib/types";

type Props = {
  pending: LaunchableApp[];
  onDone: () => void;
};

export function ApprovalScreen({ pending, onDone }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pending.map((a) => a.path)));
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = filter.trim()
    ? pending.filter((a) => a.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : pending;

  function toggle(appPath: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(appPath)) next.delete(appPath);
      else next.add(appPath);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(pending.map((a) => a.path)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function finish() {
    setSaving(true);
    const toApprove = pending.filter((a) => selected.has(a.path)).map((a) => a.path);
    const toReject = pending.filter((a) => !selected.has(a.path)).map((a) => a.path);
    if (toApprove.length > 0) await window.wintouch?.approveApps(toApprove);
    if (toReject.length > 0) await window.wintouch?.rejectApps(toReject);
    onDone();
  }

  return (
    <main className="setup-shell">
      <section className="setup-card approval-card">
        <h1>Choose your apps</h1>
        <p className="setup-subtitle">
          {pending.length} executables found — select the ones you want in your library.
        </p>

        <p className="approval-count">
          {selected.size} of {pending.length} selected
        </p>

        <div className="approval-toolbar">
          <input
            className="approval-filter"
            type="text"
            placeholder="Filter..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            inputMode="search"
          />
          <button type="button" className="action-button" onClick={selectAll}>All</button>
          <button type="button" className="action-button" onClick={selectNone}>None</button>
        </div>

        <div className="approval-list">
          {filtered.map((app) => (
            <label key={app.id} className={`approval-row${selected.has(app.path) ? " checked" : ""}`}>
              <input
                type="checkbox"
                checked={selected.has(app.path)}
                onChange={() => toggle(app.path)}
              />
              {app.icon ? (
                <img className="approval-row-icon" src={app.icon} alt={app.name} draggable={false} />
              ) : (
                <span className="approval-row-mark">
                  {app.name.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("")}
                </span>
              )}
              <span className="approval-row-info">
                <span className="approval-row-name">{app.name}</span>
                <span className="folder-path">{app.path}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="setup-actions">
          <button
            type="button"
            className="action-button primary"
            onClick={() => void finish()}
            disabled={saving}
          >
            {saving ? "Saving..." : `Add ${selected.size} app${selected.size !== 1 ? "s" : ""} to library`}
          </button>
        </div>
      </section>
    </main>
  );
}
