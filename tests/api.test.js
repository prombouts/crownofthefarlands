const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

test("negotiate validates input, reports configuration errors, and creates a scoped token", async () => {
  const apiDirectory = path.join(__dirname, "..", "api");
  const handlerPath = require.resolve(path.join(apiDirectory, "negotiate", "index.js"));
  let tokenOptions;
  let clientArguments;
  let shouldFailTokenCreation = false;
  const originalConnectionString = process.env.WEB_PUBSUB_CONNECTION_STRING;
  const originalHub = process.env.WEB_PUBSUB_HUB;

  class FakeWebPubSubServiceClient {
    constructor(...args) {
      clientArguments = args;
    }

    async getClientAccessToken(options) {
      if (shouldFailTokenCreation) throw new Error("SDK failure");
      tokenOptions = options;
      return { url: "wss://example.test/client?token=redacted" };
    }
  }

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@azure/web-pubsub") {
      return { WebPubSubServiceClient: FakeWebPubSubServiceClient };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[handlerPath];

  try {
    const negotiate = require(handlerPath);
    const context = { error() {} };
    const request = (query) => ({ query: new URLSearchParams(query) });

    const missingInput = await negotiate(request("name=Robin"), context);
    assert.equal(missingInput.status, 400);
    assert.deepEqual(missingInput.jsonBody, { error: "Naam en kamercode zijn verplicht." });

    delete process.env.WEB_PUBSUB_CONNECTION_STRING;
    const missingConfiguration = await negotiate(request("name=Robin&room=amber-citadel-123456"), context);
    assert.equal(missingConfiguration.status, 500);
    assert.match(missingConfiguration.jsonBody.error, /WEB_PUBSUB_CONNECTION_STRING/);

    process.env.WEB_PUBSUB_CONNECTION_STRING = "Endpoint=https://example.test;AccessKey=fake";
    process.env.WEB_PUBSUB_HUB = "test-hub";
    const response = await negotiate(request("name=%20Robin%20&room=amber-citadel-123456"), context);
    assert.equal(response.status, 200);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(response.jsonBody.url, "wss://example.test/client?token=redacted");
    assert.match(response.jsonBody.playerId, /^p-[0-9a-f]{8}$/);
    assert.match(response.jsonBody.color, /^#[0-9a-f]{6}$/i);
    assert.deepEqual(clientArguments, ["Endpoint=https://example.test;AccessKey=fake", "test-hub"]);
    assert.equal(tokenOptions.userId, response.jsonBody.playerId);
    assert.deepEqual(tokenOptions.groups, ["amber-citadel-123456"]);
    assert.deepEqual(tokenOptions.roles, ["webpubsub.joinLeaveGroup", "webpubsub.sendToGroup"]);

    shouldFailTokenCreation = true;
    const failed = await negotiate(request("name=Robin&room=amber-citadel-123456"), context);
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.jsonBody, { error: "Kon geen realtime token aanmaken." });
  } finally {
    Module._load = originalLoad;
    delete require.cache[handlerPath];
    if (originalConnectionString === undefined) {
      delete process.env.WEB_PUBSUB_CONNECTION_STRING;
    } else {
      process.env.WEB_PUBSUB_CONNECTION_STRING = originalConnectionString;
    }
    if (originalHub === undefined) {
      delete process.env.WEB_PUBSUB_HUB;
    } else {
      process.env.WEB_PUBSUB_HUB = originalHub;
    }
  }
});
