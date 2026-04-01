"use client";

import { useEffect, useMemo, useState } from "react";
import type { LaunchResult, LaunchableApp } from "@/lib/types";

const PIN_STORAGE_KEY = "wintouch.pinned-apps";

declare global {
  interface Window {
    wintouch?: {
      listApps: () => Promise<LaunchableApp[]>;
      launchApp: (targetPath: string) => Promise<LaunchResult>;
      getPlatform: () => Promise<string>;
    };
  }
}

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

export function LauncherShell() {
  const [apps, setApps] = useState<LaunchableApp[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>("unknown");
  const [isLoading, setIsLoading] = useState(true);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
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
      const [items, currentPlatform] = await Promise.all([
        window.wintouch.listApps(),
        window.wintouch.getPlatform(),
      ]);

      setApps(items);
      setPlatform(currentPlatform);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load installed apps.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadApps();
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
  const suggestedApps = filteredApps.filter((app) => !pinnedIds.includes(app.id)).slice(0, 18);

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

      return [appId, ...current].slice(0, 12);
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

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Touch-first Windows launcher</p>
          <h1>Wintouch</h1>
          <p className="hero-copy">
            Large targets, fast search, and a cleaner home screen for landscape tablets.
          </p>
        </div>
        <div className="hero-meta">
          <div className="clock">{formattedTime}</div>
          <div className="date">{formattedDate}</div>
          <div className="platform">Platform: {platform}</div>
        </div>
      </section>

      <section className="toolbar">
        <label className="search-field">
          <span>Search apps</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type an app, game, or shortcut"
            inputMode="search"
          />
        </label>
        <button className="action-button" type="button" onClick={() => void loadApps()}>
          Refresh library
        </button>
      </section>

      {error ? <p className="status error">{error}</p> : null}
      {isLoading ? <p className="status">Scanning Windows shortcuts and desktop apps...</p> : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Pinned</h2>
          <span>{pinnedApps.length} ready</span>
        </div>
        <div className="grid featured-grid">
          {pinnedApps.length > 0 ? (
            pinnedApps.map((app) => (
              <button
                key={app.id}
                className="app-tile featured"
                type="button"
                onClick={() => void handleLaunch(app)}
                disabled={launchingId === app.id}
              >
                <span className="app-mark">{initialsFor(app.name)}</span>
                <span className="app-name">{app.name}</span>
                <span className="app-path">{app.type.toUpperCase()}</span>
                <span className="app-action" onClick={(event) => {
                  event.stopPropagation();
                  togglePin(app.id);
                }}>
                  Unpin
                </span>
              </button>
            ))
          ) : (
            <article className="empty-card">
              <h3>No pinned apps yet</h3>
              <p>Pin the apps you open most so they stay on the first screen.</p>
            </article>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Library</h2>
          <span>{filteredApps.length} results</span>
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
                <span className="app-mark">{initialsFor(app.name)}</span>
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