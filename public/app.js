/* ═══════════════════════════════════════════════════════
   BRACKETS GAME - Frontend Application
   ═══════════════════════════════════════════════════════ */

const socket = io();

// ─── State ───────────────────────────────────────────────
let state = {
  playerId: null,
  playerName: '',
  roomCode: null,
  room: null,
  isHost: false,
  isSpectator: false,
  currentMatch: null,
  myVote: null,
  proposalsSubmitted: false
};

// ─── DOM Refs ────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = document.querySelectorAll('.screen');

function showScreen(id) {
  screens.forEach(s => s.classList.remove('active'));
  const screen = $(id);
  if (screen) screen.classList.add('active');
  updateRoomCodeBadge();
}

function updateRoomCodeBadge() {
  const badge = $('room-code-badge');
  if (state.roomCode) {
    $('room-code-badge-value').textContent = state.roomCode;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function toast(msg, type = 'info') {
  const container = $('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => { t.remove(); }, 3500);
}

// ─── HOME SCREEN ─────────────────────────────────────────
$('btn-create').addEventListener('click', () => {
  const name = $('player-name').value.trim();
  if (!name) return toast('Inserisci il tuo nome', 'error');
  state.playerName = name;

  socket.emit('create-room', { playerName: name }, (res) => {
    if (res.success) {
      state.playerId = res.playerId;
      state.roomCode = res.roomCode;
      state.room = res.room;
      state.isHost = true;
      enterLobby();
    } else {
      toast(res.error || 'Errore', 'error');
    }
  });
});

$('btn-join').addEventListener('click', () => {
  const name = $('player-name').value.trim();
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!name) return toast('Inserisci il tuo nome', 'error');
  if (!code) return toast('Inserisci il codice stanza', 'error');
  state.playerName = name;

  socket.emit('join-room', { roomCode: code, playerName: name }, (res) => {
    if (res.success) {
      state.playerId = res.playerId;
      state.roomCode = res.roomCode;
      state.room = res.room;
      state.isHost = (res.room.hostId === res.playerId);
      enterLobby();
    } else {
      toast(res.error || 'Errore', 'error');
    }
  });
});

$('btn-spectate-home').addEventListener('click', () => {
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!code) return toast('Inserisci il codice stanza', 'error');

  state.isSpectator = true;
  socket.emit('spectate-room', { roomCode: code }, (res) => {
    if (res.success) {
      state.roomCode = code;
      state.room = res.room;
      navigateToCorrectScreen();
    } else {
      toast(res.error || 'Errore', 'error');
    }
  });
});

// Enter on inputs
$('player-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btn-create').click();
});
$('room-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btn-join').click();
});

// ─── LOAD SCREEN ─────────────────────────────────────────
$('btn-load').addEventListener('click', () => {
  showScreen('screen-load');
  loadSavedGames();
});

$('btn-back-load').addEventListener('click', () => {
  showScreen('screen-home');
});

