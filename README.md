# Wintouch

Wintouch is a touch-first Windows launcher built with Electron and Next.js.

## Current scope

- Scan Windows Start Menu and Desktop shortcuts.
- Show a large-tile launcher surface optimized for landscape tablets.
- Pin frequently used apps locally.
- Launch shortcuts, URLs, and executables through Electron.

## Run locally

```powershell
npm install
npm run dev
```

The Next.js renderer runs on port 3020 and Electron opens the desktop shell.

## Build a Windows installer

```powershell
npm run electron:build
```

## Notes

- The current app discovery pass reads Start Menu and Desktop locations only.
- Pin state is stored in browser local storage inside the desktop shell.
- The UI is designed for touch targets first, not mouse-dense desktop layouts.

## Direction

Wintouch is intended to become a touch-native launcher for Windows, including gesture-driven navigation such as swipe-back and a two-finger home gesture.
