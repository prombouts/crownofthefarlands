const TERRITORIES = [
  { id: "noordwest", naam: "Noordwest", buren: ["noord", "west"] },
  { id: "noord", naam: "Noord", buren: ["noordwest", "noordoost", "centrum"] },
  { id: "noordoost", naam: "Noordoost", buren: ["noord", "oost"] },
  { id: "west", naam: "West", buren: ["noordwest", "centrum", "zuidwest"] },
  { id: "centrum", naam: "Centrum", buren: ["noord", "west", "oost", "zuid"] },
  { id: "oost", naam: "Oost", buren: ["noordoost", "centrum", "zuidoost"] },
  { id: "zuidwest", naam: "Zuidwest", buren: ["west", "zuid", "verre-zuidwest"] },
  { id: "zuid", naam: "Zuid", buren: ["centrum", "zuidwest", "zuidoost", "eiland"] },
  { id: "zuidoost", naam: "Zuidoost", buren: ["oost", "zuid", "verre-zuidoost"] },
  { id: "verre-zuidwest", naam: "Verre Zuidwest", buren: ["zuidwest", "eiland"] },
  { id: "eiland", naam: "Eiland", buren: ["zuid", "verre-zuidwest", "verre-zuidoost"] },
  { id: "verre-zuidoost", naam: "Verre Zuidoost", buren: ["zuidoost", "eiland"] }
];

const PLAYER_COLORS = ["#e74c3c", "#f39c12", "#2ecc71", "#3498db", "#9b59b6", "#1abc9c"];

const HEARTBEAT_MS = 5000;
const PRESENCE_TIMEOUT_MS = 20000;
const STATE_SYNC_INTERVAL_MS = 8000;

const state = {
  localPlayer: null,
  roomCode: null,
  socket: null,
  connected: false,
  ackId: 1,
  players: {},
  game: null,
  isHost: false,
  hostId: null
};

const els = {
  playerName: document.getElementById("player-name"),
  roomCode: document.getElementById("room-code"),
  connectBtn: document.getElementById("connect-btn"),
  copyInviteBtn: document.getElementById("copy-invite-btn"),
  connectionStatus: document.getElementById("connection-status"),
  playersList: document.getElementById("players-list"),
  startGameBtn: document.getElementById("start-game-btn"),
  hostLabel: document.getElementById("host-label"),
  gameMeta: document.getElementById("game-meta"),
  phaseActions: document.getElementById("phase-actions"),
  attackControls: document.getElementById("attack-controls"),
  fortifyControls: document.getElementById("fortify-controls"),
  territoryList: document.getElementById("territory-list"),
  territoryTemplate: document.getElementById("territory-item-template"),
  logList: document.getElementById("log-list")
};

let heartbeatTimer = null;
let presenceTimer = null;
let stateSyncTimer = null;

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function nowTs() {
  return Date.now();
}

function resetGameUi() {
  els.gameMeta.textContent = "Nog geen spel gestart.";
  els.phaseActions.innerHTML = "";
  els.attackControls.innerHTML = "";
  els.fortifyControls.innerHTML = "";
}

function addLog(text) {
  const li = document.createElement("li");
  li.textContent = text;
  els.logList.prepend(li);
  while (els.logList.children.length > 80) {
    els.logList.removeChild(els.logList.lastChild);
  }
}

function playerLabel(playerId) {
  const p = state.players[playerId];
  return p ? p.name : playerId;
}

function sortPlayerEntries(playersObj) {
  return Object.values(playersObj).sort((a, b) => {
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    return a.id.localeCompare(b.id);
  });
}

function recomputeHost() {
  const entries = sortPlayerEntries(state.players);
  state.hostId = entries.length ? entries[0].id : null;
  state.isHost = state.localPlayer && state.hostId === state.localPlayer.id;
  els.hostLabel.textContent = state.hostId ? `Host: ${playerLabel(state.hostId)}` : "Host: onbekend";
  els.startGameBtn.disabled = !(state.isHost && !state.game && entries.length >= 2);
}

function renderPlayers() {
  const entries = sortPlayerEntries(state.players);
  els.playersList.innerHTML = "";
  for (const p of entries) {
    const div = document.createElement("div");
    div.className = "chip";
    const hostMark = p.id === state.hostId ? " 👑" : "";
    div.textContent = `${p.name}${hostMark}`;
    els.playersList.appendChild(div);
  }
}