async function loadSavedGames() {
  try {
    const res = await fetch('/api/saved-games');
    const games = await res.json();
    const list = $('saved-games-list');

    if (games.length === 0) {
      list.innerHTML = '<p class="muted">Nessuna partita salvata</p>';
      return;
    }

    list.innerHTML = games.map(g => `
      <div class="saved-game-item" data-code="${g.roomCode}">
        <div class="saved-game-info">
          <h4>${g.topic || 'Senza argomento'}</h4>
          <p>${g.players.join(', ')} &middot; Bracket da ${g.bracketSize}</p>
        </div>
        <div class="saved-game-meta">
          <div>${g.roomCode}</div>
          <div>${g.phase}</div>
          <div>${new Date(g.savedAt).toLocaleDateString('it-IT')}</div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.saved-game-item').forEach(item => {
      item.addEventListener('click', () => {
        const code = item.dataset.code;
        const name = $('player-name').value.trim() || `Giocatore`;
        state.playerName = name;

        socket.emit('rejoin-room', { roomCode: code, playerName: name }, (res) => {
          if (res.success) {
            state.playerId = res.playerId;
            state.roomCode = res.roomCode;
            state.room = res.room;
            state.isHost = (res.room.hostId === res.playerId);
            navigateToCorrectScreen();
            toast('Partita caricata!', 'success');
          } else {
            toast(res.error || 'Errore nel caricamento', 'error');
          }
        });
      });
    });
  } catch {
    $('saved-games-list').innerHTML = '<p class="muted">Errore nel caricamento</p>';
  }
}

// ─── LOBBY ───────────────────────────────────────────────
function enterLobby() {
  showScreen('screen-lobby');
  $('lobby-room-code').textContent = state.roomCode;
  updateLobbyUI();
  generateQRCode();
}

async function generateQRCode() {
  const container = $('qr-container');
  if (!container || !state.roomCode) return;
  container.innerHTML = '';

  let joinUrl;
  try {
    const res = await fetch('/api/server-info');
    const info = await res.json();
    if (info.addresses && info.addresses.length > 0) {
      joinUrl = `http://${info.addresses[0]}:${info.port}?join=${state.roomCode}`;
    } else {
      joinUrl = `${window.location.origin}?join=${state.roomCode}`;
    }
  } catch {
    joinUrl = `${window.location.origin}?join=${state.roomCode}`;
  }

  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: joinUrl,
      width: 160,
      height: 160,
      colorDark: '#0a0e17',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

function updateLobbyUI() {
  const room = state.room;
  if (!room) return;

  // Players
  const list = $('players-list');
  list.innerHTML = room.players.map(p => `
    <div class="player-item">
      <span class="player-dot ${p.connected ? '' : 'offline'}"></span>
      <span>${p.name}</span>
      ${p.id === room.hostId ? '<span class="player-host-badge">Host</span>' : ''}
    </div>
  `).join('');
  $('player-count').textContent = room.players.length;

  // Settings (host only)
  if (state.isHost) {
    $('lobby-settings').style.display = '';
    $('lobby-footer-host').style.display = '';
    $('lobby-footer-player').style.display = 'none';
    $('topic-input').value = room.topic || '';

    document.querySelectorAll('.size-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.size) === room.bracketSize);
    });

    // Enable start if conditions met
    const canStart = room.players.length >= 2 && room.topic?.trim();
    $('btn-start-proposals').disabled = !canStart;
    $('lobby-hint').textContent = canStart
      ? `Pronto! ${room.bracketSize} candidati divisi tra ${room.players.length} giocatori`
      : 'Servono almeno 2 giocatori e un argomento';
  } else {
    $('lobby-settings').style.display = 'none';
    $('lobby-footer-host').style.display = 'none';
    $('lobby-footer-player').style.display = '';
  }
}

$('btn-copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    toast('Codice copiato!', 'success');
  });
});

$('topic-input').addEventListener('input', (e) => {
  socket.emit('update-settings', { topic: e.target.value });
});

document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const size = parseInt(btn.dataset.size);
    socket.emit('update-settings', { bracketSize: size });
  });
});

$('btn-start-proposals').addEventListener('click', () => {
  socket.emit('start-proposals', null, (res) => {
    if (!res.success) toast(res.error || 'Errore', 'error');
  });
});

// ─── PROPOSALS ───────────────────────────────────────────
function enterProposals() {
  showScreen('screen-proposals');
  state.proposalsSubmitted = false;
  const room = state.room;

  $('proposals-topic').textContent = room.topic;

  const perPlayer = room.proposalsPerPlayer;
  $('proposals-hint').textContent = `Proponi ${perPlayer} candidati per "${room.topic}"`;

  const container = $('proposal-inputs');
  container.innerHTML = '';

  for (let i = 0; i < perPlayer; i++) {
    const row = document.createElement('div');
    row.className = 'proposal-input-row';
    row.innerHTML = `
      <span class="proposal-number">${i + 1}</span>
      <input type="text" class="proposal-field" placeholder="Candidato ${i + 1}" maxlength="60" autocomplete="off">
    `;
    container.appendChild(row);
  }

  $('btn-submit-proposals').style.display = '';
  $('proposals-waiting').style.display = 'none';
  $('proposal-progress-bar').style.width = '0%';
  $('proposal-progress-text').textContent = '0/? hanno inviato';
}

