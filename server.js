const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Game State Store ────────────────────────────────────────────
const rooms = new Map();

// ─── Constants ───────────────────────────────────────────────────
const PHASES = {
  LOBBY: 'lobby',
  PROPOSALS: 'proposals',
  REVIEW: 'review',
  PLAYING: 'playing',
  ROUND_SUMMARY: 'round_summary',
  FINISHED: 'finished'
};

const MATCH_STATES = {
  PENDING: 'pending',
  VOTING: 'voting',
  REVEALED: 'revealed',
  TIEBREAKER: 'tiebreaker',
  COMPLETED: 'completed'
};

// ─── Helpers ─────────────────────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getRoundName(totalRounds, currentRound) {
  const remaining = totalRounds - currentRound - 1;
  if (remaining === 0) return 'Finale';
  if (remaining === 1) return 'Semifinali';
  if (remaining === 2) return 'Quarti di finale';
  if (remaining === 3) return 'Ottavi di finale';
  if (remaining === 4) return 'Sedicesimi di finale';
  if (remaining === 5) return 'Trentaduesimi di finale';
  return `Round ${currentRound + 1}`;
}

function buildBracket(candidates) {
  const size = candidates.length;
  const totalRounds = Math.log2(size);
  const shuffled = shuffle(candidates);
  const rounds = [];

  // First round
  const firstRoundMatches = [];
  for (let i = 0; i < size; i += 2) {
    firstRoundMatches.push({
      id: `r0-m${i / 2}`,
      round: 0,
      position: i / 2,
      candidate1: shuffled[i],
      candidate2: shuffled[i + 1],
      votes: {},
      state: MATCH_STATES.PENDING,
      winner: null,
      voteHistory: []
    });
  }
  rounds.push(firstRoundMatches);

  // Subsequent rounds (empty, filled as game progresses)
  for (let r = 1; r < totalRounds; r++) {
    const matchCount = size / Math.pow(2, r + 1);
    const roundMatches = [];
    for (let m = 0; m < matchCount; m++) {
      roundMatches.push({
        id: `r${r}-m${m}`,
        round: r,
        position: m,
        candidate1: null,
        candidate2: null,
        votes: {},
        state: MATCH_STATES.PENDING,
        winner: null,
        voteHistory: []
      });
    }
    rounds.push(roundMatches);
  }

  return {
    rounds,
    totalRounds,
    currentRound: 0,
    currentMatch: 0
  };
}

function advanceWinner(room, match) {
  const { bracket } = room;
  const nextRound = match.round + 1;
  if (nextRound >= bracket.totalRounds) return;

  const nextMatchIdx = Math.floor(match.position / 2);
  const nextMatch = bracket.rounds[nextRound][nextMatchIdx];
  const isTop = match.position % 2 === 0;

  if (isTop) {
    nextMatch.candidate1 = match.winner;
  } else {
    nextMatch.candidate2 = match.winner;
  }
}

