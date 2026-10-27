const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const appSource = readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const html = readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function createApp() {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://example.test/"
  });
  const { window } = dom;

  window.matchMedia = () => ({ matches: false });
  window.SVGElement.prototype.getBBox = function () {
    return {
      x: 0,
      y: 0,
      width: (this.textContent || "").length * 7,
      height: 16
    };
  };
  window.fetch = async () => ({
    ok: true,
    json: async () => ({ version: "1.4.1" })
  });
  new vm.Script(appSource, { filename: path.join(__dirname, "..", "app.js") }).runInContext(
    dom.getInternalVMContext()
  );

  return dom;
}

function runApp(dom, script) {
  return vm.runInContext(script, dom.getInternalVMContext());
}

function prepareGame(dom, { phase = "versterken", reinforcementsLeft = 1, fromArmies = 5 } = {}) {
  runApp(
    dom,
    `(() => {
      const territories = Object.fromEntries(
        TERRITORIES.map(({ id }) => [id, { ownerId: "player-a", armies: 2 }])
      );
      territories.noordwest.armies = ${fromArmies};
      territories.noord = { ownerId: "player-b", armies: 1 };
      state.localPlayer = { id: "player-a", name: "Robin", color: "#e74c3c", joinedAt: 1 };
      state.players = {
        "player-a": { id: "player-a", name: "Robin", color: "#e74c3c", joinedAt: 1, lastSeenAt: 1 },
        "player-b": { id: "player-b", name: "Sam", color: "#3498db", joinedAt: 2, lastSeenAt: 2 }
      };
      state.roomCode = "amber-citadel-123456";
      state.connected = true;
      state.isHost = true;
      state.hostId = "player-a";
      state.game = {
        turnOrder: ["player-a", "player-b"],
        turnIndex: 0,
        phase: ${JSON.stringify(phase)},
        reinforcementsLeft: ${reinforcementsLeft},
        territories,
        winnerId: null,
        log: [],
        lastFortifyTurn: null
      };
      window.__sentMessages = [];
      state.socket = {
        readyState: WebSocket.OPEN,
        send: (message) => window.__sentMessages.push(JSON.parse(message))
      };
    })()`
  );
}

test("app renders translated interface and all map territories", (t) => {
  const dom = createApp();
  t.after(() => dom.window.close());

  assert.equal(dom.window.document.documentElement.lang, "nl");
  assert.equal(dom.window.document.querySelectorAll(".territory-marker").length, 12);
  assert.equal(dom.window.document.querySelectorAll(".map-route").length, 17);
});

test("room codes include a themed name and six-digit suffix", (t) => {
  const dom = createApp();
  t.after(() => dom.window.close());

  assert.match(dom.window.generateRoomCode(), /^[a-z]+-[a-z]+-\d{6}$/);
});

test("new games distribute every territory and calculate reinforcements", (t) => {
  const dom = createApp();
  t.after(() => dom.window.close());
  const game = dom.window.initialGameFromPlayers(["player-a", "player-b"]);

  assert.equal(Object.keys(game.territories).length, 12);
  assert.equal(game.turnOrder[game.turnIndex], "player-a");
  assert.equal(game.phase, "versterken");
  assert.equal(game.reinforcementsLeft, 3);
  assert.equal(
    Object.values(game.territories).reduce((total, territory) => total + territory.armies, 0),
    18
  );
  assert.equal(dom.window.computeReinforcementsFor("player-a", game), 3);
});

test("winner detection requires control of every territory", (t) => {
  const dom = createApp();
  t.after(() => dom.window.close());
  const territories = {
    north: { ownerId: "player-a", armies: 2 },
    south: { ownerId: "player-a", armies: 1 }
  };

  assert.equal(dom.window.checkWinner({ territories }), "player-a");
  territories.south.ownerId = "player-b";
  assert.equal(dom.window.checkWinner({ territories }), null);
});