$('btn-submit-proposals').addEventListener('click', () => {
  const inputs = document.querySelectorAll('.proposal-field');
  const candidates = [];

  inputs.forEach(input => {
    const val = input.value.trim();
    if (val) candidates.push(val);
  });

  if (candidates.length === 0) return toast('Inserisci almeno un candidato', 'error');

  // Check for self-duplicates
  const lowerSet = new Set();
  for (const c of candidates) {
    if (lowerSet.has(c.toLowerCase())) {
      return toast(`"${c}" appare due volte!`, 'error');
    }
    lowerSet.add(c.toLowerCase());
  }

  socket.emit('submit-proposals', { candidates }, (res) => {
    if (res.success) {
      state.proposalsSubmitted = true;
      $('btn-submit-proposals').style.display = 'none';
      $('proposals-waiting').style.display = '';
      toast('Proposte inviate!', 'success');
    }
  });
});

// ─── REVIEW ──────────────────────────────────────────────
function enterReview() {
  showScreen('screen-review');
  renderReviewCandidates();

  if (!state.isHost) {
    $('review-footer-host').style.display = 'none';
  } else {
    $('review-footer-host').style.display = '';
  }
}

function renderReviewCandidates() {
  const room = state.room;
  if (!room) return;

  const grid = $('review-candidates');
  grid.innerHTML = room.candidates.map(c => `
    <div class="candidate-chip">
      <div class="name">${escapeHtml(c.name)}</div>
      <div class="proposer">${escapeHtml(c.proposedBy)}</div>
    </div>
  `).join('');
}

$('btn-start-game').addEventListener('click', () => {
  socket.emit('start-game', null, (res) => {
    if (!res.success) toast('Errore nell\'avvio', 'error');
  });
});

// ─── MATCH VIEW ──────────────────────────────────────────
function enterMatch(matchData, roundName) {
  showScreen('screen-match');
  state.currentMatch = matchData;
  state.myVote = null;

  // Header
  $('match-round-name').textContent = roundName;
  const room = state.room;
  if (room && room.bracket) {
    const totalInRound = room.bracket.rounds[room.bracket.currentRound].length;
    $('match-number').textContent = `Sfida ${room.bracket.currentMatch + 1}/${totalInRound}`;
  }

  // Candidates
  $('candidate-left-name').textContent = matchData.candidate1.name;
  $('candidate-left-proposer').textContent = `proposto da ${matchData.candidate1.proposedBy}`;
  $('candidate-right-name').textContent = matchData.candidate2.name;
  $('candidate-right-proposer').textContent = `proposto da ${matchData.candidate2.proposedBy}`;

  // Reset state
  $('candidate-left').className = 'match-candidate left';
  $('candidate-right').className = 'match-candidate right';
  $('candidate-left-votes').style.display = 'none';
  $('candidate-right-votes').style.display = 'none';
  $('match-votes-detail').style.display = 'none';
  $('match-votes-detail').innerHTML = '';
  $('winner-announcement').style.display = 'none';
  $('tiebreaker-panel').style.display = 'none';

  // Vote buttons
  if (state.isSpectator) {
    $('btn-vote-left').style.display = 'none';
    $('btn-vote-right').style.display = 'none';
  } else {
    $('btn-vote-left').style.display = '';
    $('btn-vote-right').style.display = '';
    $('btn-vote-left').className = 'btn btn-vote';
    $('btn-vote-right').className = 'btn btn-vote';
  }

  $('vote-status-text').textContent = 'Vota il tuo preferito!';

  // Host controls
  if (state.isHost) {
    $('match-controls').style.display = '';
    $('btn-reveal-votes').style.display = '';
    $('btn-confirm-match').style.display = 'none';
    $('btn-next-match').style.display = 'none';
  } else {
    $('match-controls').style.display = 'none';
  }

  // Render mini bracket
  if (room && room.bracket) {
    renderBracket($('mini-bracket'), room.bracket, matchData.id);
  }
}