function renderTerritories() {
  const game = state.game;
  els.territoryList.innerHTML = "";
  for (const t of TERRITORIES) {
    const node = els.territoryTemplate.content.firstElementChild.cloneNode(true);
    const owner = game?.territories?.[t.id]?.ownerId || "niemand";
    const armies = game?.territories?.[t.id]?.armies ?? 0;
    const ownerPlayer = state.players[owner];
    const ownerText = ownerPlayer ? ownerPlayer.name : owner;
    node.querySelector(".territory-name").textContent = t.naam;
    const ownerEl = node.querySelector(".territory-owner");
    ownerEl.textContent = ownerPlayer ? ownerText : "Onbekend";
    if (ownerPlayer?.color) {
      ownerEl.innerHTML = `<span class="color-dot" style="background:${ownerPlayer.color}"></span>${ownerText}`;
    }
    node.querySelector(".territory-armies").textContent = `Legers: ${armies}`;
    node.querySelector(".territory-neighbors").textContent = `Buren: ${t.buren.length}`;
    els.territoryList.appendChild(node);
  }
}

function getCurrentTurnPlayer() {
  if (!state.game) return null;
  return state.game.turnOrder[state.game.turnIndex] || null;
}

function isMyTurn() {
  return state.localPlayer && getCurrentTurnPlayer() === state.localPlayer.id;
}

function currentPlayerCanAct() {
  return state.game && isMyTurn() && state.game.phase;
}

function renderGameMeta() {
  if (!state.game) {
    resetGameUi();
    renderTerritories();
    return;
  }
  const turnPlayer = getCurrentTurnPlayer();
  const winnerText = state.game.winnerId ? `Winnaar: ${playerLabel(state.game.winnerId)}.` : "";
  els.gameMeta.textContent =
    `Beurt: ${playerLabel(turnPlayer)} • Fase: ${state.game.phase} • ` +
    `Versterkingen over: ${state.game.reinforcementsLeft} ${winnerText}`;
}

function territoryById(id) {
  return TERRITORIES.find((t) => t.id === id) || null;
}

function ownedTerritories(playerId) {
  if (!state.game) return [];
  return Object.entries(state.game.territories)
    .filter(([, value]) => value.ownerId === playerId)
    .map(([id]) => id);
}

function neighborsOf(territoryId) {
  return territoryById(territoryId)?.buren || [];
}

function renderActionPanels() {
  els.phaseActions.innerHTML = "";
  els.attackControls.innerHTML = "";
  els.fortifyControls.innerHTML = "";

  if (!state.game || state.game.winnerId) return;

  const canControl = currentPlayerCanAct();
  const phase = state.game.phase;

  if (phase === "versterken") {
    const help = document.createElement("span");
    help.className = "status";
    help.textContent = canControl
      ? "Kies een eigen gebied om 1 leger toe te voegen."
      : "Wachten op de actieve speler.";
    els.phaseActions.appendChild(help);

    if (canControl) {
      const select = document.createElement("select");
      select.id = "reinforce-territory";
      for (const tid of ownedTerritories(state.localPlayer.id)) {
        const option = document.createElement("option");
        option.value = tid;
        option.textContent = territoryById(tid).naam;
        select.appendChild(option);
      }
      const btn = document.createElement("button");
      btn.textContent = "Plaats versterking";
      btn.onclick = () => sendAction({ kind: "reinforce", territoryId: select.value });
      els.phaseActions.appendChild(select);
      els.phaseActions.appendChild(btn);
    }
  }

  if (phase === "aanvallen") {
    if (canControl) {
      renderAttackControls();
    }
    const endAttack = document.createElement("button");
    endAttack.textContent = "Aanvallen beëindigen";
    endAttack.disabled = !canControl;
    endAttack.onclick = () => sendAction({ kind: "end_attack_phase" });
    els.phaseActions.appendChild(endAttack);
  }

  if (phase === "verplaatsen") {
    if (canControl) {
      renderFortifyControls();
    }
    const endTurn = document.createElement("button");
    endTurn.textContent = "Beurt beëindigen";
    endTurn.disabled = !canControl;
    endTurn.onclick = () => sendAction({ kind: "end_turn" });
    els.phaseActions.appendChild(endTurn);
  }
}

