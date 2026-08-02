/**
 * Builds the prompt for extracting structured profile data from raw resume text.
 */

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    personal: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        location: { type: "string" },
        linkedin: { type: "string" },
        github: { type: "string" },
        portfolio: { type: "string" },
        company: { type: "string" },
        role: { type: "string" },
      },
      required: ["name", "email", "phone", "location", "linkedin", "github", "portfolio", "company", "role"],
      additionalProperties: false,
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          role: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string" },
          description: { type: "string" },
          achievements: { type: "array", items: { type: "string" } },
        },
        required: ["company", "role", "start_date", "end_date", "description", "achievements"],
        additionalProperties: false,
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          institution: { type: "string" },
          degree: { type: "string" },
          field: { type: "string" },
          start_year: { type: "string" },
          end_year: { type: "string" },
          gpa: { type: "string" },
        },
        required: ["institution", "degree", "field", "start_year", "end_year", "gpa"],
        additionalProperties: false,
      },
    },
    skills: {
      type: "object",
      properties: {
        technical: { type: "array", items: { type: "string" } },
        soft: { type: "array", items: { type: "string" } },
        tools: { type: "array", items: { type: "string" } },
        languages: { type: "array", items: { type: "string" } },
      },
      required: ["technical", "soft", "tools", "languages"],
      additionalProperties: false,
    },
  },
  required: ["personal", "experience", "education", "skills"],
  additionalProperties: false,
};

/**
 * @param {string} resumeText - Raw extracted resume text
 * @returns {{ system: string, user: string, schema: object }}
 */
export function buildPrompt(resumeText) {
  const system = `You are a resume parser. Extract structured profile data from the resume text below.

Rules:
- Only extract facts explicitly present in the resume. NEVER invent or guess information.
- Leave a field as an empty string ("") or empty array ([]) if not present in the resume.
- For "role" in personal info, use the most recent job title.
- Dates should be kept in whatever format the resume uses (e.g. "Jan 2022", "2022").
- Return ONLY a raw JSON object. No markdown fences, no prose before or after. No escape sequences other than \\n \\t \\r \\\\ \\" inside strings.`;

  const user = `## Resume Text
${resumeText}

Extract the candidate's personal info, work experience, education, and skills into the JSON schema.`;

  return { system, user, schema: RESPONSE_SCHEMA };
}