function calculateStats(room) {
  const stats = {
    totalVotesCast: 0,
    candidateVotes: {},    // candidateName -> total votes received
    closestMatch: null,    // match with smallest vote diff
    closestMatchDiff: Infinity,
    dominantMatch: null,   // most one-sided match
    dominantMatchDiff: 0,
    playerProposalWins: {},// playerName -> wins by their candidates
    champion: null,
    runnerUp: null,
    candidateWins: {},     // candidateName -> number of matches won
    roundResults: []
  };

  const allMatches = bracket => bracket.rounds.flat().filter(m => m.state === MATCH_STATES.COMPLETED);

  const completedMatches = allMatches(room.bracket);

  completedMatches.forEach(match => {
    const votes = Object.values(match.votes);
    const c1votes = votes.filter(v => v === match.candidate1.name).length;
    const c2votes = votes.filter(v => v === match.candidate2.name).length;
    const totalVotes = c1votes + c2votes;
    const diff = Math.abs(c1votes - c2votes);

    stats.totalVotesCast += totalVotes;

    // Track candidate total votes
    stats.candidateVotes[match.candidate1.name] = (stats.candidateVotes[match.candidate1.name] || 0) + c1votes;
    stats.candidateVotes[match.candidate2.name] = (stats.candidateVotes[match.candidate2.name] || 0) + c2votes;

    // Track wins
    if (match.winner) {
      stats.candidateWins[match.winner.name] = (stats.candidateWins[match.winner.name] || 0) + 1;
      const proposer = match.winner.proposedBy;
      stats.playerProposalWins[proposer] = (stats.playerProposalWins[proposer] || 0) + 1;
    }

    // Closest match
    if (diff < stats.closestMatchDiff && totalVotes > 0) {
      stats.closestMatchDiff = diff;
      stats.closestMatch = {
        candidate1: match.candidate1.name,
        candidate2: match.candidate2.name,
        score: `${c1votes} - ${c2votes}`,
        round: match.round
      };
    }

    // Most dominant match
    if (diff > stats.dominantMatchDiff) {
      stats.dominantMatchDiff = diff;
      stats.dominantMatch = {
        candidate1: match.candidate1.name,
        candidate2: match.candidate2.name,
        score: `${c1votes} - ${c2votes}`,
        round: match.round
      };
    }
  });

  // Final match info
  const finalRound = room.bracket.rounds[room.bracket.totalRounds - 1];
  if (finalRound && finalRound[0] && finalRound[0].winner) {
    const finalMatch = finalRound[0];
    stats.champion = finalMatch.winner;
    stats.runnerUp = finalMatch.winner.name === finalMatch.candidate1.name
      ? finalMatch.candidate2
      : finalMatch.candidate1;
  }

  // Most voted candidate
  let maxVotes = 0;
  let mostVoted = null;
  Object.entries(stats.candidateVotes).forEach(([name, votes]) => {
    if (votes > maxVotes) {
      maxVotes = votes;
      mostVoted = name;
    }
  });
  stats.mostVotedCandidate = mostVoted;
  stats.mostVotedCandidateVotes = maxVotes;

  // Best proposer
  let maxWins = 0;
  let bestProposer = null;
  Object.entries(stats.playerProposalWins).forEach(([name, wins]) => {
    if (wins > maxWins) {
      maxWins = wins;
      bestProposer = name;
    }
  });
  stats.bestProposer = bestProposer;
  stats.bestProposerWins = maxWins;

  return stats;
}

function sanitizeRoom(room) {
  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })),
    topic: room.topic,
    bracketSize: room.bracketSize,
    phase: room.phase,
    candidates: room.candidates,
    bracket: room.bracket,
    proposalsPerPlayer: room.proposalsPerPlayer,
    pendingReplacements: room.pendingReplacements || [],
    stats: room.stats
  };
}

// ─── Save / Load ─────────────────────────────────────────────────
function saveGame(room) {
  const data = sanitizeRoom(room);
  data.savedAt = new Date().toISOString();
  const filePath = path.join(DATA_DIR, `${room.roomCode}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function loadGame(roomCode) {
  const filePath = path.join(DATA_DIR, `${roomCode}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function listSavedGames() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
        return {
          roomCode: data.roomCode,
          topic: data.topic,
          bracketSize: data.bracketSize,
          phase: data.phase,
          players: data.players.map(p => p.name),
          savedAt: data.savedAt
        };
      } catch { return null; }
    })
    .filter(Boolean);
}

// ─── REST endpoints ──────────────────────────────────────────────
app.get('/api/server-info', (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  res.json({ port: PORT, addresses });
});

app.get('/api/saved-games', (req, res) => {
  res.json(listSavedGames());
});