function renderAttackControls() {
  const myId = state.localPlayer.id;
  const fromCandidates = ownedTerritories(myId).filter((tid) => {
    const territory = state.game.territories[tid];
    if (territory.armies < 2) return false;
    return neighborsOf(tid).some((nb) => state.game.territories[nb].ownerId !== myId);
  });

  if (!fromCandidates.length) {
    const msg = document.createElement("span");
    msg.className = "status";
    msg.textContent = "Geen geldige aanval beschikbaar.";
    els.attackControls.appendChild(msg);
    return;
  }

  const fromSelect = document.createElement("select");
  for (const id of fromCandidates) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = territoryById(id).naam;
    fromSelect.appendChild(o);
  }

  const toSelect = document.createElement("select");
  const diceSelect = document.createElement("select");
  [1, 2, 3].forEach((d) => {
    const o = document.createElement("option");
    o.value = String(d);
    o.textContent = `${d} dobbelsteen${d > 1 ? "en" : ""}`;
    diceSelect.appendChild(o);
  });

  function refreshToOptions() {
    const fromId = fromSelect.value;
    toSelect.innerHTML = "";
    const enemyNeighbors = neighborsOf(fromId).filter(
      (nb) => state.game.territories[nb].ownerId !== state.localPlayer.id
    );
    for (const id of enemyNeighbors) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = territoryById(id).naam;
      toSelect.appendChild(o);
    }
    const maxDice = Math.min(3, state.game.territories[fromId].armies - 1);
    Array.from(diceSelect.options).forEach((opt) => {
      opt.disabled = Number(opt.value) > maxDice;
    });
    if (Number(diceSelect.value) > maxDice) {
      diceSelect.value = String(maxDice);
    }
  }

  fromSelect.onchange = refreshToOptions;
  refreshToOptions();

  const btn = document.createElement("button");
  btn.textContent = "Aanval uitvoeren";
  btn.onclick = () =>
    sendAction({
      kind: "attack",
      fromId: fromSelect.value,
      toId: toSelect.value,
      attackDice: Number(diceSelect.value)
    });

  els.attackControls.appendChild(fromSelect);
  els.attackControls.appendChild(toSelect);
  els.attackControls.appendChild(diceSelect);
  els.attackControls.appendChild(btn);
}

function renderFortifyControls() {
  const myId = state.localPlayer.id;
  const fromCandidates = ownedTerritories(myId).filter((tid) => state.game.territories[tid].armies > 1);
  const toCandidates = ownedTerritories(myId);

  if (fromCandidates.length < 1 || toCandidates.length < 2) {
    const msg = document.createElement("span");
    msg.className = "status";
    msg.textContent = "Geen geldige verplaatsing beschikbaar.";
    els.fortifyControls.appendChild(msg);
    return;
  }

  const fromSelect = document.createElement("select");
  const toSelect = document.createElement("select");
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.value = "1";

  for (const id of fromCandidates) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = territoryById(id).naam;
    fromSelect.appendChild(o);
  }

  function refreshToCandidates() {
    const fromId = fromSelect.value;
    toSelect.innerHTML = "";
    const valid = neighborsOf(fromId).filter((id) => state.game.territories[id].ownerId === myId);
    for (const id of valid) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = territoryById(id).naam;
      toSelect.appendChild(o);
    }
    const maxMove = Math.max(1, state.game.territories[fromId].armies - 1);
    countInput.max = String(maxMove);
    if (Number(countInput.value) > maxMove) countInput.value = String(maxMove);
  }
  fromSelect.onchange = refreshToCandidates;
  refreshToCandidates();

  const btn = document.createElement("button");
  btn.textContent = "Verplaatsen";
  btn.onclick = () =>
    sendAction({
      kind: "fortify",
      fromId: fromSelect.value,
      toId: toSelect.value,
      armies: Number(countInput.value)
    });

  els.fortifyControls.appendChild(fromSelect);
  els.fortifyControls.appendChild(toSelect);
  els.fortifyControls.appendChild(countInput);
  els.fortifyControls.appendChild(btn);
}

function renderAll() {
  recomputeHost();
  renderPlayers();
  renderGameMeta();
  renderActionPanels();
  renderTerritories();
}

