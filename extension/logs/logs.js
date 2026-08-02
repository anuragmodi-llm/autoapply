/**
 * Performance Logs page — reads run history from chrome.storage.local
 * and renders a monitoring dashboard: what was sent to the AI, what came
 * back, latency, tokens, and which fields skipped the AI entirely.
 */

const RUN_LOGS_KEY = "autoapply_logs";

const $ = (sel) => document.querySelector(sel);

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("#btn-refresh").addEventListener("click", render);
  $("#btn-clear").addEventListener("click", handleClear);
  await render();
}

async function getLogs() {
  const result = await chrome.storage.local.get(RUN_LOGS_KEY);
  return result[RUN_LOGS_KEY] || [];
}

async function handleClear() {
  if (!confirm("Clear all performance logs? This cannot be undone.")) return;
  await chrome.storage.local.remove(RUN_LOGS_KEY);
  await render();
}

async function render() {
  const logs = await getLogs();
  renderStats(logs);
  renderRuns(logs);
}

function renderStats(logs) {
  let totalRuns = logs.length;
  let totalAiCalls = 0;
  let totalDirectFields = 0;
  let totalErrors = 0;
  let totalLatency = 0;
  let latencyCount = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let rateLimitErrors = 0;

  for (const run of logs) {
    for (const call of run.calls || []) {
      if (call.stage === "direct") {
        totalDirectFields += call.fieldIds?.length || 0;
        continue;
      }
      totalAiCalls++;
      if (call.error) {
        totalErrors++;
        if (/429/.test(call.error)) rateLimitErrors++;
      } else {
        if (typeof call.latencyMs === "number") { totalLatency += call.latencyMs; latencyCount++; }
        if (call.usage) {
          totalPromptTokens += call.usage.prompt_tokens || 0;
          totalCompletionTokens += call.usage.completion_tokens || 0;
        }
      }
    }
  }

  const successRate = totalAiCalls > 0 ? Math.round(((totalAiCalls - totalErrors) / totalAiCalls) * 100) : null;
  const avgLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null;

  const stats = [
    { label: "Total Runs", value: totalRuns },
    { label: "AI Calls Made", value: totalAiCalls, sub: `${totalDirectFields} fields skipped AI (direct-mapped)` },
    { label: "AI Success Rate", value: successRate !== null ? `${successRate}%` : "—", sub: totalErrors > 0 ? `${totalErrors} failed calls` : "" },
    { label: "Avg. AI Latency", value: avgLatency !== null ? `${(avgLatency / 1000).toFixed(1)}s` : "—" },
    { label: "Tokens Used", value: (totalPromptTokens + totalCompletionTokens).toLocaleString(), sub: `${totalPromptTokens.toLocaleString()} prompt / ${totalCompletionTokens.toLocaleString()} completion` },
    { label: "Rate-Limit Errors", value: rateLimitErrors, sub: rateLimitErrors > 0 ? "Free model was throttled" : "None" },
  ];

  $("#stats-grid").innerHTML = stats.map((s) => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${s.value}</div>
      ${s.sub ? `<div class="stat-sub">${s.sub}</div>` : ""}
    </div>
  `).join("");
}

function renderRuns(logs) {
  const container = $("#runs-list");

  if (logs.length === 0) {
    container.innerHTML = '<div class="empty-state">No autofill runs logged yet. Run Autofill on a job application page, then check back here.</div>';
    return;
  }

  container.innerHTML = logs.map((run, i) => `
    <div class="run-card" data-index="${i}">
      <div class="run-header" data-toggle="${i}">
        <div class="run-header-left">
          <span class="run-url" title="${esc(run.url)}">${esc(shortenUrl(run.url))}</span>
          <span class="run-meta">${new Date(run.timestamp).toLocaleString()} · ${run.adapter} · ${run.durationMs ? (run.durationMs / 1000).toFixed(1) + "s" : "—"}</span>
        </div>
        <div class="run-summary">
          ${run.totalFilled ? `<span class="pill pill-filled">${run.totalFilled} filled</span>` : ""}
          ${run.totalReview ? `<span class="pill pill-review">${run.totalReview} review</span>` : ""}
          ${run.totalErrors ? `<span class="pill pill-error">${run.totalErrors} errors</span>` : ""}
          ${run.totalSkipped ? `<span class="pill pill-skipped">${run.totalSkipped} skipped</span>` : ""}
        </div>
      </div>
      <div class="run-body" id="run-body-${i}">
        ${renderCalls(run.calls || [])}
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-toggle]").forEach((header) => {
    header.addEventListener("click", () => {
      const body = $(`#run-body-${header.dataset.toggle}`);
      body.classList.toggle("open");
    });
  });
}

function renderCalls(calls) {
  if (calls.length === 0) return '<div class="empty-state">No AI calls in this run — all fields were direct-mapped.</div>';

  return calls.map((call) => {
    const isDirect = call.stage === "direct";
    const isError = !!call.error;
    const stageClass = isDirect ? "direct" : isError ? "error" : "";
    const stageLabel = isDirect ? "Direct (no AI)" : call.stage === "simple-batch" ? "Simple Batch" : call.stage === "complex-field" ? "Freetext Answer" : call.stage;

    return `
      <div class="call-card">
        <div class="call-header">
          <span class="call-stage ${stageClass}">${stageLabel}</span>
          <span class="call-fields">${(call.fieldIds || []).join(", ")}</span>
          ${call.model ? `<span class="call-model">${call.model}</span>` : ""}
          ${typeof call.latencyMs === "number" && !isDirect ? `<span class="call-latency">${(call.latencyMs / 1000).toFixed(1)}s${call.usage ? ` · ${(call.usage.prompt_tokens || 0) + (call.usage.completion_tokens || 0)} tok` : ""}</span>` : ""}
        </div>
        ${isError ? `<div class="call-error">${esc(call.error)}</div>` : ""}
        ${call.systemPrompt ? `
          <details class="prompt-details">
            <summary>View prompt sent to AI</summary>
            <pre>${esc(call.systemPrompt)}\n\n---\n\n${esc(call.userPrompt || "")}</pre>
          </details>
        ` : ""}
        ${call.rawResponse ? `
          <details class="prompt-details">
            <summary>View raw AI response</summary>
            <pre>${esc(call.rawResponse)}</pre>
          </details>
        ` : ""}
      </div>
    `;
  }).join("");
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
