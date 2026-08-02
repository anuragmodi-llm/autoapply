/**
 * LLM router — reads config, loads the matching provider adapter,
 * splits fields into direct/simple/complex batches, and merges results.
 */

import { LLM_CONFIG } from "./config.js";
import { mapDirectFields } from "./direct-mapper.js";
import { buildPrompt as buildFieldMapping } from "./prompts/field-mapping.js";
import { buildPrompt as buildFreetextAnswer } from "./prompts/freetext-answer.js";
import { buildPrompt as buildResumeParse } from "./prompts/resume-parse.js";

const SIMPLE_TYPES = new Set(["text", "email", "tel", "url", "number", "select", "radio", "checkbox", "date"]);
const MAX_CONCURRENT_COMPLEX = 5;
const RATE_LIMIT_RETRY_DELAY_MS = 2000;

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
 * Parses JSON from LLM response, with one retry using a stricter prompt.
 */
async function parseWithRetry(content, messages, responseSchema) {
  try {
    return JSON.parse(content);
  } catch {
    console.warn("[LLM] JSON parse failed, retrying with strict prompt...");
    const strictMessages = [
      ...messages,
      { role: "assistant", content },
      { role: "user", content: "Your response was not valid JSON. Respond with ONLY valid JSON matching the schema, no prose or markdown." },
    ];
    const retry = await callWithFallback({ messages: strictMessages, responseSchema });
    return JSON.parse(retry.content);
  }
}

/**
 * Processes a batch of form fields.
 * Fixed personal fields are mapped directly from the profile with no LLM
 * call; everything else (dropdowns, radios, freetext) goes through the LLM.
 * @param {object} params
 * @param {Array<object>} params.fields
 * @param {object} params.profile
 * @param {object} [params.jobContext]
 * @returns {Promise<{fills: Array, errors: Array, meta: object, debug: Array}>}
 */
export async function processFields({ fields, profile, jobContext }) {
  const { directFills, remainingFields, debug: directDebug } = mapDirectFields(fields, profile);

  const simpleFields = [];
  const complexFields = [];

  for (const field of remainingFields) {
    if (SIMPLE_TYPES.has(field.type) && field.type !== "textarea") {
      simpleFields.push(field);
    } else {
      complexFields.push(field);
    }
  }

  const fills = [...directFills];
  const errors = [];
  const debug = [...directDebug];
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