function broadcast(data) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.roomCode) return;
  state.socket.send(
    JSON.stringify({
      type: "sendToGroup",
      group: state.roomCode,
      dataType: "json",
      data,
      ackId: state.ackId++
    })
  );
}

function updatePresence(player) {
  const existing = state.players[player.id];
  state.players[player.id] = {
    id: player.id,
    name: player.name,
    color: player.color,
    joinedAt: existing?.joinedAt ?? player.joinedAt ?? nowTs(),
    lastSeenAt: nowTs()
  };
  renderAll();
}

function sendPresence() {
  if (!state.localPlayer) return;
  broadcast({ type: "presence", player: state.localPlayer });
}

function prunePresence() {
  const cutoff = nowTs() - PRESENCE_TIMEOUT_MS;
  let changed = false;
  for (const [id, p] of Object.entries(state.players)) {
    if (p.lastSeenAt < cutoff && id !== state.localPlayer?.id) {
      delete state.players[id];
      changed = true;
    }
  }
  if (changed) renderAll();
}

function requestState() {
  broadcast({
    type: "request_state",
    requesterId: state.localPlayer.id
  });
}

function sendStateSync(targetPlayerId = null) {
  if (!state.isHost || !state.game) return;
  broadcast({
    type: "state_sync",
    targetPlayerId,
    payload: state.game
  });
}

function rollDice(count) {
  return Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6)).sort((a, b) => b - a);
}

function cloneGame(game) {
  return JSON.parse(JSON.stringify(game));
}

function initialGameFromPlayers(playerIds) {
  const ids = [...playerIds];
  const territories = {};
  const shuffled = [...TERRITORIES].sort(() => Math.random() - 0.5);
  shuffled.forEach((territory, idx) => {
    const ownerId = ids[idx % ids.length];
    territories[territory.id] = { ownerId, armies: 1 };
  });

  for (const pid of ids) {
    const owned = Object.keys(territories).filter((tid) => territories[tid].ownerId === pid);
    let bonus = 3;
    let cursor = 0;
    while (bonus > 0 && owned.length) {
      const tid = owned[cursor % owned.length];
      territories[tid].armies += 1;
      bonus -= 1;
      cursor += 1;
    }
  }

  const first = ids[0];
  const game = {
    turnOrder: ids,
    turnIndex: 0,
    phase: "versterken",
    reinforcementsLeft: 0,
    territories,
    winnerId: null,
    log: [`Spel gestart. ${playerLabel(first)} begint.`],
    lastFortifyTurn: null
  };
  game.reinforcementsLeft = computeReinforcementsFor(first, game);
  return game;
}

function computeReinforcementsFor(playerId, game) {
  const owned = Object.values(game.territories).filter((t) => t.ownerId === playerId).length;
  return Math.max(3, Math.floor(owned / 3));
}

function checkWinner(game) {
  const owners = new Set(Object.values(game.territories).map((t) => t.ownerId));
  if (owners.size === 1) {
    return [...owners][0];
  }
  return null;
}

function appendGameLog(game, message) {
  game.log.push(message);
  if (game.log.length > 120) {
    game.log.splice(0, game.log.length - 120);
  }
}

function ensureHostActionEnvelope(message) {
  return state.isHost && message?.type === "action" && message?.actorId;
}

