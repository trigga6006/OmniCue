# OmniCue

AI-powered desktop overlay companion for Windows. A translucent, always-on-top assistant that sits on your screen — timers, notifications, and an AI companion you can talk to from anywhere.

## Install

**One-liner (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/trigga6006/OmniCue/main/install.ps1 | iex
```

Or download the latest `.exe` installer from [Releases](https://github.com/trigga6006/OmniCue/releases).

> **Note:** Windows SmartScreen may show an "Unknown publisher" warning since the app isn't code-signed yet. Click **More info** → **Run anyway** to proceed. The app is safe — you can inspect the source right here.

## Features

- **Desktop Overlay** — translucent, click-through pill that stays on top of everything
- **AI Companion** — chat with an AI assistant via hotkey from any context
- **Timers** — create and manage countdown timers from the overlay or CLI
- **Notifications** — desktop toast notifications with customizable duration
- **CLI** — control OmniCue from your terminal or scripts

## CLI Usage

After installing, OmniCue runs a local server on port `19191`. Use the CLI to interact with it:

```bash
omnicue notify "Build complete"
omnicue notify "Tests passed" --title "CI" --timeout 15
omnicue timer 5m "Code review"
omnicue timer 90s
omnicue health
```

## Development

```bash
npm install
npm run dev
```

### Build

```bash
npm run build:win
```

## Tech Stack

Electron · React 19 · TypeScript · Tailwind CSS · Zustand · Motion · Vite

## License

MIT
