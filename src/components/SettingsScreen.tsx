"use client";

import { useEffect, useState } from "react";
import type { LaunchableApp, ScanConfig, SuggestedFolder } from "@/lib/types";

type Props = {
  onClose: () => void;
  iconSize: number;
  onIconSizeChange: (size: number) => void;
};

type Tab = "library" | "folders" | "skipped" | "appearance";

export function SettingsScreen({ onClose, iconSize, onIconSizeChange }: Props) {
  const [tab, setTab] = useState<Tab>("library");
  const [apps, setApps] = useState<LaunchableApp[]>([]);
  const [rejectedApps, setRejectedApps] = useState<LaunchableApp[]>([]);
  const [config, setConfig] = useState<ScanConfig | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedFolder[]>([]);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    const [loadedApps, loadedConfig, loadedSuggestions, loadedRejected] = await Promise.all([
      window.wintouch?.listApps() ?? [],
      window.wintouch?.getScanConfig() ?? null,
      window.wintouch?.getSuggestedFolders() ?? [],
      window.wintouch?.listRejectedApps() ?? [],
    ]);
    setApps(loadedApps);
    setConfig(loadedConfig);
    setSuggestions(loadedSuggestions);
    setRejectedApps(loadedRejected);
  }

  async function removeApp(appPath: string) {
    await window.wintouch?.removeApp(appPath);
    setApps((prev) => prev.filter((a) => a.path !== appPath));
  }

  async function restoreApp(appPath: string) {
    await window.wintouch?.unrejectApp(appPath);
    await window.wintouch?.approveApps([appPath]);
    setRejectedApps((prev) => prev.filter((a) => a.path !== appPath));
    // Refresh library to show the restored app
    const refreshed = await window.wintouch?.listApps() ?? [];
    setApps(refreshed);
  }

  async function toggleFolder(folderPath: string) {
    if (!config) return;
    const folders = new Set(config.scanFolders);
    if (folders.has(folderPath)) {
      folders.delete(folderPath);
    } else {
      folders.add(folderPath);
    }
    const updated = { ...config, scanFolders: [...folders] };
    await window.wintouch?.saveScanConfig(updated);
    setConfig(updated);
  }

  async function addCustomFolder() {
    const picked = await window.wintouch?.pickFolder();
    if (!picked || !config) return;
    if (config.scanFolders.includes(picked)) return;
    const updated = { ...config, scanFolders: [...config.scanFolders, picked] };
    await window.wintouch?.saveScanConfig(updated);
    setConfig(updated);
  }

  async function removeFolder(folderPath: string) {
    if (!config) return;
    const updated = {
      ...config,
      scanFolders: config.scanFolders.filter((f) => f !== folderPath),
    };
    await window.wintouch?.saveScanConfig(updated);
    setConfig(updated);
  }

  const activeFolders = config?.scanFolders ?? [];
  const suggestedNotAdded = suggestions.filter(
    (s) => s.exists && !activeFolders.includes(s.path)
  );

  return (
    <main className="setup-shell">
      <section className="setup-card settings-card">
        <div className="settings-header">
          <h1>Settings</h1>
          <button type="button" className="action-button" onClick={onClose}>
            Back to launcher
          </button>
        </div>

        <div className="settings-tabs">
          <button
            type="button"
            className={`settings-tab ${tab === "library" ? "active" : ""}`}
            onClick={() => setTab("library")}
          >
            Library ({apps.length})
          </button>
          <button
            type="button"
            className={`settings-tab ${tab === "folders" ? "active" : ""}`}
            onClick={() => setTab("folders")}
          >
            Scan folders ({activeFolders.length})
          </button>
          <button
            type="button"
            className={`settings-tab ${tab === "skipped" ? "active" : ""}`}
            onClick={() => setTab("skipped")}
          >
            Skipped ({rejectedApps.length})
          </button>
          <button
            type="button"
            className={`settings-tab ${tab === "appearance" ? "active" : ""}`}
            onClick={() => setTab("appearance")}
          >
            Appearance
          </button>
        </div>

        {tab === "library" && (
          <div className="settings-list">
            {apps.length === 0 && (
              <p className="setup-subtitle">No apps in library yet.</p>
            )}
            {apps.map((app) => (
              <div key={app.id} className="settings-item">
                {app.icon && <img className="settings-item-icon" src={app.icon} alt={app.name} draggable={false} />}
                <span className="settings-item-info">
                  <span className="folder-label">{app.name}</span>
                  <span className="folder-path">{app.path}</span>
                </span>
                <button
                  type="button"
                  className="folder-remove"
                  onClick={() => void removeApp(app.path)}
                  title="Remove from library"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === "folders" && (
          <>
            <div className="settings-list">
              {activeFolders.length === 0 && (
                <p className="setup-subtitle">No scan folders configured.</p>
              )}
              {activeFolders.map((folder) => {
                const suggestion = suggestions.find((s) => s.path === folder);
                return (
                  <div key={folder} className="settings-item">
                    <span className="settings-item-info">
                      <span className="folder-label">
                        {suggestion?.label ?? folder.split("\\").pop()}
                      </span>
                      <span className="folder-path">{folder}</span>
                    </span>
                    <button
                      type="button"
                      className="folder-remove"
                      onClick={() => void removeFolder(folder)}
                      title="Remove folder"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            {suggestedNotAdded.length > 0 && (
              <div className="setup-section">
                <h2>Add suggested folders</h2>
                <div className="folder-list">
                  {suggestedNotAdded.map((s) => (
                    <button
                      key={s.path}
                      type="button"
                      className="folder-option"
                      onClick={() => void toggleFolder(s.path)}
                    >
                      <span className="folder-check">+</span>
                      <span className="folder-info">
                        <span className="folder-label">{s.label}</span>
                        <span className="folder-path">{s.path}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="setup-actions">
              <button
                type="button"
                className="action-button"
                onClick={() => void addCustomFolder()}
              >
                Add custom folder
              </button>
            </div>
          </>
        )}

        {tab === "skipped" && (
          <div className="settings-list">
            {rejectedApps.length === 0 && (
              <p className="setup-subtitle">No skipped apps.</p>
            )}
            {rejectedApps.map((app) => (
              <div key={app.id} className="settings-item">
                {app.icon && <img className="settings-item-icon" src={app.icon} alt={app.name} draggable={false} />}
                <span className="settings-item-info">
                  <span className="folder-label">{app.name}</span>
                  <span className="folder-path">{app.path}</span>
                </span>
                <button
                  type="button"
                  className="action-button primary"
                  style={{ padding: "0 0.75rem", minHeight: "2.4rem", borderRadius: "999px", fontSize: "0.85rem" }}
                  onClick={() => void restoreApp(app.path)}
                  title="Add to library"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === "appearance" && (
          <div className="settings-list">
            <div className="settings-item">
              <span className="settings-item-info">
                <span className="folder-label">Icon size</span>
                <span className="folder-path">{iconSize}px</span>
              </span>
              <input
                type="range"
                className="size-slider"
                min={60}
                max={200}
                step={5}
                value={iconSize}
                onChange={(e) => onIconSizeChange(Number(e.target.value))}
              />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
