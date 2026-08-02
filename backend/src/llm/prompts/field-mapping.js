/**
 * Builds the prompt for batch-mapping simple form fields to profile values.
 * Handles: text inputs, email, phone, dropdowns, radio buttons, short text.
 */

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    fills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          value: { type: "string" },
          confidence: { type: "number" },
          reasoning: { type: "string" },
        },
        required: ["id", "value", "confidence", "reasoning"],
        additionalProperties: false,
      },
    },
  },
  required: ["fills"],
  additionalProperties: false,
};

/**
 * @param {Array<object>} fields - Extracted form fields
 * @param {object} profile - User profile data
 * @returns {{ system: string, user: string, schema: object }}
 */
export function buildPrompt(fields, profile) {
  const system = `You are a job application assistant. Your task is to match form fields to values from the user's profile.

Rules:
- Only use facts from the provided profile. NEVER invent or guess information.
- If a field has no matching profile value, set value to "SKIP" and confidence to 0.0.
- For dropdown/radio fields with options, pick the BEST matching option from the provided list. If none match well, use "SKIP".
- Confidence is 0.0 to 1.0: 1.0 = exact match from profile, 0.7-0.9 = reasonable inference, below 0.6 = uncertain.
- Match the language of the field label in your response.
- Keep values concise and appropriate for the field type.
- Return ONLY a raw JSON object. No markdown fences, no prose before or after. No escape sequences other than \\n \\t \\r \\\\ \\" inside strings.`;

  const fieldsDesc = fields
    .map((f) => {
      let desc = `- id: "${f.id}", label: "${f.label}", type: ${f.type}`;
      if (f.options?.length) desc += `, options: [${f.options.map((o) => `"${o}"`).join(", ")}]`;
      if (f.placeholder) desc += `, placeholder: "${f.placeholder}"`;
      if (f.context) desc += `, context: "${f.context}"`;
      return desc;
    })
    .join("\n");

  const user = `## User Profile
${JSON.stringify(profile, null, 2)}

## Form Fields to Fill
${fieldsDesc}

Map each field to the best matching profile value. Return a JSON object with a "fills" array.`;

  return { system, user, schema: RESPONSE_SCHEMA };
}
