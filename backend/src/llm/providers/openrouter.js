/**
 * OpenRouter provider adapter.
 * Uses OpenAI-compatible chat completions endpoint.
 */

const BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Sends a chat completion request to OpenRouter.
 * @param {object} params
 * @param {string} params.model - Model identifier (e.g. "qwen/qwen3-14b")
 * @param {Array<{role: string, content: string}>} params.messages
 * @param {number} params.temperature
 * @param {number} params.maxTokens
 * @param {object} [params.responseSchema] - JSON schema for structured output
 * @returns {Promise<{content: string, usage: object}>}
 */
export async function complete({ model, messages, temperature, maxTokens, responseSchema }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to your .env file.");
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (responseSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "autoapply_response",
        strict: true,
        schema: responseSchema,
      },
    };
  }

  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://autoapply.dev",
      "X-Title": "AutoApply",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenRouter API error ${resp.status}: ${text || resp.statusText}`);
  }

  const data = await resp.json();
  const choice = data.choices?.[0];

  if (!choice?.message?.content) {
    throw new Error("OpenRouter returned empty response.");
  }

  return {
    content: choice.message.content,
    usage: data.usage || {},
  };
}