function applyHostAction(message) {
  if (!ensureHostActionEnvelope(message) || !state.game || state.game.winnerId) return;
  const action = message.action;
  const actorId = message.actorId;
  const game = cloneGame(state.game);
  const turnPlayer = game.turnOrder[game.turnIndex];
  if (actorId !== turnPlayer) return;

  let changed = false;

  if (action.kind === "reinforce" && game.phase === "versterken" && game.reinforcementsLeft > 0) {
    const territory = game.territories[action.territoryId];
    if (territory && territory.ownerId === actorId) {
      territory.armies += 1;
      game.reinforcementsLeft -= 1;
      appendGameLog(game, `${playerLabel(actorId)} versterkt ${territoryById(action.territoryId).naam}.`);
      changed = true;
      if (game.reinforcementsLeft <= 0) {
        game.phase = "aanvallen";
      }
    }
  }

  if (action.kind === "attack" && game.phase === "aanvallen") {
    const from = game.territories[action.fromId];
    const to = game.territories[action.toId];
    const isNeighbor = neighborsOf(action.fromId).includes(action.toId);
    if (!from || !to || !isNeighbor || from.ownerId !== actorId || to.ownerId === actorId) return;
    const maxAttackDice = Math.min(3, from.armies - 1);
    const attackDice = Math.min(Math.max(1, action.attackDice || 1), maxAttackDice);
    if (maxAttackDice <= 0) return;

    const defenseDice = Math.min(2, to.armies);
    const aRoll = rollDice(attackDice);
    const dRoll = rollDice(defenseDice);
    const pairs = Math.min(aRoll.length, dRoll.length);

    for (let i = 0; i < pairs; i += 1) {
      if (aRoll[i] > dRoll[i]) to.armies -= 1;
      else from.armies -= 1;
    }

    appendGameLog(
      game,
      `${playerLabel(actorId)} valt ${territoryById(action.toId).naam} aan (${aRoll.join(",")} vs ${dRoll.join(",")}).`
    );
    changed = true;

    if (to.armies <= 0) {
      const moveArmies = attackDice;
      to.ownerId = actorId;
      to.armies = moveArmies;
      from.armies -= moveArmies;
      appendGameLog(game, `${playerLabel(actorId)} verovert ${territoryById(action.toId).naam}.`);
      const winner = checkWinner(game);
      if (winner) {
        game.winnerId = winner;
        appendGameLog(game, `🏆 ${playerLabel(winner)} wint het spel!`);
      }
    }
  }

  if (action.kind === "end_attack_phase" && game.phase === "aanvallen") {
    game.phase = "verplaatsen";
    appendGameLog(game, `${playerLabel(actorId)} gaat naar verplaatsen.`);
    changed = true;
  }

  if (action.kind === "fortify" && game.phase === "verplaatsen") {
    const from = game.territories[action.fromId];
    const to = game.territories[action.toId];
    const isNeighbor = neighborsOf(action.fromId).includes(action.toId);
    const armies = Math.max(1, Number(action.armies || 1));
    if (from && to && isNeighbor && from.ownerId === actorId && to.ownerId === actorId && from.armies > armies) {
      from.armies -= armies;
      to.armies += armies;
      appendGameLog(
        game,
        `${playerLabel(actorId)} verplaatst ${armies} van ${territoryById(action.fromId).naam} naar ${territoryById(action.toId).naam}.`
      );
      changed = true;
    }
  }

  if (action.kind === "end_turn" && game.phase === "verplaatsen") {
    game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
    game.phase = "versterken";
    const nextPlayer = game.turnOrder[game.turnIndex];
    game.reinforcementsLeft = computeReinforcementsFor(nextPlayer, game);
    appendGameLog(game, `Nieuwe beurt: ${playerLabel(nextPlayer)}.`);
    changed = true;
  }

  if (changed) {
    state.game = game;
    renderAll();
    renderLog();
    sendStateSync();
  }
}

function sendAction(action) {
  if (!state.connected || !state.localPlayer || !state.game || state.game.winnerId) return;
  broadcast({
    type: "action",
    actorId: state.localPlayer.id,
    action
  });
}

function renderLog() {
  els.logList.innerHTML = "";
  if (!state.game?.log) return;
  for (let i = state.game.log.length - 1; i >= 0; i -= 1) {
    const li = document.createElement("li");
    li.textContent = state.game.log[i];
    els.logList.appendChild(li);
  }
}

function handleGroupMessage(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.type === "presence" && payload.player) {
    updatePresence(payload.player);
    return;
  }
  if (payload.type === "request_state" && state.isHost && state.game) {
    sendStateSync(payload.requesterId || null);
    return;
  }
  if (payload.type === "state_sync" && payload.payload) {
    if (payload.targetPlayerId && payload.targetPlayerId !== state.localPlayer.id) return;
    state.game = payload.payload;
    renderAll();
    renderLog();
    return;
  }
  if (payload.type === "action") {
    applyHostAction(payload);
  }
}

function startTimers() {
  stopTimers();
  heartbeatTimer = setInterval(() => sendPresence(), HEARTBEAT_MS);
  presenceTimer = setInterval(() => prunePresence(), HEARTBEAT_MS);
  stateSyncTimer = setInterval(() => {
    if (state.isHost && state.game) sendStateSync();
  }, STATE_SYNC_INTERVAL_MS);
}

function stopTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (presenceTimer) clearInterval(presenceTimer);
  if (stateSyncTimer) clearInterval(stateSyncTimer);
  heartbeatTimer = null;
  presenceTimer = null;
  stateSyncTimer = null;
}

async function connect() {
  const name = els.playerName.value.trim();
  const roomCode = els.roomCode.value.trim().toLowerCase();
  if (!name || !roomCode) {
    addLog("Vul naam en kamercode in.");
    return;
  }

  els.connectBtn.disabled = true;
  els.connectionStatus.textContent = "Verbinden...";

  try {
    const resp = await fetch(
      `/api/negotiate?name=${encodeURIComponent(name)}&room=${encodeURIComponent(roomCode)}`
    );
    if (!resp.ok) throw new Error(`Negotiate fout: ${resp.status}`);
    const data = await resp.json();
    if (!data.url || !data.playerId) throw new Error("Ongeldige negotiate respons.");

    state.localPlayer = {
      id: data.playerId,
      name,
      color: data.color || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
      joinedAt: nowTs()
    };
    state.roomCode = roomCode;
    state.players = {};
    updatePresence(state.localPlayer);

    let joinAckId = null;
    let joinFailed = false;
    state.socket = new WebSocket(data.url, "json.webpubsub.azure.v1");
    state.socket.onopen = () => {
      els.connectionStatus.textContent = "Kamer verbinden...";
      joinAckId = state.ackId++;
      state.socket.send(
        JSON.stringify({
          type: "joinGroup",
          group: roomCode,
          ackId: joinAckId
        })
      );
    };
    state.socket.onclose = () => {
      state.connected = false;
      els.connectionStatus.textContent = joinFailed ? "Kamer niet toegankelijk" : "Verbinding verbroken";
      els.copyInviteBtn.disabled = true;
      stopTimers();
      addLog("Verbinding gesloten.");
      renderAll();
    };
    state.socket.onerror = () => {
      addLog("WebSocket fout.");
    };
    state.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "ack" && msg.ackId === joinAckId) {
          if (!msg.success) {
            joinFailed = true;
            addLog(`Kamer joinen mislukt: ${msg.error?.message || "toegang geweigerd."}`);
            state.socket.close();
            return;
          }
          state.connected = true;
          els.connectionStatus.textContent = "Verbonden";
          els.copyInviteBtn.disabled = false;
          sendPresence();
          requestState();
          startTimers();
          renderAll();
          return;
        }
        if (msg.type === "ack" && !msg.success) {
          addLog(`Bericht versturen mislukt: ${msg.error?.message || "onbekende fout."}`);
          return;
        }
        if (msg.type === "message" && msg.dataType === "json") {
          handleGroupMessage(msg.data);
        }
      } catch {
        addLog("Onverwacht bericht ontvangen.");
      }
    };
  } catch (err) {
    addLog(`Verbinding mislukt: ${err.message}`);
    els.connectionStatus.textContent = "Niet verbonden";
  } finally {
    els.connectBtn.disabled = false;
  }
}

async function copyInviteLink() {
  if (!state.roomCode || !state.connected) return;
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", state.roomCode);
  try {
    await navigator.clipboard.writeText(inviteUrl.toString());
    addLog("Uitnodigingslink gekopieerd. Deel deze met andere spelers.");
  } catch (error) {
    addLog(`Uitnodigingslink kopiëren mislukt: ${error.message}`);
  }
}

function startGame() {
  if (!state.isHost || !state.connected) return;
  const players = sortPlayerEntries(state.players).map((p) => p.id);
  if (players.length < 2) {
    addLog("Minimaal 2 spelers nodig.");
    return;
  }
  state.game = initialGameFromPlayers(players);
  renderAll();
  renderLog();
  sendStateSync();
}

const inviteRoomCode = new URLSearchParams(window.location.search).get("room");
if (inviteRoomCode) {
  els.roomCode.value = inviteRoomCode.trim().toLowerCase();
}

els.connectBtn.addEventListener("click", connect);
els.copyInviteBtn.addEventListener("click", copyInviteLink);
els.startGameBtn.addEventListener("click", startGame);

resetGameUi();
renderTerritories();