test("reinforcing spends the last reinforcement, advances phase, and syncs state", (t) => {
  const dom = createApp();
  t.after(() => dom.window.close());
  prepareGame(dom);

  dom.window.applyHostAction({
    type: "action",
    actorId: "player-a",
    action: { kind: "reinforce", territoryId: "noordwest" }
  });

  assert.equal(runApp(dom, "state.game.territories.noordwest.armies"), 6);
  assert.equal(runApp(dom, "state.game.reinforcementsLeft"), 0);
  assert.equal(runApp(dom, "state.game.phase"), "aanvallen");
  assert.equal(runApp(dom, "state.game.log.at(-1).key"), "log.reinforced");
  assert.equal(runApp(dom, "window.__sentMessages.at(-1).data.type"), "state_sync");
});

test("a successful attack conquers a territory and detects the winner", (t) => {
  const dom = createApp();
  t.after(() => dom.window.close());
  prepareGame(dom, { phase: "aanvallen" });
  runApp(dom, "window.__diceRolls = [0.99, 0.99, 0]; Math.random = () => window.__diceRolls.shift() ?? 0");

  dom.window.applyHostAction({
    type: "action",
    actorId: "player-a",
    action: { kind: "attack", fromId: "noordwest", toId: "noord", attackDice: 2 }
  });

  assert.equal(runApp(dom, "state.game.territories.noord.ownerId"), "player-a");
  assert.equal(runApp(dom, "state.game.territories.noord.armies"), 2);
  assert.equal(runApp(dom, "state.game.territories.noordwest.armies"), 3);
  assert.equal(runApp(dom, "state.game.winnerId"), "player-a");
  assert.deepEqual(JSON.parse(JSON.stringify(runApp(dom, "state.game.log.map((entry) => entry.key)"))), [
    "log.attack",
    "log.conquered",
    "log.winner"
  ]);
});

test("turn progression supports fortifying and starts the next player's reinforcement phase", (t) => {
  const dom = createApp();
  t.after(() => dom.window.close());
  prepareGame(dom, { phase: "aanvallen" });

  dom.window.applyHostAction({
    type: "action",
    actorId: "player-a",
    action: { kind: "end_attack_phase" }
  });
  assert.equal(runApp(dom, "state.game.phase"), "verplaatsen");

  dom.window.applyHostAction({
    type: "action",
    actorId: "player-a",
    action: { kind: "fortify", fromId: "noordwest", toId: "west", armies: 2 }
  });
  assert.equal(runApp(dom, "state.game.territories.noordwest.armies"), 3);
  assert.equal(runApp(dom, "state.game.territories.west.armies"), 4);

  dom.window.applyHostAction({
    type: "action",
    actorId: "player-a",
    action: { kind: "end_turn" }
  });
  assert.equal(runApp(dom, "state.game.turnIndex"), 1);
  assert.equal(runApp(dom, "state.game.phase"), "versterken");
  assert.equal(runApp(dom, "state.game.reinforcementsLeft"), 3);
});

test("group messages update presence and accept only state syncs addressed to this player", (t) => {
  const dom = createApp();
  t.after(() => dom.window.close());
  runApp(
    dom,
    `state.localPlayer = { id: "player-a", name: "Robin", color: "#e74c3c", joinedAt: 1 };
     state.players = {};
     handleGroupMessage({
       type: "presence",
       player: { id: "player-b", name: "Sam", color: "#3498db", joinedAt: 2 }
     });`
  );

  assert.equal(runApp(dom, 'state.players["player-b"].name'), "Sam");

  runApp(
    dom,
    `handleGroupMessage({
       type: "state_sync",
       targetPlayerId: "player-b",
       payload: { phase: "versterken" }
     });`
  );
  assert.equal(runApp(dom, "state.game"), null);

  runApp(
    dom,
    `const syncedGame = initialGameFromPlayers(["player-a", "player-b"]);
     handleGroupMessage({
       type: "state_sync",
       targetPlayerId: "player-a",
       payload: syncedGame
     });`
  );
  assert.equal(runApp(dom, "state.game.phase"), "versterken");
});
