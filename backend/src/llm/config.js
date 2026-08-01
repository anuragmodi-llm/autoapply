/**
 * Single source of truth for LLM model configuration.
 * Change LLM_PROVIDER and LLM_MODEL env vars to swap models.
 */

export const LLM_CONFIG = {
  provider: process.env.LLM_PROVIDER || "openrouter",
  model: process.env.LLM_MODEL || "qwen/qwen3-14b",
  temperature: 0.2,
  maxTokens: 1024,
  fallback: {
    provider: "openrouter",
    model: "microsoft/phi-4-mini-instruct",
  },
};
