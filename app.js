const TERRITORIES = [
  { id: "noordwest", naam: "Noordwest", x: 245, y: 180, buren: ["noord", "west"] },
  { id: "noord", naam: "Noord", x: 480, y: 115, buren: ["noordwest", "noordoost", "centrum"] },
  { id: "noordoost", naam: "Noordoost", x: 720, y: 180, buren: ["noord", "oost"] },
  { id: "west", naam: "West", x: 155, y: 350, buren: ["noordwest", "centrum", "zuidwest"] },
  { id: "centrum", naam: "Centrum", x: 470, y: 320, buren: ["noord", "west", "oost", "zuid"] },
  { id: "oost", naam: "Oost", x: 790, y: 350, buren: ["noordoost", "centrum", "zuidoost"] },
  { id: "zuidwest", naam: "Zuidwest", x: 270, y: 500, buren: ["west", "zuid", "verre-zuidwest"] },
  { id: "zuid", naam: "Zuid", x: 515, y: 485, buren: ["centrum", "zuidwest", "zuidoost", "eiland"] },
  { id: "zuidoost", naam: "Zuidoost", x: 770, y: 500, buren: ["oost", "zuid", "verre-zuidoost"] },
  { id: "verre-zuidwest", naam: "Verre Zuidwest", x: 115, y: 590, buren: ["zuidwest", "eiland"] },
  { id: "eiland", naam: "Eiland", x: 515, y: 635, buren: ["zuid", "verre-zuidwest", "verre-zuidoost"] },
  { id: "verre-zuidoost", naam: "Verre Zuidoost", x: 900, y: 590, buren: ["zuidoost", "eiland"] }
];

const PLAYER_COLORS = ["#e74c3c", "#f39c12", "#2ecc71", "#3498db", "#9b59b6", "#1abc9c"];
const ROOM_CODE_ADJECTIVES = [
  "amber",
  "cobalt",
  "copper",
  "glass",
  "jade",
  "monsoon",
  "ochre",
  "sable",
  "saltwind",
  "saffron",
  "windward",
  "zephyr"
];
const ROOM_CODE_LANDMARKS = [
  "basin",
  "citadel",
  "coast",
  "crown",
  "delta",
  "frontier",
  "harbor",
  "island",
  "pass",
  "plateau",
  "ridge",
  "strait"
];
const SVG_NS = "http://www.w3.org/2000/svg";

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
  hostId: null,
  invitedHostId: null,
  invitedRoomCode: null
};

const els = {
  app: document.querySelector(".app"),
  playerName: document.getElementById("player-name"),
  roomCode: document.getElementById("room-code"),
  appVersion: document.getElementById("app-version"),
  connectBtn: document.getElementById("connect-btn"),
  copyInviteBtn: document.getElementById("copy-invite-btn"),
  connectionStatus: document.getElementById("connection-status"),
  toastRegion: document.getElementById("toast-region"),
  playersList: document.getElementById("players-list"),
  mapPlayerLegend: document.getElementById("map-player-legend"),
  startGameBtn: document.getElementById("start-game-btn"),
  connectionPanel: document.getElementById("connection-panel"),
  lobbyPanel: document.getElementById("lobby-panel"),
  hostLabel: document.getElementById("host-label"),
  gameMeta: document.getElementById("game-meta"),
  mapFrame: document.querySelector(".map-frame"),
  phaseActions: document.getElementById("phase-actions"),
  attackControls: document.getElementById("attack-controls"),
  fortifyControls: document.getElementById("fortify-controls"),
  territoryList: document.getElementById("territory-list"),
  mapRoutes: document.getElementById("map-routes"),
  logList: document.getElementById("log-list")
};

let heartbeatTimer = null;
let presenceTimer = null;
let stateSyncTimer = null;
let gameWasStarted = false;
const toastTimers = new WeakMap();

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function generateRoomCode() {
  const choose = (items) => items[Math.floor(Math.random() * items.length)];
  const suffix = Math.floor(Math.random() * 900_000) + 100_000;
  return `${choose(ROOM_CODE_ADJECTIVES)}-${choose(ROOM_CODE_LANDMARKS)}-${suffix}`;
}

