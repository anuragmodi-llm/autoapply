/**
 * Fastify app factory.
 * Shared between local dev (server.js) and Vercel (api/index.js).
 */

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fillRoute from "./routes/fill.js";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export async function createApp({ pretty = false } = {}) {
  const loggerConfig = pretty
    ? { level: "info", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
    : { level: "info" };

  const app = Fastify({ logger: loggerConfig });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        origin.startsWith("chrome-extension://") ||
        ALLOWED_ORIGINS.includes(origin)
      ) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"), false);
      }
    },
  });

  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      error: "Rate limit exceeded",
      message: "Too many requests. Please wait a minute and try again.",
    }),
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(fillRoute);

  return app;
}
