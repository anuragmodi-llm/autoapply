/**
 * Single source of truth for LLM model configuration.
 * Change LLM_PROVIDER and LLM_MODEL env vars to swap models.
 */

export const LLM_CONFIG = {
  provider: process.env.LLM_PROVIDER || "openrouter",
  model: process.env.LLM_MODEL || "google/gemma-4-26b-a4b-it:free",
  temperature: 0.2,
  maxTokens: 1024,
  fallback: {
    provider: "openrouter",
    model: "google/gemma-4-31b-it:free",
  },
};