async function loadAppVersion() {
  try {
    const response = await fetch("package.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Versiebestand ophalen mislukt: ${response.status}`);

    const packageInfo = await response.json();
    if (typeof packageInfo.version !== "string" || !/^\d+\.\d+\.\d+$/.test(packageInfo.version)) {
      throw new Error("package.json bevat geen geldige semantische versie.");
    }
    els.appVersion.textContent = `v${packageInfo.version}`;
  } catch (error) {
    els.appVersion.textContent = "onbekend";
    console.error("Versie laden mislukt.", error);
  }
}

function nowTs() {
  return Date.now();
}

function dismissToast(toast) {
  const timer = toastTimers.get(toast);
  if (timer) window.clearTimeout(timer);
  toastTimers.delete(toast);
  toast.remove();
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;

  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = message;

  const closeButton = document.createElement("button");
  closeButton.className = "toast-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Melding sluiten");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => dismissToast(toast));

  toast.append(text, closeButton);
  els.toastRegion.appendChild(toast);
  while (els.toastRegion.children.length > 3) {
    dismissToast(els.toastRegion.firstElementChild);
  }
  toastTimers.set(toast, window.setTimeout(() => dismissToast(toast), 6000));
}

function resetGameUi() {
  els.gameMeta.textContent = "Nog geen spel gestart.";
  els.phaseActions.innerHTML = "";
  els.attackControls.innerHTML = "";
  els.fortifyControls.innerHTML = "";
}

function addLog(text) {
  const isError = /mislukt|fout|onverwacht|vul je|geen kamercode|minimaal/i.test(text);
  const isSuccess = /gekopieerd/i.test(text);
  showToast(text, isError ? "error" : isSuccess ? "success" : "info");

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
  const invitedHostId = state.roomCode === state.invitedRoomCode ? state.invitedHostId : null;
  state.hostId = invitedHostId || (entries.length ? entries[0].id : null);
  state.isHost = state.localPlayer && state.hostId === state.localPlayer.id;
  const waitingForHost = invitedHostId && !state.players[invitedHostId];
  els.hostLabel.textContent = waitingForHost
    ? "Wachten op lobbyhost"
    : state.hostId
      ? `Host: ${playerLabel(state.hostId)}`
      : "Host: onbekend";
  els.startGameBtn.disabled = !(state.isHost && state.connected && !state.game && entries.length >= 2);
  els.copyInviteBtn.disabled = !(state.isHost && state.connected);
}

function renderPlayers() {
  const entries = sortPlayerEntries(state.players);
  els.playersList.innerHTML = "";
  els.mapPlayerLegend.replaceChildren();
  for (const p of entries) {
    const div = document.createElement("div");
    div.className = "chip";
    const hostMark = p.id === state.hostId ? " 👑" : "";
    const colorDot = document.createElement("span");
    colorDot.className = "player-dot";
    colorDot.style.backgroundColor = p.color;
    div.append(colorDot, document.createTextNode(`${p.name}${hostMark}`));
    els.playersList.appendChild(div);

    const legendEntry = document.createElement("span");
    legendEntry.className = "map-player-entry";
    legendEntry.setAttribute("role", "listitem");
    const legendDot = document.createElement("span");
    legendDot.className = "map-player-swatch";
    legendDot.style.backgroundColor = p.color;
    legendDot.setAttribute("aria-hidden", "true");
    const legendName = document.createElement("span");
    legendName.className = "map-player-name";
    legendName.textContent = p.name;
    legendEntry.append(legendDot, legendName);
    els.mapPlayerLegend.appendChild(legendEntry);
  }
}

