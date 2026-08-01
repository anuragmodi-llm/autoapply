/**
 * Together AI provider adapter.
 * Uses OpenAI-compatible chat completions endpoint.
 */

const BASE_URL = "https://api.together.xyz/v1";

/**
 * Sends a chat completion request to Together AI.
 * @param {object} params
 * @param {string} params.model
 * @param {Array<{role: string, content: string}>} params.messages
 * @param {number} params.temperature
 * @param {number} params.maxTokens
 * @param {object} [params.responseSchema] - JSON schema for structured output
 * @returns {Promise<{content: string, usage: object}>}
 */
export async function complete({ model, messages, temperature, maxTokens, responseSchema }) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error("TOGETHER_API_KEY is not set. Add it to your .env file.");
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
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Together AI API error ${resp.status}: ${text || resp.statusText}`);
  }

  const data = await resp.json();
  const choice = data.choices?.[0];

  if (!choice?.message?.content) {
    throw new Error("Together AI returned empty response.");
  }

  return {
    content: choice.message.content,
    usage: data.usage || {},
  };
}
