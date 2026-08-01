import { createApp } from "../src/app.js";

let app;

export default async function handler(req, res) {
  if (!app) {
    app = await createApp();
    await app.ready();
  }
  app.server.emit("request", req, res);
}
