/**
 * Profile storage layer using chrome.storage.local.
 * Profile is stored as plain JSON — Chrome's extension sandboxing
 * isolates the data from other extensions and websites.
 */

import * as log from "./logger.js";

const STORAGE_KEY = "autoapply_profile";
const RESUME_KEY = "autoapply_resume_file";
const FIELD_RULES_KEY = "autoapply_field_rules";

/**
 * Default direct-mapping rules: form fields matching these keywords are
 * filled straight from the profile with no AI call. Editable from the
 * options page — add a rule here (or in the UI) any time and it takes
 * effect on the very next autofill run, no extension reload or backend
 * deploy needed.
 */
export const DEFAULT_FIELD_RULES = [
  { keywords: "first name, given name", profileField: "personal.name", transform: "firstName" },
  { keywords: "last name, surname, family name", profileField: "personal.name", transform: "lastName" },
  { keywords: "full name, your name, candidate name, applicant name", profileField: "personal.name" },
  { keywords: "email", profileField: "personal.email" },
  { keywords: "phone, mobile, contact number, telephone", profileField: "personal.phone" },
  { keywords: "linkedin", profileField: "personal.linkedin" },
  { keywords: "github", profileField: "personal.github" },
  { keywords: "portfolio, personal website, personal site", profileField: "personal.portfolio" },
  { keywords: "current company, employer name, current employer", profileField: "personal.company" },
  { keywords: "current title, current role, current position, job title", profileField: "personal.role" },
  { keywords: "notice period", profileField: "personal.notice_period" },
  { keywords: "current ctc, current salary, current compensation", profileField: "personal.current_ctc" },
  { keywords: "expected ctc, expected salary, desired salary", profileField: "personal.expected_ctc" },
  { keywords: "location, city, current location, based in, address", profileField: "personal.location" },
];

/**
 * Saves the user profile to local storage.
 * @param {object} profile
 */
export async function saveProfile(profile) {
  await chrome.storage.local.set({ [STORAGE_KEY]: profile });
  log.info("Profile saved.");
}

/**
 * Retrieves the user profile from local storage.
 * @returns {Promise<object|null>} The profile, or null if none exists
 */
export async function getProfile() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

/**
 * Checks whether a profile exists in storage.
 * @returns {Promise<boolean>}
 */
export async function hasProfile() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return !!result[STORAGE_KEY];
}

/**
 * Deletes the profile from storage.
 */
export async function clearProfile() {
  await chrome.storage.local.remove(STORAGE_KEY);
  log.info("Profile cleared.");
}

/**
 * Saves the resume file (as a data URL) for later parsing and auto-attach
 * on file-upload form fields.
 * @param {{ name: string, mimeType: string, dataUrl: string }} file
 */
export async function saveResumeFile(file) {
  await chrome.storage.local.set({ [RESUME_KEY]: { ...file, uploadedAt: Date.now() } });
  log.info("Resume file saved:", file.name);
}

/**
 * Retrieves the stored resume file.
 * @returns {Promise<object|null>}
 */
export async function getResumeFile() {
  const result = await chrome.storage.local.get(RESUME_KEY);
  return result[RESUME_KEY] || null;
}

/**
 * Deletes the stored resume file.
 */
export async function clearResumeFile() {
  await chrome.storage.local.remove(RESUME_KEY);
  log.info("Resume file cleared.");
}

/**
 * Retrieves the direct-mapping field rules, seeding defaults on first use.
 * @returns {Promise<Array<{keywords: string, profileField: string, transform?: string}>>}
 */
export async function getFieldRules() {
  const result = await chrome.storage.local.get(FIELD_RULES_KEY);
  return result[FIELD_RULES_KEY] || DEFAULT_FIELD_RULES;
}

/**
 * Saves the direct-mapping field rules.
 * @param {Array<{keywords: string, profileField: string, transform?: string}>} rules
 */
export async function saveFieldRules(rules) {
  await chrome.storage.local.set({ [FIELD_RULES_KEY]: rules });
  log.info("Field mapping rules saved:", rules.length);
}
