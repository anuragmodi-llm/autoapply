/**
 * Deterministic field mapper — fills fixed personal fields (name, email,
 * phone, etc.) straight from the profile with zero LLM calls.
 * Only plain text/email/tel/url fields without an options list qualify;
 * dropdowns, radios, checkboxes, and freetext always need LLM judgment.
 */

const DIRECT_TYPES = new Set(["text", "email", "tel", "url"]);

const PATTERNS = [
  { keys: ["first name", "given name"], get: (p) => firstName(p.personal?.name) },
  { keys: ["last name", "surname", "family name"], get: (p) => lastName(p.personal?.name) },
  { keys: ["full name", "your name", "candidate name", "applicant name"], get: (p) => p.personal?.name },
  { keys: ["email"], get: (p) => p.personal?.email },
  { keys: ["phone", "mobile", "contact number", "telephone"], get: (p) => p.personal?.phone },
  { keys: ["linkedin"], get: (p) => p.personal?.linkedin },
  { keys: ["github"], get: (p) => p.personal?.github },
  { keys: ["portfolio", "personal website", "personal site"], get: (p) => p.personal?.portfolio },
  { keys: ["current company", "employer name", "current employer"], get: (p) => p.personal?.company },
  { keys: ["current title", "current role", "current position", "job title"], get: (p) => p.personal?.role },
  { keys: ["notice period"], get: (p) => p.personal?.notice_period },
  { keys: ["current ctc", "current salary", "current compensation"], get: (p) => p.personal?.current_ctc },
  { keys: ["expected ctc", "expected salary", "desired salary"], get: (p) => p.personal?.expected_ctc },
  { keys: ["location", "city", "current location", "based in", "address"], get: (p) => p.personal?.location },
];

function firstName(name) {
  if (!name) return "";
  return name.trim().split(/\s+/)[0] || "";
}

function lastName(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

function normalizeLabel(label) {
  return (label || "")
    .toLowerCase()
    .replace(/[*:]/g, "")
    .replace(/\(optional\)/g, "")
    .trim();
}

/**
 * Splits fields into direct fills (no LLM) and fields still needing the LLM.
 * @param {Array<object>} fields
 * @param {object} profile
 * @returns {{ directFills: Array, remainingFields: Array, debug: Array }}
 */
export function mapDirectFields(fields, profile) {
  const directFills = [];
  const remainingFields = [];
  const debug = [];

  for (const field of fields) {
    if (!DIRECT_TYPES.has(field.type) || field.options?.length) {
      remainingFields.push(field);
      continue;
    }

    const label = normalizeLabel(field.label);
    const pattern = PATTERNS.find((p) => p.keys.some((k) => label.includes(k)));

    if (!pattern) {
      remainingFields.push(field);
      continue;
    }

    const value = pattern.get(profile);
    if (!value) {
      remainingFields.push(field);
      continue;
    }

    directFills.push({
      id: field.id,
      value,
      confidence: 1.0,
      reasoning: "Directly mapped from profile — no AI call needed.",
    });
    debug.push({
      stage: "direct",
      fieldIds: [field.id],
      provider: null,
      model: null,
      latencyMs: 0,
    });
  }

  return { directFills, remainingFields, debug };
}