// ─── Socket.io ───────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // ─── Create Room ─────────────────────────────────────────
  socket.on('create-room', ({ playerName }, callback) => {
    let roomCode;
    do { roomCode = generateRoomCode(); } while (rooms.has(roomCode));

    const playerId = uuidv4();
    const room = {
      roomCode,
      hostId: playerId,
      players: [{
        id: playerId,
        name: playerName,
        socketId: socket.id,
        connected: true
      }],
      topic: '',
      bracketSize: 16,
      phase: PHASES.LOBBY,
      candidates: [],
      bracket: null,
      proposalsPerPlayer: 0,
      proposalSubmissions: {},
      stats: null
    };

    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerId = playerId;

    callback({ success: true, roomCode, playerId, room: sanitizeRoom(room) });
    console.log(`Room ${roomCode} created by ${playerName}`);
  });

  // ─── Join Room ───────────────────────────────────────────
  socket.on('join-room', ({ roomCode, playerName }, callback) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);

    if (!room) return callback({ success: false, error: 'Stanza non trovata' });
    if (room.phase !== PHASES.LOBBY) return callback({ success: false, error: 'Partita già iniziata' });

    const existing = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (existing) return callback({ success: false, error: 'Nome già in uso' });

    const playerId = uuidv4();
    room.players.push({
      id: playerId,
      name: playerName,
      socketId: socket.id,
      connected: true
    });

    socket.join(code);
    socket.roomCode = code;
    socket.playerId = playerId;

    callback({ success: true, roomCode: code, playerId, room: sanitizeRoom(room) });
    io.to(code).emit('room-updated', sanitizeRoom(room));
    console.log(`${playerName} joined room ${code}`);
  });

  // ─── Rejoin Room (reconnect / load) ──────────────────────
  socket.on('rejoin-room', ({ roomCode, playerId, playerName }, callback) => {
    const code = roomCode.toUpperCase();
    let room = rooms.get(code);

    // If room not in memory, try loading from disk
    if (!room) {
      const saved = loadGame(code);
      if (!saved) return callback({ success: false, error: 'Stanza non trovata' });

      room = {
        ...saved,
        proposalSubmissions: {},
        players: saved.players.map(p => ({ ...p, socketId: null, connected: false }))
      };
      rooms.set(code, room);
    }

    // Find player
    let player = room.players.find(p => p.id === playerId);
    if (!player && playerName) {
      player = room.players.find(p => p.name === playerName);
    }

    if (!player) {
      // New player joining a loaded game
      const newPlayerId = uuidv4();
      player = {
        id: newPlayerId,
        name: playerName || `Giocatore ${room.players.length + 1}`,
        socketId: socket.id,
        connected: true
      };
      room.players.push(player);
    } else {
      player.socketId = socket.id;
      player.connected = true;
    }

    socket.join(code);
    socket.roomCode = code;
    socket.playerId = player.id;

    callback({ success: true, roomCode: code, playerId: player.id, room: sanitizeRoom(room) });
    io.to(code).emit('room-updated', sanitizeRoom(room));
  });

  // ─── Join as Spectator (display screen) ──────────────────
  socket.on('spectate-room', ({ roomCode }, callback) => {
    const code = roomCode.toUpperCase();
    let room = rooms.get(code);

    if (!room) {
      const saved = loadGame(code);
      if (!saved) return callback({ success: false, error: 'Stanza non trovata' });
      room = { ...saved, proposalSubmissions: {}, players: saved.players.map(p => ({ ...p, socketId: null, connected: false })) };
      rooms.set(code, room);
    }

    socket.join(code);
    socket.roomCode = code;
    socket.isSpectator = true;

    callback({ success: true, room: sanitizeRoom(room) });
  });

  // ─── Update Settings (host only) ────────────────────────
  socket.on('update-settings', ({ topic, bracketSize }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.playerId) return;
    if (room.phase !== PHASES.LOBBY) return;

    if (topic !== undefined) room.topic = topic;
    if (bracketSize !== undefined && [16, 32, 64].includes(bracketSize)) {
      room.bracketSize = bracketSize;
    }

    io.to(socket.roomCode).emit('room-updated', sanitizeRoom(room));
  });

  // ─── Start Proposals ─────────────────────────────────────
  socket.on('start-proposals', (_, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.playerId) return callback?.({ success: false });
    if (!room.topic.trim()) return callback?.({ success: false, error: 'Scegli un argomento' });
    if (room.players.length < 2) return callback?.({ success: false, error: 'Servono almeno 2 giocatori' });

    const perPlayer = Math.ceil(room.bracketSize / room.players.length);
    room.proposalsPerPlayer = perPlayer;
    room.phase = PHASES.PROPOSALS;
    room.proposalSubmissions = {};

    io.to(socket.roomCode).emit('room-updated', sanitizeRoom(room));
    callback?.({ success: true });
  });

  // ─── Submit Proposals ────────────────────────────────────
  socket.on('submit-proposals', ({ candidates: candidateNames }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== PHASES.PROPOSALS) return callback?.({ success: false });

    const player = room.players.find(p => p.id === socket.playerId);
    if (!player) return callback?.({ success: false });

    // Store this player's submissions
    const submissions = candidateNames.map(name => ({
      name: name.trim(),
      proposedBy: player.name,
      proposedById: player.id
    }));

    room.proposalSubmissions[player.id] = submissions;

    // Check how many players have submitted
    const submitted = Object.keys(room.proposalSubmissions).length;
    const total = room.players.filter(p => p.connected).length;

    io.to(socket.roomCode).emit('proposal-progress', { submitted, total });

    // If all submitted, go to review
    if (submitted >= total) {
      // Merge all proposals
      let allCandidates = [];
      Object.values(room.proposalSubmissions).forEach(subs => {
        allCandidates = allCandidates.concat(subs);
      });

      // Detect duplicates
      const nameCount = {};
      allCandidates.forEach(c => {
        const key = c.name.toLowerCase();
        nameCount[key] = (nameCount[key] || 0) + 1;
      });

      const duplicates = Object.keys(nameCount).filter(k => nameCount[k] > 1);

      if (duplicates.length > 0) {
        // Keep first occurrence, mark others for replacement
        const seen = new Set();
        const cleaned = [];
        const needsReplacement = [];

        allCandidates.forEach(c => {
          const key = c.name.toLowerCase();
          if (seen.has(key)) {
            needsReplacement.push(c);
          } else {
            seen.add(key);
            cleaned.push(c);
          }
        });

        room.candidates = cleaned;
        room.pendingReplacements = needsReplacement;
        room.phase = PHASES.REVIEW;

        io.to(socket.roomCode).emit('room-updated', sanitizeRoom(room));
        io.to(socket.roomCode).emit('duplicates-found', {
          duplicates: duplicates,
          needsReplacement: needsReplacement.map(c => ({
            originalName: c.name,
            proposedBy: c.proposedBy,
            proposedById: c.proposedById
          }))
        });
      } else {
        // Trim to bracket size
        room.candidates = allCandidates.slice(0, room.bracketSize);
        room.phase = PHASES.REVIEW;
        io.to(socket.roomCode).emit('room-updated', sanitizeRoom(room));
      }
    }

    callback?.({ success: true });
  });

  // ─── Replace Duplicate ───────────────────────────────────
  socket.on('replace-candidate', ({ oldName, newName }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== PHASES.REVIEW) return callback?.({ success: false });

    // Check new name doesn't also exist
    const exists = room.candidates.some(c => c.name.toLowerCase() === newName.trim().toLowerCase());
    if (exists) return callback?.({ success: false, error: 'Questo candidato esiste già' });

    const player = room.players.find(p => p.id === socket.playerId);

    // Remove from pending
    if (room.pendingReplacements) {
      room.pendingReplacements = room.pendingReplacements.filter(
        c => !(c.name.toLowerCase() === oldName.toLowerCase() && c.proposedById === socket.playerId)
      );
    }

    // Add new candidate
    room.candidates.push({
      name: newName.trim(),
      proposedBy: player ? player.name : 'Unknown',
      proposedById: socket.playerId
    });

    io.to(socket.roomCode).emit('room-updated', sanitizeRoom(room));
    io.to(socket.roomCode).emit('replacement-update', {
      remaining: room.pendingReplacements ? room.pendingReplacements.length : 0
    });

    callback?.({ success: true });
  });

  // ─── Start Game (build bracket) ──────────────────────────
  socket.on('start-game', (_, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.playerId) return callback?.({ success: false });

    // Ensure we have enough candidates
    while (room.candidates.length < room.bracketSize) {
      room.candidates.push({
        name: `Slot ${room.candidates.length + 1}`,
        proposedBy: 'Sistema',
        proposedById: 'system'
      });
    }
    room.candidates = room.candidates.slice(0, room.bracketSize);

    room.bracket = buildBracket(room.candidates);
    room.phase = PHASES.PLAYING;

    // Set first match to voting
    room.bracket.rounds[0][0].state = MATCH_STATES.VOTING;

    io.to(socket.roomCode).emit('room-updated', sanitizeRoom(room));
    io.to(socket.roomCode).emit('match-started', {
      match: room.bracket.rounds[0][0],
      roundName: getRoundName(room.bracket.totalRounds, 0)
    });

    saveGame(room);
    callback?.({ success: true });
  });

  // ─── Cast Vote ───────────────────────────────────────────
  socket.on('cast-vote', ({ matchId, candidateName }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== PHASES.PLAYING) return callback?.({ success: false });

    const match = room.bracket.rounds.flat().find(m => m.id === matchId);
    if (!match || (match.state !== MATCH_STATES.VOTING && match.state !== MATCH_STATES.REVEALED)) {
      return callback?.({ success: false });
    }

    const player = room.players.find(p => p.id === socket.playerId);
    if (!player) return callback?.({ success: false });

    match.votes[player.id] = candidateName;

    // Tell everyone how many have voted (but not who voted what)
    const votedCount = Object.keys(match.votes).length;
    const totalPlayers = room.players.filter(p => p.connected).length;

    if (match.state === MATCH_STATES.REVEALED) {
      // During discussion phase, votes are visible in real-time
      io.to(socket.roomCode).emit('votes-updated', {
        matchId,
        votes: buildVoteDisplay(match, room),
        votedCount,
        totalPlayers
      });
    } else {
      io.to(socket.roomCode).emit('vote-count-updated', {
        matchId,
        votedCount,
        totalPlayers
      });
    }

    callback?.({ success: true });
  });

  // ─── Reveal Votes ────────────────────────────────────────
  socket.on('reveal-votes', ({ matchId }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.playerId) return callback?.({ success: false });

    const match = room.bracket.rounds.flat().find(m => m.id === matchId);
    if (!match || match.state !== MATCH_STATES.VOTING) return callback?.({ success: false });

    match.state = MATCH_STATES.REVEALED;

    const voteDisplay = buildVoteDisplay(match, room);

    io.to(socket.roomCode).emit('votes-revealed', {
      matchId,
      votes: voteDisplay
    });

    callback?.({ success: true });
  });

  // ─── Confirm Match Result ────────────────────────────────
  socket.on('confirm-match', ({ matchId }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.playerId) return callback?.({ success: false });

    const match = room.bracket.rounds.flat().find(m => m.id === matchId);
    if (!match || match.state !== MATCH_STATES.REVEALED) return callback?.({ success: false });

    // Count votes
    const votes = Object.values(match.votes);
    const c1votes = votes.filter(v => v === match.candidate1.name).length;
    const c2votes = votes.filter(v => v === match.candidate2.name).length;

    if (c1votes === c2votes) {
      // Tie! Need tiebreaker
      match.state = MATCH_STATES.TIEBREAKER;
      io.to(socket.roomCode).emit('match-tied', { matchId, match });
      return callback?.({ success: true, tied: true });
    }

    // Determine winner
    match.winner = c1votes > c2votes ? match.candidate1 : match.candidate2;
    match.state = MATCH_STATES.COMPLETED;
    match.voteHistory.push({ ...match.votes });

    advanceWinner(room, match);
    saveGame(room);

    io.to(socket.roomCode).emit('match-completed', {
      matchId,
      winner: match.winner,
      bracket: room.bracket
    });

    callback?.({ success: true });
  });

  // ─── Tiebreaker Vote ─────────────────────────────────────
  socket.on('tiebreaker-vote', ({ matchId, candidateName }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.playerId) return callback?.({ success: false });

    const match = room.bracket.rounds.flat().find(m => m.id === matchId);
    if (!match || match.state !== MATCH_STATES.TIEBREAKER) return callback?.({ success: false });

    match.winner = candidateName === match.candidate1.name ? match.candidate1 : match.candidate2;
    match.state = MATCH_STATES.COMPLETED;
    match.tiebrokenBy = 'external';

    advanceWinner(room, match);
    saveGame(room);

    io.to(socket.roomCode).emit('match-completed', {
      matchId,
      winner: match.winner,
      bracket: room.bracket,
      tiebroken: true
    });

    callback?.({ success: true });
  });

  // ─── Next Match ──────────────────────────────────────────
  socket.on('next-match', (_, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.playerId) return callback?.({ success: false });

    const { bracket } = room;
    const currentRound = bracket.rounds[bracket.currentRound];
    const currentMatchIdx = bracket.currentMatch;

    // Verify current match is completed before advancing
    const currentMatch = currentRound[currentMatchIdx];
    if (currentMatch && currentMatch.state !== MATCH_STATES.COMPLETED) {
      return callback?.({ success: false, error: 'Il match corrente non è ancora completato' });
    }

    // Find next match in current round
    let nextMatchIdx = currentMatchIdx + 1;

    if (nextMatchIdx >= currentRound.length) {
      // Round complete, show round summary
      bracket.currentMatch = 0;
      const nextRound = bracket.currentRound + 1;

      if (nextRound >= bracket.totalRounds) {
        // Tournament over!
        room.phase = PHASES.FINISHED;
        room.stats = calculateStats(room);
        saveGame(room);
        io.to(socket.roomCode).emit('tournament-finished', {
          room: sanitizeRoom(room),
          stats: room.stats
        });
        return callback?.({ success: true });
      }

      // Show round summary
      room.phase = PHASES.ROUND_SUMMARY;
      io.to(socket.roomCode).emit('round-complete', {
        round: bracket.currentRound,
        roundName: getRoundName(bracket.totalRounds, bracket.currentRound),
        bracket: bracket,
        nextRoundName: getRoundName(bracket.totalRounds, nextRound)
      });

      bracket.currentRound = nextRound;
      saveGame(room);
      return callback?.({ success: true });
    }

    // Start next match
    bracket.currentMatch = nextMatchIdx;
    const nextMatch = currentRound[nextMatchIdx];
    nextMatch.state = MATCH_STATES.VOTING;

    room.phase = PHASES.PLAYING;

    io.to(socket.roomCode).emit('match-started', {
      match: nextMatch,
      roundName: getRoundName(bracket.totalRounds, bracket.currentRound)
    });

    saveGame(room);
    callback?.({ success: true });
  });

  // ─── Continue from Round Summary ─────────────────────────
  socket.on('continue-from-summary', (_, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.playerId) return callback?.({ success: false });

    const { bracket } = room;
    room.phase = PHASES.PLAYING;

    const nextMatch = bracket.rounds[bracket.currentRound][0];
    nextMatch.state = MATCH_STATES.VOTING;

    io.to(socket.roomCode).emit('match-started', {
      match: nextMatch,
      roundName: getRoundName(bracket.totalRounds, bracket.currentRound)
    });

    saveGame(room);
    callback?.({ success: true });
  });

  // ─── Save Game ───────────────────────────────────────────
  socket.on('save-game', (_, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return callback?.({ success: false });
    saveGame(room);
    callback?.({ success: true, roomCode: room.roomCode });
  });

  // ─── Disconnect ──────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    if (socket.roomCode) {
      const room = rooms.get(socket.roomCode);
      if (room) {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          player.connected = false;
          player.socketId = null;
          io.to(socket.roomCode).emit('room-updated', sanitizeRoom(room));
        }

        // Auto-save on disconnect
        saveGame(room);
      }
    }
  });
});

// ─── Helper: Build vote display ──────────────────────────────────
function buildVoteDisplay(match, room) {
  const display = [];
  room.players.forEach(p => {
    if (match.votes[p.id]) {
      display.push({
        playerName: p.name,
        votedFor: match.votes[p.id]
      });
    }
  });

  const c1votes = Object.values(match.votes).filter(v => v === match.candidate1.name).length;
  const c2votes = Object.values(match.votes).filter(v => v === match.candidate2.name).length;

  return {
    individual: display,
    tally: {
      [match.candidate1.name]: c1votes,
      [match.candidate2.name]: c2votes
    }
  };
}

// ─── Start Server ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏆 Brackets Game server running on http://localhost:${PORT}`);
});
