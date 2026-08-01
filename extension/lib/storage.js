/**
 * Profile storage layer using chrome.storage.local.
 * Profile is stored as plain JSON — Chrome's extension sandboxing
 * isolates the data from other extensions and websites.
 */

import * as log from "./logger.js";

const STORAGE_KEY = "autoapply_profile";

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
