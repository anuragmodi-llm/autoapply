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
    // Different upstream pool (Nvidia, not Google) so a Google-side
    // rate limit on the primary doesn't take down the fallback too.
    model: "nvidia/nemotron-3-nano-30b-a3b:free",
  },
};