function renderTerritories() {
  const game = state.game;
  els.mapRoutes.replaceChildren();
  els.territoryList.replaceChildren();

  for (const t of TERRITORIES) {
    for (const neighborId of t.buren) {
      if (t.id.localeCompare(neighborId) >= 0) continue;
      const neighbor = territoryById(neighborId);
      els.mapRoutes.appendChild(
        createSvgElement("line", {
          class: "map-route",
          x1: t.x,
          y1: t.y,
          x2: neighbor.x,
          y2: neighbor.y
        })
      );
    }
  }

  for (const t of TERRITORIES) {
    const owner = game?.territories?.[t.id]?.ownerId || "niemand";
    const armies = game?.territories?.[t.id]?.armies ?? 0;
    const ownerPlayer = state.players[owner];
    const canPlaceReinforcement = Boolean(
      game &&
      game.phase === "versterken" &&
      game.reinforcementsLeft > 0 &&
      currentPlayerCanAct() &&
      owner === state.localPlayer?.id
    );
    const territoryLabel = `${t.naam}: ${ownerPlayer?.name || "neutraal"}, ${armies} legers`;
    const marker = createSvgElement("g", {
      class: `territory-marker${ownerPlayer ? " is-owned" : ""}${canPlaceReinforcement ? " is-selectable" : ""}`,
      role: canPlaceReinforcement ? "button" : "img",
      ...(canPlaceReinforcement ? { tabindex: 0 } : {}),
      "aria-label": canPlaceReinforcement
        ? `${territoryLabel}. Klik om 1 leger te plaatsen.`
        : territoryLabel
    });
    if (canPlaceReinforcement) {
      const placeReinforcement = () => {
        if (
          !state.game ||
          state.game.phase !== "versterken" ||
          state.game.reinforcementsLeft <= 0 ||
          !currentPlayerCanAct() ||
          state.game.territories[t.id]?.ownerId !== state.localPlayer?.id
        ) {
          return;
        }
        sendAction({ kind: "reinforce", territoryId: t.id });
      };
      marker.addEventListener("click", placeReinforcement);
      marker.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          placeReinforcement();
        }
      });
    }
    marker.style.setProperty("--territory-color", ownerPlayer?.color || "#c8b783");
    const name = createSvgElement("text", {
      class: "territory-name",
      x: t.x,
      y: t.y,
      "text-anchor": "middle",
      "dominant-baseline": "middle"
    });
    const words = t.naam.split(" ");
    if (words.length > 1) {
      const firstLine = createSvgElement("tspan", { x: t.x, dy: -6 });
      firstLine.textContent = words[0];
      const secondLine = createSvgElement("tspan", { x: t.x, dy: 12 });
      secondLine.textContent = words.slice(1).join(" ");
      name.append(firstLine, secondLine);
    } else {
      name.textContent = t.naam;
    }
    marker.appendChild(name);
    els.territoryList.appendChild(marker);

    const labelBounds = name.getBBox();
    const labelBackground = createSvgElement("rect", {
      class: "territory-label-bg",
      x: labelBounds.x - 8,
      y: labelBounds.y - 5,
      width: labelBounds.width + 16,
      height: labelBounds.height + 10,
      rx: 7
    });
    marker.insertBefore(labelBackground, name);
    const armyX = labelBounds.x + labelBounds.width + 12;
    const armyY = labelBounds.y;
    marker.appendChild(createSvgElement("circle", {
      class: "territory-token",
      cx: armyX,
      cy: armyY,
      r: 13
    }));
    const armyCount = createSvgElement("text", {
      class: "territory-armies",
      x: armyX,
      y: armyY,
      "text-anchor": "middle",
      "dominant-baseline": "central"
    });
    armyCount.textContent = game ? String(armies) : "·";
    marker.appendChild(armyCount);
  }
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
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
  const attackSelection = {
    fromId: els.attackControls.querySelector('[aria-label="Aanvallen vanuit"]')?.value,
    toId: els.attackControls.querySelector('[aria-label="Aanvallen naar"]')?.value,
    attackDice: els.attackControls.querySelector('[aria-label="Aantal dobbelstenen"]')?.value
  };
  const fortifySelection = {
    fromId: els.fortifyControls.querySelector('[aria-label="Verplaatsen vanuit"]')?.value,
    toId: els.fortifyControls.querySelector('[aria-label="Verplaatsen naar"]')?.value,
    armies: els.fortifyControls.querySelector('[aria-label="Aantal legers"]')?.value
  };
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
      ? "Klik op een eigen gebied om 1 leger te plaatsen."
      : "Wachten op de actieve speler.";
    els.phaseActions.appendChild(help);
  }

  if (phase === "aanvallen") {
    if (canControl) {
      renderAttackControls(attackSelection);
    } else {
      const waiting = document.createElement("span");
      waiting.className = "status";
      waiting.textContent = "Wachten op de actieve speler.";
      els.phaseActions.appendChild(waiting);
    }
    const endAttack = document.createElement("button");
    endAttack.textContent = "Aanvallen beëindigen";
    endAttack.disabled = !canControl;
    endAttack.onclick = () => sendAction({ kind: "end_attack_phase" });
    els.attackControls.appendChild(endAttack);
  }

  if (phase === "verplaatsen") {
    if (canControl) {
      renderFortifyControls(fortifySelection);
    } else {
      const waiting = document.createElement("span");
      waiting.className = "status";
      waiting.textContent = "Wachten op de actieve speler.";
      els.phaseActions.appendChild(waiting);
    }
    const endTurn = document.createElement("button");
    endTurn.textContent = "Beurt beëindigen";
    endTurn.disabled = !canControl;
    endTurn.onclick = () => sendAction({ kind: "end_turn" });
    els.fortifyControls.appendChild(endTurn);
  }
}

