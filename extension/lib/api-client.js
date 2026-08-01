/**
 * HTTP client for communicating with the AutoApply backend.
 */

import * as log from "./logger.js";

const BACKEND_URL = "https://autoapply-beryl.vercel.app";
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 1;

/**
 * Sends a fill request to the backend proxy.
 * @param {object} payload - { fields, profile, jobContext? }
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<{fills: Array, errors?: Array}>}
 */
export async function requestFill(payload, signal) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/api/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (resp.status === 429) {
        const wait = Math.pow(3, attempt + 1) * 1000;
        log.warn(`Rate limited. Retrying in ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Backend error ${resp.status}: ${text || resp.statusText}`);
      }

      return await resp.json();
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;

      if (err.name === "AbortError") {
        throw new Error("Request timed out after 30 seconds. Check your connection and try again.");
      }

      if (attempt < MAX_RETRIES) {
        log.warn(`Request failed, retrying (${attempt + 1}/${MAX_RETRIES}):`, err.message);
        continue;
      }
    }
  }

  log.error("API request failed after retries:", lastError?.message);
  throw lastError;
}