// Vote buttons
$('btn-vote-left').addEventListener('click', () => {
  if (!state.currentMatch) return;
  castVote(state.currentMatch.candidate1.name);
});

$('btn-vote-right').addEventListener('click', () => {
  if (!state.currentMatch) return;
  castVote(state.currentMatch.candidate2.name);
});

function castVote(candidateName) {
  if (!state.currentMatch) return;

  state.myVote = candidateName;
  socket.emit('cast-vote', {
    matchId: state.currentMatch.id,
    candidateName
  });

  // Update buttons
  const isLeft = candidateName === state.currentMatch.candidate1.name;
  $('btn-vote-left').className = `btn btn-vote ${isLeft ? 'voted' : 'not-voted'}`;
  $('btn-vote-right').className = `btn btn-vote ${!isLeft ? 'voted' : 'not-voted'}`;
  $('vote-status-text').textContent = `Hai votato: ${candidateName}`;
}

// Host controls
$('btn-reveal-votes').addEventListener('click', () => {
  if (!state.currentMatch) return;
  socket.emit('reveal-votes', { matchId: state.currentMatch.id }, (res) => {
    if (!res.success) toast('Errore', 'error');
  });
});

$('btn-confirm-match').addEventListener('click', () => {
  if (!state.currentMatch) return;
  socket.emit('confirm-match', { matchId: state.currentMatch.id }, (res) => {
    if (res.tied) {
      // Tiebreaker UI handled by event
    } else if (!res.success) {
      toast('Errore', 'error');
    }
  });
});

$('btn-next-match').addEventListener('click', () => {
  socket.emit('next-match', null, (res) => {
    if (!res.success) toast('Errore', 'error');
  });
});

// Tiebreaker
$('btn-tiebreak-left').addEventListener('click', () => {
  if (!state.currentMatch) return;
  socket.emit('tiebreaker-vote', {
    matchId: state.currentMatch.id,
    candidateName: state.currentMatch.candidate1.name
  });
});

$('btn-tiebreak-right').addEventListener('click', () => {
  if (!state.currentMatch) return;
  socket.emit('tiebreaker-vote', {
    matchId: state.currentMatch.id,
    candidateName: state.currentMatch.candidate2.name
  });
});

// Mini bracket toggle
$('mini-bracket-toggle').addEventListener('click', () => {
  const panel = $('mini-bracket-panel');
  const toggle = $('mini-bracket-toggle');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open');
  toggle.classList.toggle('open');
  toggle.querySelector('span').innerHTML = isOpen ? '&#9654; Tabellone' : '&#9664; Chiudi';
});

// ─── ROUND SUMMARY ───────────────────────────────────────
$('btn-continue-round').addEventListener('click', () => {
  socket.emit('continue-from-summary', null, (res) => {
    if (!res.success) toast('Errore', 'error');
  });
});

// ─── FINISHED SCREEN ─────────────────────────────────────
$('btn-new-game').addEventListener('click', () => {
  state = {
    playerId: null,
    playerName: '',
    roomCode: null,
    room: null,
    isHost: false,
    isSpectator: false,
    currentMatch: null,
    myVote: null,
    proposalsSubmitted: false
  };
  $('room-code-badge').style.display = 'none';
  showScreen('screen-home');
});

$('btn-save-final').addEventListener('click', () => {
  socket.emit('save-game', null, (res) => {
    if (res.success) toast('Partita salvata!', 'success');
  });
});

