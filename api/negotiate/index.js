const { WebPubSubServiceClient } = require("@azure/web-pubsub");

const PLAYER_COLORS = ["#e74c3c", "#f39c12", "#2ecc71", "#3498db", "#9b59b6", "#1abc9c"];

function randomId(prefix = "") {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = async function (request, context) {
  try {
    const requestedName = (request.query.get("name") || "").trim();
    const room = (request.query.get("room") || "").trim();
    if (!requestedName || !room) {
      return {
        status: 400,
        jsonBody: { error: "Naam en kamercode zijn verplicht." }
      };
    }

    const connectionString = process.env.WEB_PUBSUB_CONNECTION_STRING;
    const hub = process.env.WEB_PUBSUB_HUB || "riskonline";
    if (!connectionString) {
      return {
        status: 500,
        jsonBody: { error: "WEB_PUBSUB_CONNECTION_STRING ontbreekt." }
      };
    }

    const playerId = randomId("p-");
    const serviceClient = new WebPubSubServiceClient(connectionString, hub);
    const token = await serviceClient.getClientAccessToken({
      userId: playerId,
      roles: ["webpubsub.joinLeaveGroup", "webpubsub.sendToGroup"],
      groups: [room]
    });

    return {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      },
      jsonBody: {
        url: token.url,
        playerId,
        color: PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)]
      }
    };
  } catch (error) {
    context.error("Negotiate error", error);
    return {
      status: 500,
      jsonBody: { error: "Kon geen realtime token aanmaken." }
    };
  }
};
