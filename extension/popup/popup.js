/**
 * Popup controller.
 * Shows profile status, current tab info, usage counter, and triggers autofill.
 */

import { hasProfile } from "../lib/storage.js";
import * as log from "../lib/logger.js";

const $ = (sel) => document.querySelector(sel);

const SUPPORTED_PATTERNS = [
  /^https:\/\/[^/]*\.greenhouse\.io\//,
  /^https:\/\/jobs\.lever\.co\//,
  /^https:\/\/jobs\.ashbyhq\.com\//,
  /^https:\/\/[^/]*\.myworkdayjobs\.com\//,
];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("#btn-open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
  $("#btn-edit-profile").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
  $("#btn-view-logs").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("logs/logs.html") });
    window.close();
  });
  $("#btn-autofill").addEventListener("click", handleAutofill);

  try {
    const profileExists = await hasProfile();
    if (profileExists) {
      await showReady();
    } else {
      showState("setup");
    }
  } catch (err) {
    log.error("Failed to check profile:", err);
    showState("setup");
  }
}

function showState(state) {
  $("#state-setup").style.display = state === "setup" ? "block" : "none";
  $("#state-ready").style.display = state === "ready" ? "block" : "none";
}

async function showReady() {
  showState("ready");

  let url = "—";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) url = tab.url;
  } catch { /* ok */ }

  $("#current-url").textContent = url;

  const isSupported = SUPPORTED_PATTERNS.some((p) => p.test(url));
  $("#btn-autofill").disabled = !isSupported;
  $("#autofill-hint").textContent = isSupported
    ? "Ready to fill this application page."
    : "Navigate to a Greenhouse, Lever, Ashby, or Workday application page to use Autofill.";

  await updateUsageCounter();
}

async function updateUsageCounter() {
  try {
    const now = new Date();
    const monthKey = `usage_${now.getFullYear()}_${now.getMonth()}`;
    const data = await chrome.storage.local.get(monthKey);
    const count = data[monthKey] || 0;
    const monthName = now.toLocaleString("default", { month: "long" });
    $("#usage-counter").textContent = `${count} application${count !== 1 ? "s" : ""} autofilled in ${monthName}`;
  } catch {
    $("#usage-counter").textContent = "";
  }
}

async function incrementUsage() {
  try {
    const now = new Date();
    const monthKey = `usage_${now.getFullYear()}_${now.getMonth()}`;
    const data = await chrome.storage.local.get(monthKey);
    await chrome.storage.local.set({ [monthKey]: (data[monthKey] || 0) + 1 });
  } catch { /* ok */ }
}

async function handleAutofill() {
  const btn = $("#btn-autofill");
  btn.disabled = true;
  btn.textContent = "Filling...";
  $("#autofill-hint").textContent = "Working — check the overlay on the page.";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    // Inject content script programmatically in case declarative injection didn't fire
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content-script.js"],
      });
    } catch { /* already injected or no permission — ok, try sending anyway */ }

    const response = await chrome.tabs.sendMessage(tab.id, { action: "startAutofill" });
    if (response?.error) {
      $("#autofill-hint").textContent = `Error: ${response.error}`;
    } else {
      $("#autofill-hint").textContent = "Autofill started — see overlay on the page.";
      await incrementUsage();
      await updateUsageCounter();
    }
  } catch (err) {
    log.error("Autofill trigger failed:", err);
    $("#autofill-hint").textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Autofill This Page";
  }
}