// ─── SOCKET EVENTS ───────────────────────────────────────

socket.on('room-updated', (room) => {
  state.room = room;

  if (room.phase === 'lobby') {
    updateLobbyUI();
  } else if (room.phase === 'proposals' && !state.proposalsSubmitted) {
    enterProposals();
  } else if (room.phase === 'review') {
    enterReview();
  }
});

socket.on('proposal-progress', ({ submitted, total }) => {
  const pct = Math.round((submitted / total) * 100);
  $('proposal-progress-bar').style.width = pct + '%';
  $('proposal-progress-text').textContent = `${submitted}/${total} hanno inviato`;
});

socket.on('duplicates-found', ({ duplicates, needsReplacement }) => {
  enterReview();
  $('duplicates-section').style.display = '';

  const dupList = $('duplicates-list');
  // Only show items that belong to current player or show to host
  const myItems = needsReplacement.filter(d => d.proposedById === state.playerId);
  const items = state.isHost ? needsReplacement : myItems;

  if (items.length === 0) {
    dupList.innerHTML = '<p class="muted">In attesa che gli altri giocatori risolvano i duplicati...</p>';
    return;
  }

  dupList.innerHTML = items.map(d => `
    <div class="duplicate-item" data-old="${escapeAttr(d.originalName)}">
      <span>"${escapeHtml(d.originalName)}" (di ${escapeHtml(d.proposedBy)})</span>
      <input type="text" placeholder="Nuovo candidato" maxlength="60">
      <button class="btn btn-secondary btn-replace">Sostituisci</button>
    </div>
  `).join('');

  dupList.querySelectorAll('.btn-replace').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.duplicate-item');
      const oldName = item.dataset.old;
      const newName = item.querySelector('input').value.trim();
      if (!newName) return toast('Inserisci un nuovo candidato', 'error');

      socket.emit('replace-candidate', { oldName, newName }, (res) => {
        if (res.success) {
          item.remove();
          toast('Candidato sostituito', 'success');
        } else {
          toast(res.error || 'Errore', 'error');
        }
      });
    });
  });
});

socket.on('replacement-update', ({ remaining }) => {
  if (remaining === 0) {
    $('duplicates-section').style.display = 'none';
    toast('Tutti i duplicati risolti!', 'success');
  }
});

socket.on('match-started', ({ match, roundName }) => {
  if (state.room) {
    state.room.phase = 'playing';
    if (state.room.bracket) {
      state.room.bracket.currentRound = match.round;
      // Find match position in round
      const roundMatches = state.room.bracket.rounds[match.round];
      if (roundMatches) {
        const idx = roundMatches.findIndex(m => m.id === match.id);
        if (idx >= 0) state.room.bracket.currentMatch = idx;
      }
    }
  }
  enterMatch(match, roundName);
});

socket.on('vote-count-updated', ({ matchId, votedCount, totalPlayers }) => {
  if (state.currentMatch?.id !== matchId) return;
  $('vote-status-text').textContent = state.myVote
    ? `Hai votato: ${state.myVote} (${votedCount}/${totalPlayers} hanno votato)`
    : `${votedCount}/${totalPlayers} hanno votato`;
});

socket.on('votes-revealed', ({ matchId, votes }) => {
  if (state.currentMatch?.id !== matchId) return;
  state.currentMatch.state = 'revealed';
  showVotes(votes);

  // Show host controls
  if (state.isHost) {
    $('btn-reveal-votes').style.display = 'none';
    $('btn-confirm-match').style.display = '';
  }

  $('vote-status-text').textContent = 'Voti rivelati! Puoi cambiare il tuo voto dopo la discussione.';
});

socket.on('votes-updated', ({ matchId, votes }) => {
  if (state.currentMatch?.id !== matchId) return;
  showVotes(votes);
});

