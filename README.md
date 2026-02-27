# 🏆 Brackets - Il Gioco del Tabellone

A real-time multiplayer tournament bracket game where players propose candidates on any topic and vote head-to-head until a champion is crowned.

## How It Works

1. **Create a room** — one player hosts, others join via room code or QR code
2. **Choose a topic** — e.g. "Best Disney Movie", "Best Pizza Topping"
3. **Propose candidates** — each player secretly submits their picks
4. **Vote head-to-head** — secret voting with simultaneous reveal, discussion phase, and optional vote changes
5. **Crown a champion** — tournament bracket narrows down to a final winner with stats

## Features

- **Real-time multiplayer** via WebSocket (Socket.io)
- **QR code join** — scan from the host's screen to join instantly on mobile
- **Secret voting** with simultaneous reveal
- **Vote changing** after reveal (pitch/discussion phase)
- **Tiebreaker system** via external person
- **Live tournament bracket** with connector lines
- **Round summaries** with full bracket view between rounds
- **Final statistics** — most voted, closest match, best proposer, and more
- **Save/resume** games
- **Spectator mode** for shared display screens
- **Responsive design** — works on desktop and mobile
- **Dark theme** UI

## Quick Start

```bash
# Clone the repo
git clone https://github.com/Ricc-cpu/brackets.git
cd brackets

# Install dependencies
npm install

# Start the server
node server.js
```

Open **http://localhost:3000** in your browser.

To play with others on the same Wi-Fi network, they can access `http://<your-local-ip>:3000` or scan the QR code shown in the lobby.

## Tech Stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla JS, CSS (no frameworks)
- **Persistence:** JSON file storage

## Screenshots

### Home
Create or join a game room.

### Lobby
Share the room code or QR code with other players. Configure topic and bracket size (16/32/64).

### Match
Vote head-to-head with secret ballots and simultaneous reveal.

### Bracket
Full tournament bracket with connector lines, winner highlights, and round labels.

### Champion
Final statistics screen with confetti celebration.

---

Built with ❤️ and [Claude Code](https://claude.ai/claude-code)
