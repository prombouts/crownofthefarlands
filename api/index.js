const { app } = require("@azure/functions");
const negotiate = require("./negotiate");

app.http("negotiate", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "negotiate",
  handler: negotiate
});