socket.on('match-tied', ({ matchId, match }) => {
  if (state.currentMatch?.id !== matchId) return;

  if (state.isHost) {
    $('tiebreaker-panel').style.display = '';
    $('btn-tiebreak-left').textContent = match.candidate1.name;
    $('btn-tiebreak-right').textContent = match.candidate2.name;
    $('btn-confirm-match').style.display = 'none';
  }
  $('vote-status-text').textContent = 'Pareggio! Serve un tiebreaker esterno.';
});

socket.on('match-completed', ({ matchId, winner, bracket, tiebroken }) => {
  if (state.room) state.room.bracket = bracket;

  if (state.currentMatch?.id === matchId) {
    state.currentMatch.winner = winner;
    state.currentMatch.state = 'completed';

    // Show winner
    const isLeft = winner.name === state.currentMatch.candidate1.name;
    $('candidate-left').classList.add(isLeft ? 'winner' : 'loser');
    $('candidate-right').classList.add(!isLeft ? 'winner' : 'loser');

    $('winner-announcement').style.display = '';
    $('winner-name').textContent = winner.name;

    $('tiebreaker-panel').style.display = 'none';

    if (state.isHost) {
      $('btn-confirm-match').style.display = 'none';
      $('btn-next-match').style.display = '';
    }

    if (tiebroken) {
      $('vote-status-text').textContent = 'Pareggio risolto dal tiebreaker esterno!';
    } else {
      $('vote-status-text').textContent = `${winner.name} passa il turno!`;
    }

    // Update mini bracket
    renderBracket($('mini-bracket'), bracket, matchId);
  }
});

socket.on('round-complete', ({ round, roundName, bracket, nextRoundName }) => {
  if (state.room) state.room.phase = 'round_summary';
  showScreen('screen-round-summary');
  $('round-summary-title').textContent = `${roundName} completato!`;
  if (state.room) state.room.bracket = bracket;

  renderBracket($('full-bracket'), bracket);

  if (state.isHost) {
    $('round-summary-footer-host').style.display = '';
    $('btn-continue-round').textContent = `Prossimo: ${nextRoundName} \u2192`;
  } else {
    $('round-summary-footer-host').style.display = 'none';
  }
});

socket.on('tournament-finished', ({ room, stats }) => {
  state.room = room;
  showScreen('screen-finished');

  if (stats.champion) {
    $('champion-name').textContent = stats.champion.name;
    $('champion-proposer').textContent = `proposto da ${stats.champion.proposedBy}`;
  }

  renderBracket($('final-bracket'), room.bracket);
  renderStats(stats);
  launchConfetti();
});

// ─── Reconnect ───────────────────────────────────────────
socket.on('connect', () => {
  if (state.roomCode && state.playerId) {
    socket.emit('rejoin-room', {
      roomCode: state.roomCode,
      playerId: state.playerId,
      playerName: state.playerName
    }, (res) => {
      if (res.success) {
        state.room = res.room;
        navigateToCorrectScreen();
        toast('Riconnesso!', 'success');
      }
    });
  }
});

// ─── Navigation ──────────────────────────────────────────
function navigateToCorrectScreen() {
  const room = state.room;
  if (!room) return showScreen('screen-home');

  state.isHost = room.hostId === state.playerId;

  switch (room.phase) {
    case 'lobby':
      enterLobby();
      break;
    case 'proposals':
      enterProposals();
      break;
    case 'review':
      enterReview();
      break;
    case 'playing': {
      showScreen('screen-match');
      // Find current active match
      const br = room.bracket;
      if (br) {
        const match = br.rounds[br.currentRound]?.[br.currentMatch];
        if (match) {
          const roundName = getRoundNameClient(br.totalRounds, br.currentRound);
          enterMatch(match, roundName);
        }
      }
      break;
    }
    case 'round_summary':
      showScreen('screen-round-summary');
      if (room.bracket) {
        renderBracket($('full-bracket'), room.bracket);
      }
      break;
    case 'finished':
      showScreen('screen-finished');
      if (room.stats) {
        if (room.stats.champion) {
          $('champion-name').textContent = room.stats.champion.name;
          $('champion-proposer').textContent = `proposto da ${room.stats.champion.proposedBy}`;
        }
        renderStats(room.stats);
      }
      if (room.bracket) {
        renderBracket($('final-bracket'), room.bracket);
      }
      break;
    default:
      showScreen('screen-home');
  }
}

