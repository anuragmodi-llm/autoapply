/**
 * AutoApply backend server — local dev entrypoint.
 * For Vercel, see api/index.js.
 */

import { createApp } from "./app.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

const app = await createApp();

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`AutoApply backend running on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
