"use client";

import { useEffect, useMemo, useState } from "react";
import type { LaunchResult, LaunchableApp, ScanConfig, SuggestedFolder } from "@/lib/types";
import { SetupScreen } from "./SetupScreen";
import { ApprovalScreen } from "./ApprovalScreen";
import { SettingsScreen } from "./SettingsScreen";

const PIN_STORAGE_KEY = "wintouch.pinned-apps";
const ICON_SIZE_KEY = "wintouch.icon-size";
const DEFAULT_ICON_SIZE = 100;

declare global {
  interface Window {
    wintouch?: {
      listApps: () => Promise<LaunchableApp[]>;
      launchApp: (targetPath: string) => Promise<LaunchResult>;
      getScanConfig: () => Promise<ScanConfig | null>;
      saveScanConfig: (config: ScanConfig) => Promise<void>;
      getSuggestedFolders: () => Promise<SuggestedFolder[]>;
      pickFolder: () => Promise<string | null>;
      listPendingApps: () => Promise<LaunchableApp[]>;
      listRejectedApps: () => Promise<LaunchableApp[]>;
      approveApps: (paths: string[]) => Promise<void>;
      rejectApps: (paths: string[]) => Promise<void>;
      removeApp: (appPath: string) => Promise<void>;
      unrejectApp: (appPath: string) => Promise<void>;
    };
  }
}

type Screen = "loading" | "setup" | "approval" | "launcher" | "settings";

function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? "")
    .join("");
}

function AppIcon({ app }: { app: LaunchableApp }) {
  if (app.icon) {
    return <img className="app-icon" src={app.icon} alt={app.name} draggable={false} />;
  }
  return <span className="app-mark">{initialsFor(app.name)}</span>;
}

export function LauncherShell() {
  const [apps, setApps] = useState<LaunchableApp[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [iconSize, setIconSize] = useState(DEFAULT_ICON_SIZE);
  const [screen, setScreen] = useState<Screen>("loading");
  const [pendingApps, setPendingApps] = useState<LaunchableApp[]>([]);
  const now = useClock();

  useEffect(() => {
    const stored = window.localStorage.getItem(PIN_STORAGE_KEY);
    if (stored) {
      try {
        setPinnedIds(JSON.parse(stored));
      } catch {
        window.localStorage.removeItem(PIN_STORAGE_KEY);
      }
    }
    const savedSize = window.localStorage.getItem(ICON_SIZE_KEY);
    if (savedSize) setIconSize(Number(savedSize) || DEFAULT_ICON_SIZE);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinnedIds));
  }, [pinnedIds]);

  async function loadApps() {
    if (!window.wintouch) {
      setError("Electron bridge is not available. Run this inside the desktop shell.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const items = await window.wintouch.listApps();
      setApps(items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load installed apps.");
    } finally {
      setIsLoading(false);
    }
  }

  async function checkPendingAndLoad() {
    if (!window.wintouch) return;
    const pending = await window.wintouch.listPendingApps();
    if (pending.length > 0) {
      setPendingApps(pending);
      setScreen("approval");
    } else {
      setScreen("launcher");
      void loadApps();
    }
  }

  useEffect(() => {
    if (!window.wintouch) {
      setScreen("launcher");
      return;
    }

    window.wintouch.getScanConfig().then((config) => {
      if (!config || !config.setupComplete) {
        setScreen("setup");
      } else {
        void checkPendingAndLoad();
      }
    });
  }, []);

  const filteredApps = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return apps;
    }

    return apps.filter((app) => {
      return app.name.toLowerCase().includes(normalizedQuery) || app.path.toLowerCase().includes(normalizedQuery);
    });
  }, [apps, query]);

  const pinnedApps = filteredApps.filter((app) => pinnedIds.includes(app.id));
  const suggestedApps = filteredApps.filter((app) => !pinnedIds.includes(app.id));

  async function handleLaunch(app: LaunchableApp) {
    if (!window.wintouch) {
      return;
    }

    setLaunchingId(app.id);
    setError(null);

    try {
      const result = await window.wintouch.launchApp(app.path);
      if (!result.ok) {
        setError(result.error ?? `Unable to launch ${app.name}.`);
      }
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : `Unable to launch ${app.name}.`);
    } finally {
      setLaunchingId(null);
    }
  }

  function togglePin(appId: string) {
    setPinnedIds((current) => {
      if (current.includes(appId)) {
        return current.filter((item) => item !== appId);
      }

      return [appId, ...current];
    });
  }

  const formattedTime = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const formattedDate = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  if (screen === "loading") {
    return <main className="shell"><p className="status">Loading...</p></main>;
  }

  if (screen === "setup") {
    return (
      <SetupScreen
        onComplete={() => {
          void checkPendingAndLoad();
        }}
      />
    );
  }

  if (screen === "approval") {
    return (
      <ApprovalScreen
        pending={pendingApps}
        onDone={() => {
          setScreen("launcher");
          void loadApps();
        }}
      />
    );
  }

  if (screen === "settings") {
    return (
      <SettingsScreen
        onClose={() => {
          void checkPendingAndLoad();
        }}
        iconSize={iconSize}
        onIconSizeChange={(size) => {
          setIconSize(size);
          window.localStorage.setItem(ICON_SIZE_KEY, String(size));
        }}
      />
    );
  }

  return (
    <main className="shell" style={{ "--tile-size": `${iconSize}px` } as React.CSSProperties}>
      <section className="toolbar">
        <label className="search-field">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps..."
            inputMode="search"
          />
        </label>
        <div className="toolbar-meta">
          <div className="clock">{formattedTime}</div>
          <div className="date">{formattedDate}</div>
        </div>
        <div className="toolbar-actions">
          <button className="action-button" type="button" onClick={() => void loadApps()}>
            ↻ Refresh
          </button>
          <button className="action-button" type="button" onClick={() => setScreen("settings")}>
            ⚙ Settings
          </button>
        </div>
      </section>

      {error ? <p className="status error">{error}</p> : null}
      {isLoading ? <p className="status">Scanning…</p> : null}

      {pinnedApps.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <h2>Pinned</h2>
            <span>{pinnedApps.length}</span>
          </div>
          <div className="grid featured-grid">
            {pinnedApps.map((app) => (
              <button
                key={app.id}
                className="app-tile featured"
                type="button"
                onClick={() => void handleLaunch(app)}
                disabled={launchingId === app.id}
              >
                <AppIcon app={app} />
                <span className="app-name">{app.name}</span>
                <span className="app-type">{app.type}</span>
                <span className="app-action" onClick={(event) => {
                  event.stopPropagation();
                  togglePin(app.id);
                }}>
                  Unpin
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <h2>Library</h2>
          <span>{suggestedApps.length}</span>
        </div>
        <div className="grid library-grid">
          {suggestedApps.map((app) => (
            <article key={app.id} className="app-tile">
              <button
                className="launch-button"
                type="button"
                onClick={() => void handleLaunch(app)}
                disabled={launchingId === app.id}
              >
                <AppIcon app={app} />
                <span className="app-name">{app.name}</span>
                <span className="app-path">{app.path}</span>
              </button>
              <button className="pin-button" type="button" onClick={() => togglePin(app.id)}>
                Pin
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}