// ─── VOTE DISPLAY ────────────────────────────────────────
function showVotes(votes) {
  const match = state.currentMatch;
  if (!match) return;

  // Show vote counts
  const c1count = votes.tally[match.candidate1.name] || 0;
  const c2count = votes.tally[match.candidate2.name] || 0;

  $('candidate-left-votes').textContent = c1count;
  $('candidate-left-votes').style.display = '';
  $('candidate-right-votes').textContent = c2count;
  $('candidate-right-votes').style.display = '';

  // Show individual votes
  const detail = $('match-votes-detail');
  detail.style.display = '';
  detail.innerHTML = votes.individual.map(v => {
    const side = v.votedFor === match.candidate1.name ? 'left' : 'right';
    return `<span class="vote-chip ${side}">${escapeHtml(v.playerName)} \u2192 ${escapeHtml(v.votedFor)}</span>`;
  }).join('');
}

// ─── BRACKET RENDERER ────────────────────────────────────
function renderBracket(container, bracket, highlightMatchId) {
  container.innerHTML = '';
  if (!bracket || !bracket.rounds) return;

  const totalRounds = bracket.rounds.length;

  bracket.rounds.forEach((round, rIdx) => {
    const roundDiv = document.createElement('div');
    roundDiv.className = 'bracket-round';

    const title = document.createElement('div');
    title.className = 'bracket-round-title';
    title.textContent = getRoundNameClient(bracket.totalRounds, rIdx);
    roundDiv.appendChild(title);

    const matchesContainer = document.createElement('div');
    matchesContainer.style.cssText = 'display:flex;flex-direction:column;justify-content:space-around;flex:1;position:relative;';

    round.forEach((match, mIdx) => {
      const matchDiv = document.createElement('div');
      matchDiv.className = 'bracket-match';
      matchDiv.dataset.matchIdx = mIdx;

      const isCurrent = match.id === highlightMatchId;

      const team1 = document.createElement('div');
      team1.className = 'bracket-team';
      if (match.candidate1) {
        team1.textContent = match.candidate1.name;
        if (match.winner) {
          team1.classList.add(match.winner.name === match.candidate1.name ? 'winner' : 'loser');
        }
        if (isCurrent) team1.classList.add('current');
      } else {
        team1.textContent = 'TBD';
        team1.classList.add('empty');
      }

      const team2 = document.createElement('div');
      team2.className = 'bracket-team';
      if (match.candidate2) {
        team2.textContent = match.candidate2.name;
        if (match.winner) {
          team2.classList.add(match.winner.name === match.candidate2.name ? 'winner' : 'loser');
        }
        if (isCurrent) team2.classList.add('current');
      } else {
        team2.textContent = 'TBD';
        team2.classList.add('empty');
      }

      matchDiv.appendChild(team1);
      matchDiv.appendChild(team2);
      matchesContainer.appendChild(matchDiv);
    });

    roundDiv.appendChild(matchesContainer);
    container.appendChild(roundDiv);

    // After rendering, add vertical connectors between pairs of matches
    if (rIdx < totalRounds - 1) {
      requestAnimationFrame(() => {
        const matchEls = matchesContainer.querySelectorAll('.bracket-match');
        for (let i = 0; i < matchEls.length; i += 2) {
          if (i + 1 >= matchEls.length) break;
          const top = matchEls[i];
          const bot = matchEls[i + 1];
          const containerRect = matchesContainer.getBoundingClientRect();
          const topRect = top.getBoundingClientRect();
          const botRect = bot.getBoundingClientRect();

          const vLine = document.createElement('div');
          vLine.className = 'bracket-connector-v';
          const yStart = topRect.top + topRect.height / 2 - containerRect.top;
          const yEnd = botRect.top + botRect.height / 2 - containerRect.top;
          vLine.style.top = yStart + 'px';
          vLine.style.height = (yEnd - yStart) + 'px';
          matchesContainer.appendChild(vLine);
        }
      });
    }
  });
}