function renderAttackControls(selection = {}) {
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
  fromSelect.setAttribute("aria-label", "Aanvallen vanuit");
  for (const id of fromCandidates) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = territoryById(id).naam;
    fromSelect.appendChild(o);
  }
  if (fromCandidates.includes(selection.fromId)) fromSelect.value = selection.fromId;

  const toSelect = document.createElement("select");
  toSelect.setAttribute("aria-label", "Aanvallen naar");
  const diceSelect = document.createElement("select");
  diceSelect.setAttribute("aria-label", "Aantal dobbelstenen");
  [1, 2, 3].forEach((d) => {
    const o = document.createElement("option");
    o.value = String(d);
    o.textContent = `${d} dobbelsteen${d > 1 ? "en" : ""}`;
    diceSelect.appendChild(o);
  });
  if (selection.attackDice) diceSelect.value = selection.attackDice;

  function refreshToOptions(preferredToId = toSelect.value) {
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
    if (enemyNeighbors.includes(preferredToId)) toSelect.value = preferredToId;
    const maxDice = Math.min(3, state.game.territories[fromId].armies - 1);
    Array.from(diceSelect.options).forEach((opt) => {
      opt.disabled = Number(opt.value) > maxDice;
    });
    if (Number(diceSelect.value) > maxDice) {
      diceSelect.value = String(maxDice);
    }
  }

  fromSelect.onchange = () => refreshToOptions(toSelect.value);
  refreshToOptions(selection.toId);

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

function renderFortifyControls(selection = {}) {
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
  fromSelect.setAttribute("aria-label", "Verplaatsen vanuit");
  toSelect.setAttribute("aria-label", "Verplaatsen naar");
  countInput.type = "number";
  countInput.min = "1";
  countInput.value = "1";
  countInput.setAttribute("aria-label", "Aantal legers");
  if (selection.armies) countInput.value = selection.armies;

  for (const id of fromCandidates) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = territoryById(id).naam;
    fromSelect.appendChild(o);
  }
  if (fromCandidates.includes(selection.fromId)) fromSelect.value = selection.fromId;

  function refreshToCandidates(preferredToId = toSelect.value) {
    const fromId = fromSelect.value;
    toSelect.innerHTML = "";
    const valid = neighborsOf(fromId).filter((id) => state.game.territories[id].ownerId === myId);
    for (const id of valid) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = territoryById(id).naam;
      toSelect.appendChild(o);
    }
    if (valid.includes(preferredToId)) toSelect.value = preferredToId;
    const maxMove = Math.max(1, state.game.territories[fromId].armies - 1);
    countInput.max = String(maxMove);
    if (Number(countInput.value) > maxMove) countInput.value = String(maxMove);
  }
  fromSelect.onchange = () => refreshToCandidates(toSelect.value);
  refreshToCandidates(selection.toId);

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
  const gameStarted = Boolean(state.game);
  els.app.classList.toggle("is-playing", gameStarted);
  if (gameStarted && !gameWasStarted) {
    els.connectionPanel.open = false;
    els.lobbyPanel.open = false;
  }
  gameWasStarted = gameStarted;
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

