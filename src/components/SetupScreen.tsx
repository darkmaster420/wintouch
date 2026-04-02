"use client";

import { useEffect, useState } from "react";
import type { SuggestedFolder, ScanConfig } from "@/lib/types";

type Props = {
  onComplete: () => void;
};

export function SetupScreen({ onComplete }: Props) {
  const [suggestions, setSuggestions] = useState<SuggestedFolder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.wintouch?.getSuggestedFolders().then((folders) => {
      setSuggestions(folders);
      // Pre-select folders that actually exist
      const existing = folders.filter((f) => f.exists).map((f) => f.path);
      setSelected(new Set(existing));
    });
  }, []);

  function toggleFolder(folderPath: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }

  async function addCustomFolder() {
    const picked = await window.wintouch?.pickFolder();
    if (picked && !selected.has(picked) && !custom.includes(picked)) {
      setCustom((prev) => [...prev, picked]);
      setSelected((prev) => new Set([...prev, picked]));
    }
  }

  function removeCustomFolder(folderPath: string) {
    setCustom((prev) => prev.filter((p) => p !== folderPath));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(folderPath);
      return next;
    });
  }

  async function handleFinish() {
    setSaving(true);
    const config: ScanConfig = {
      scanFolders: [...selected, ...custom.filter((c) => !selected.has(c))],
      setupComplete: true,
      approvedApps: [],
      rejectedApps: [],
    };
    await window.wintouch?.saveScanConfig(config);
    onComplete();
  }

  return (
    <main className="setup-shell">
      <section className="setup-card">
        <h1>Welcome to Wintouch</h1>
        <p className="setup-subtitle">
          Choose which folders to scan for apps and games.
        </p>

        <div className="setup-section">
          <h2>Common folders</h2>
          <div className="folder-list">
            {suggestions.map((folder) => (
              <button
                key={folder.path}
                type="button"
                className={`folder-option ${selected.has(folder.path) ? "selected" : ""} ${!folder.exists ? "missing" : ""}`}
                onClick={() => toggleFolder(folder.path)}
                disabled={!folder.exists}
              >
                <span className="folder-check">{selected.has(folder.path) ? "✓" : ""}</span>
                <span className="folder-info">
                  <span className="folder-label">{folder.label}</span>
                  <span className="folder-path">{folder.path}</span>
                </span>
                {!folder.exists && <span className="folder-badge">Not found</span>}
              </button>
            ))}
          </div>
        </div>

        {custom.length > 0 && (
          <div className="setup-section">
            <h2>Custom folders</h2>
            <div className="folder-list">
              {custom.map((folderPath) => (
                <div key={folderPath} className="folder-option selected">
                  <span className="folder-check">✓</span>
                  <span className="folder-info">
                    <span className="folder-label">{folderPath.split("\\").pop()}</span>
                    <span className="folder-path">{folderPath}</span>
                  </span>
                  <button
                    type="button"
                    className="folder-remove"
                    onClick={() => removeCustomFolder(folderPath)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="setup-actions">
          <button type="button" className="action-button" onClick={() => void addCustomFolder()}>
            Add custom folder
          </button>
          <button
            type="button"
            className="action-button primary"
            onClick={() => void handleFinish()}
            disabled={selected.size === 0 || saving}
          >
            {saving ? "Saving..." : `Start scanning (${selected.size} folders)`}
          </button>
        </div>
      </section>
    </main>
  );
}