// ─── STATS RENDERER ──────────────────────────────────────
function renderStats(stats) {
  const grid = $('stats-grid');
  const cards = [];

  if (stats.mostVotedCandidate) {
    cards.push({
      icon: '\u2B50',
      label: 'Pi\u00f9 votato in assoluto',
      value: stats.mostVotedCandidate,
      detail: `${stats.mostVotedCandidateVotes} voti totali`
    });
  }

  if (stats.closestMatch) {
    cards.push({
      icon: '\u26A1',
      label: 'Sfida pi\u00f9 combattuta',
      value: `${stats.closestMatch.candidate1} vs ${stats.closestMatch.candidate2}`,
      detail: stats.closestMatch.score
    });
  }

  if (stats.dominantMatch) {
    cards.push({
      icon: '\uD83D\uDCA5',
      label: 'Vittoria pi\u00f9 schiacciante',
      value: `${stats.dominantMatch.candidate1} vs ${stats.dominantMatch.candidate2}`,
      detail: stats.dominantMatch.score
    });
  }

  if (stats.bestProposer) {
    cards.push({
      icon: '\uD83C\uDFC6',
      label: 'Miglior talent scout',
      value: stats.bestProposer,
      detail: `I suoi candidati hanno vinto ${stats.bestProposerWins} sfide`
    });
  }

  cards.push({
    icon: '\uD83D\uDDF3\uFE0F',
    label: 'Voti totali espressi',
    value: stats.totalVotesCast,
    detail: ''
  });

  if (stats.runnerUp) {
    cards.push({
      icon: '\uD83E\uDD48',
      label: 'Secondo classificato',
      value: stats.runnerUp.name,
      detail: `proposto da ${stats.runnerUp.proposedBy}`
    });
  }

  grid.innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-icon">${c.icon}</div>
      <div class="stat-label">${c.label}</div>
      <div class="stat-value">${escapeHtml(String(c.value))}</div>
      ${c.detail ? `<div class="stat-detail">${escapeHtml(c.detail)}</div>` : ''}
    </div>
  `).join('');
}

// ─── CONFETTI ────────────────────────────────────────────
function launchConfetti() {
  const container = $('confetti-container');
  container.innerHTML = '';
  const colors = ['#6366f1', '#f472b6', '#22c55e', '#fbbf24', '#818cf8', '#f97316'];

  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = Math.random() * 2 + 's';
    piece.style.animationDuration = (2 + Math.random() * 2) + 's';
    container.appendChild(piece);
  }
}

// ─── UTILS ───────────────────────────────────────────────
function getRoundNameClient(totalRounds, currentRound) {
  const remaining = totalRounds - currentRound - 1;
  if (remaining === 0) return 'Finale';
  if (remaining === 1) return 'Semifinali';
  if (remaining === 2) return 'Quarti';
  if (remaining === 3) return 'Ottavi';
  if (remaining === 4) return 'Sedicesimi';
  if (remaining === 5) return 'Trentaduesimi';
  return `Round ${currentRound + 1}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Init ────────────────────────────────────────────────
showScreen('screen-home');

// Handle ?join=CODICE from QR code
(function handleJoinParam() {
  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get('join');
  if (joinCode) {
    $('room-code-input').value = joinCode.toUpperCase();
    // Clean URL without reload
    window.history.replaceState({}, '', window.location.pathname);
    // Focus on name input
    $('player-name').focus();
    toast('Inserisci il tuo nome e clicca "Entra"', 'info');
  }
})();
