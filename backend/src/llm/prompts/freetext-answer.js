/**
 * Builds the prompt for generating free-text answers (textarea, essay questions).
 * Each complex field gets its own LLM call for higher quality.
 */

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    value: { type: "string" },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["id", "value", "confidence", "reasoning"],
  additionalProperties: false,
};

/**
 * @param {object} field - Single form field
 * @param {object} profile - User profile data
 * @param {object} [jobContext] - Optional job context (title, company, description)
 * @returns {{ system: string, user: string, schema: object }}
 */
export function buildPrompt(field, profile, jobContext) {
  const system = `You are a job application assistant writing answers for form fields.

Rules:
- Write a 3-5 sentence answer that is professional, specific, and compelling.
- Only use facts from the provided profile. NEVER invent achievements, companies, skills, or experiences not in the profile.
- If the profile has a Q&A bank entry matching this question, use it as a starting point and adapt it to the specific job context.
- If the profile has no relevant information for this question, set value to "SKIP" and confidence to 0.0.
- Match the language of the field label.
- Confidence is 0.0 to 1.0: 1.0 = answer directly from Q&A bank, 0.7-0.9 = synthesized from profile, below 0.6 = mostly generic.
- Return valid JSON matching the schema exactly.`;

  let user = `## User Profile
${JSON.stringify(profile, null, 2)}

## Field to Answer
- id: "${field.id}"
- label: "${field.label}"
- type: ${field.type}`;

  if (field.placeholder) user += `\n- placeholder: "${field.placeholder}"`;
  if (field.context) user += `\n- context: "${field.context}"`;

  if (jobContext) {
    user += `\n\n## Job Context`;
    if (jobContext.jobTitle) user += `\n- Job Title: ${jobContext.jobTitle}`;
    if (jobContext.company) user += `\n- Company: ${jobContext.company}`;
    if (jobContext.description) user += `\n- Description: ${jobContext.description.slice(0, 1000)}`;
  }

  user += `\n\nWrite a compelling answer for this field based on the profile.`;

  return { system, user, schema: RESPONSE_SCHEMA };
}
