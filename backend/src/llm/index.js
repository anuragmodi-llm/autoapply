/**
 * LLM router — reads config, loads the matching provider adapter,
 * splits fields into simple/complex batches, and merges results.
 * Direct (no-AI) mapping of fixed personal fields happens client-side in
 * the extension, so it can be edited without redeploying this backend.
 */

import { LLM_CONFIG } from "./config.js";
import { buildPrompt as buildFieldMapping } from "./prompts/field-mapping.js";
import { buildPrompt as buildFreetextAnswer } from "./prompts/freetext-answer.js";
import { buildPrompt as buildResumeParse } from "./prompts/resume-parse.js";

const SIMPLE_TYPES = new Set(["text", "email", "tel", "url", "number", "select", "radio", "checkbox", "date"]);
const MAX_CONCURRENT_COMPLEX = 5;
const RATE_LIMIT_RETRY_DELAY_MS = 2000;

/**
 * Cleans up malformed JSON that free LLM models frequently produce:
 * markdown code fences, leading prose, literal control characters inside
 * strings, and invalid escape sequences like \a or \P.
 */
function sanitizeJson(raw) {
  let s = raw.trim();

  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/, "");
  s = s.trim();

  // Extract the JSON object/array if there's leading prose
  const firstBrace = s.indexOf("{");
  const firstBracket = s.indexOf("[");
  let jsonStart = -1;
  if (firstBrace >= 0 && firstBracket >= 0) jsonStart = Math.min(firstBrace, firstBracket);
  else if (firstBrace >= 0) jsonStart = firstBrace;
  else if (firstBracket >= 0) jsonStart = firstBracket;
  if (jsonStart > 0) s = s.slice(jsonStart);

  // Trim trailing non-JSON
  const lastBrace = s.lastIndexOf("}");
  const lastBracket = s.lastIndexOf("]");
  const jsonEnd = Math.max(lastBrace, lastBracket);
  if (jsonEnd > 0) s = s.slice(0, jsonEnd + 1);

  // Replace literal control characters (0x00–0x1f) with escape sequences
  s = s.replace(/[\x00-\x1f]/g, (ch) => {
    const map = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
    return map[ch] || "";
  });

  // Fix invalid JSON escape sequences: \X where X is not a valid JSON escape char
  s = s.replace(/\\(?!["\\\/bfnrtu])/g, "\\\\");

  return s;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Loads the provider adapter based on provider name.
 * @param {string} provider
 * @returns {Promise<{complete: Function}>}
 */
async function loadProvider(provider) {
  switch (provider) {
    case "openrouter":
      return import("./providers/openrouter.js");
    case "together":
      return import("./providers/together.js");
    default:
      throw new Error(`Unknown LLM provider: "${provider}". Supported: openrouter, together.`);
  }
}

/**
 * Calls the LLM with automatic fallback on failure and one retry-after-delay
 * per provider on rate limit (HTTP 429) responses.
 * @param {object} params - { messages, responseSchema }
 * @returns {Promise<{content: string, usage: object, provider: string, model: string}>}
 */
async function callWithFallback({ messages, responseSchema }) {
  const configs = [
    { provider: LLM_CONFIG.provider, model: LLM_CONFIG.model },
    { provider: LLM_CONFIG.fallback.provider, model: LLM_CONFIG.fallback.model },
  ];

  let lastErr;
  for (let i = 0; i < configs.length; i++) {
    const { provider, model } = configs[i];
    const adapter = await loadProvider(provider);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await adapter.complete({
          model,
          messages,
          temperature: LLM_CONFIG.temperature,
          maxTokens: LLM_CONFIG.maxTokens,
          responseSchema,
        });
        return { ...result, provider, model };
      } catch (err) {
        lastErr = err;
        const isRateLimit = /429/.test(err.message);
        if (isRateLimit && attempt === 0) {
          await sleep(RATE_LIMIT_RETRY_DELAY_MS);
          continue;
        }
        console.warn(`[LLM] ${provider}/${model} failed: ${err.message}`);
        break;
      }
    }
  }
  throw lastErr;
}

/**
 * Parses JSON from LLM response — sanitizes first, retries with a stricter
 * prompt if it still fails.
 */
async function parseWithRetry(content, messages, responseSchema) {
  const sanitized = sanitizeJson(content);
  try {
    return JSON.parse(sanitized);
  } catch (firstErr) {
    console.warn("[LLM] JSON parse failed after sanitize:", firstErr.message);
    console.warn("[LLM] Sanitized content (first 500 chars):", sanitized.slice(0, 500));
    const strictMessages = [
      ...messages,
      { role: "assistant", content },
      { role: "user", content: "Your response was not valid JSON. Respond with ONLY a valid JSON object matching the schema. No markdown fences, no prose, no comments. Do not use special characters or escape sequences other than \\n \\t \\\" \\\\ inside strings." },
    ];
    const retry = await callWithFallback({ messages: strictMessages, responseSchema });
    return JSON.parse(sanitizeJson(retry.content));
  }
}

/**
 * Processes a batch of form fields through the LLM.
 * Splits into simple (batched) and complex (parallel) calls.
 * @param {object} params
 * @param {Array<object>} params.fields
 * @param {object} params.profile
 * @param {object} [params.jobContext]
 * @returns {Promise<{fills: Array, errors: Array, meta: object, debug: Array}>}
 */
export async function processFields({ fields, profile, jobContext }) {
  const simpleFields = [];
  const complexFields = [];

  for (const field of fields) {
    if (SIMPLE_TYPES.has(field.type) && field.type !== "textarea") {
      simpleFields.push(field);
    } else {
      complexFields.push(field);
    }
  }

  const fills = [];
  const errors = [];
  const debug = [];
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0 };
  let usedProvider = LLM_CONFIG.provider;
  let usedModel = LLM_CONFIG.model;

  // Batch simple fields into one call
  if (simpleFields.length > 0) {
    const startedAt = Date.now();
    const fieldIds = simpleFields.map((f) => f.id);
    try {
      const { system, user, schema } = buildFieldMapping(simpleFields, profile);
      const messages = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      const result = await callWithFallback({ messages, responseSchema: schema });
      usedProvider = result.provider;
      usedModel = result.model;
      const parsed = await parseWithRetry(result.content, messages, schema);

      if (parsed.fills) {
        fills.push(...parsed.fills);
      }
      if (result.usage) {
        totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
        totalUsage.completion_tokens += result.usage.completion_tokens || 0;
      }
      debug.push({
        stage: "simple-batch",
        fieldIds,
        provider: result.provider,
        model: result.model,
        systemPrompt: system,
        userPrompt: user,
        rawResponse: result.content,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      console.error("[LLM] Simple fields batch failed:", err.message);
      for (const f of simpleFields) {
        errors.push({ id: f.id, message: `LLM error: ${err.message}` });
      }
      debug.push({
        stage: "simple-batch",
        fieldIds,
        error: err.message,
        latencyMs: Date.now() - startedAt,
      });
    }
  }

  // Process complex fields in parallel with concurrency limit
  if (complexFields.length > 0) {
    const chunks = [];
    for (let i = 0; i < complexFields.length; i += MAX_CONCURRENT_COMPLEX) {
      chunks.push(complexFields.slice(i, i + MAX_CONCURRENT_COMPLEX));
    }

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (field) => {
          const startedAt = Date.now();
          const { system, user, schema } = buildFreetextAnswer(field, profile, jobContext);
          const messages = [
            { role: "system", content: system },
            { role: "user", content: user },
          ];
          const result = await callWithFallback({ messages, responseSchema: schema });
          usedProvider = result.provider;
          usedModel = result.model;
          const parsed = await parseWithRetry(result.content, messages, schema);
          if (result.usage) {
            totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
            totalUsage.completion_tokens += result.usage.completion_tokens || 0;
          }
          debug.push({
            stage: "complex-field",
            fieldIds: [field.id],
            provider: result.provider,
            model: result.model,
            systemPrompt: system,
            userPrompt: user,
            rawResponse: result.content,
            usage: result.usage,
            latencyMs: Date.now() - startedAt,
          });
          return parsed;
        })
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled" && r.value) {
          fills.push(r.value);
        } else {
          const err = r.reason || new Error("Unknown error");
          console.error(`[LLM] Complex field "${chunk[i].id}" failed:`, err.message);
          errors.push({ id: chunk[i].id, message: `LLM error: ${err.message}` });
          debug.push({
            stage: "complex-field",
            fieldIds: [chunk[i].id],
            error: err.message,
          });
        }
      }
    }
  }

  return {
    fills,
    errors: errors.length > 0 ? errors : undefined,
    meta: { provider: usedProvider, model: usedModel, usage: totalUsage },
    debug,
  };
}

/**
 * Extracts structured profile data (personal, experience, education, skills)
 * from raw resume text via the LLM.
 * @param {string} resumeText
 * @returns {Promise<{profile: object, debug: object}>}
 */
export async function parseResume(resumeText) {
  const startedAt = Date.now();
  const { system, user, schema } = buildResumeParse(resumeText);
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const result = await callWithFallback({ messages, responseSchema: schema });
  const parsed = await parseWithRetry(result.content, messages, schema);

  return {
    profile: parsed,
    debug: {
      stage: "resume-parse",
      provider: result.provider,
      model: result.model,
      systemPrompt: system,
      userPrompt: user,
      rawResponse: result.content,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    },
  };
}
