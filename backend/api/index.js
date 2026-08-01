import { createApp } from "../src/app.js";

const app = await createApp();

export default async function handler(req, res) {
  await app.ready();
  app.server.emit("request", req, res);
}
