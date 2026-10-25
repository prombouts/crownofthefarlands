const { WebPubSubServiceClient } = require("@azure/web-pubsub");

const PLAYER_COLORS = ["#e74c3c", "#f39c12", "#2ecc71", "#3498db", "#9b59b6", "#1abc9c"];

function randomId(prefix = "") {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = async function (context, req) {
  try {
    const connectionString = process.env.WEB_PUBSUB_CONNECTION_STRING;
    const hub = process.env.WEB_PUBSUB_HUB || "riskonline";
    if (!connectionString) {
      context.res = {
        status: 500,
        body: { error: "WEB_PUBSUB_CONNECTION_STRING ontbreekt." }
      };
      return;
    }

    const requestedName = (req.query.name || "").trim();
    const room = (req.query.room || "").trim();
    if (!requestedName || !room) {
      context.res = {
        status: 400,
        body: { error: "Naam en kamercode zijn verplicht." }
      };
      return;
    }

    const playerId = randomId("p-");
    const serviceClient = new WebPubSubServiceClient(connectionString, hub);
    const token = await serviceClient.getClientAccessToken({
      userId: playerId,
      roles: ["webpubsub.joinLeaveGroup", "webpubsub.sendToGroup"],
      groups: [room]
    });

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      },
      body: {
        url: token.url,
        playerId,
        color: PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)]
      }
    };
  } catch (error) {
    context.log.error("Negotiate error", error);
    context.res = {
      status: 500,
      body: { error: "Kon geen realtime token aanmaken." }
    };
  }
};
