/**
 * Background service worker for AutoApply.
 * Handles messaging between popup, options, and content scripts.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  switch (action) {
    case "getStatus":
      sendResponse({ ok: true });
      break;
    default:
      sendResponse({ error: `Unknown action: ${action}` });
  }

  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});