function notifyGameUpdate(previousGame, nextGame) {
  const nextLog = Array.isArray(nextGame?.log) ? nextGame.log : [];
  const previousLog = Array.isArray(previousGame?.log) ? previousGame.log : [];
  const latestMessage = nextLog.at(-1);
  if (
    typeof latestMessage !== "string" ||
    (previousGame && nextLog.length <= previousLog.length && latestMessage === previousLog.at(-1))
  ) {
    return;
  }

  const type = /spel gestart|verovert|wint het spel/i.test(latestMessage) ? "success" : "info";
  showToast(latestMessage, type);
}

function ensureHostActionEnvelope(message) {
  return state.isHost && message?.type === "action" && message?.actorId;
}

function applyHostAction(message) {
  if (!ensureHostActionEnvelope(message) || !state.game || state.game.winnerId) return;
  const action = message.action;
  const actorId = message.actorId;
  const previousGame = state.game;
  const game = cloneGame(previousGame);
  const turnPlayer = game.turnOrder[game.turnIndex];
  if (actorId !== turnPlayer) return;

  const territoryIds = new Set(TERRITORIES.map((t) => t.id));
  const reinforceTerritoryId =
    typeof action.territoryId === "string" && territoryIds.has(action.territoryId) ? action.territoryId : null;
  const fromId = typeof action.fromId === "string" && territoryIds.has(action.fromId) ? action.fromId : null;
  const toId = typeof action.toId === "string" && territoryIds.has(action.toId) ? action.toId : null;

  let changed = false;

  if (action.kind === "reinforce" && game.phase === "versterken" && game.reinforcementsLeft > 0) {
    if (!reinforceTerritoryId) return;
    const territory = game.territories[reinforceTerritoryId];
    if (territory && territory.ownerId === actorId) {
      territory.armies += 1;
      game.reinforcementsLeft -= 1;
      appendGameLog(game, `${playerLabel(actorId)} versterkt ${territoryById(reinforceTerritoryId).naam}.`);
      changed = true;
      if (game.reinforcementsLeft <= 0) {
        game.phase = "aanvallen";
      }
    }
  }

  if (action.kind === "attack" && game.phase === "aanvallen") {
    if (!fromId || !toId) return;
    const from = game.territories[fromId];
    const to = game.territories[toId];
    const isNeighbor = neighborsOf(fromId).includes(toId);
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
      `${playerLabel(actorId)} valt ${territoryById(toId).naam} aan (${aRoll.join(",")} vs ${dRoll.join(",")}).`
    );
    changed = true;

    if (to.armies <= 0) {
      const moveArmies = attackDice;
      to.ownerId = actorId;
      to.armies = moveArmies;
      from.armies -= moveArmies;
      appendGameLog(game, `${playerLabel(actorId)} verovert ${territoryById(toId).naam}.`);
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
    notifyGameUpdate(previousGame, game);
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
    const previousGame = state.game;
    state.game = payload.payload;
    notifyGameUpdate(previousGame, state.game);
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
  if (!name) {
    addLog("Vul je naam in.");
    return;
  }
  if (!roomCode) {
    addLog("Er is geen kamercode beschikbaar. Vernieuw de pagina.");
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
          showToast("Verbonden met de lobby.", "success");
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
  if (!state.roomCode || !state.connected || !state.isHost || !state.localPlayer) return;
  state.invitedHostId = state.localPlayer.id;
  state.invitedRoomCode = state.roomCode;
  recomputeHost();
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", state.roomCode);
  inviteUrl.searchParams.set("host", state.localPlayer.id);
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
  notifyGameUpdate(null, state.game);
  renderAll();
  renderLog();
  sendStateSync();
}

const inviteParams = new URLSearchParams(window.location.search);
const inviteRoomCode = inviteParams.get("room")?.trim().toLowerCase() || null;
state.invitedHostId = inviteParams.get("host")?.trim() || null;
state.invitedRoomCode = inviteRoomCode;
els.roomCode.value = inviteRoomCode || generateRoomCode();

els.connectBtn.addEventListener("click", connect);
els.copyInviteBtn.addEventListener("click", copyInviteLink);
els.startGameBtn.addEventListener("click", startGame);

loadAppVersion();
resetGameUi();
renderTerritories();
if (window.matchMedia("(max-width: 700px)").matches) {
  els.mapFrame.scrollLeft = (els.mapFrame.scrollWidth - els.mapFrame.clientWidth) / 2;
}
