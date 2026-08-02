/**
 * Content script — self-contained autofill orchestrator.
 * Bundled as IIFE since Chrome MV3 content scripts can't use ES module imports.
 * Handles: Greenhouse, Lever, generic forms.
 * Edge cases: React inputs, custom dropdowns, iframes, dynamic fields,
 * validation errors, multi-page forms, rate limiting, offline detection.
 */

(function () {
  "use strict";

  const LOG_PREFIX = "[AutoApply]";
  const BACKEND_URL = "https://autoapply-beryl.vercel.app";
  const OVERLAY_ID = "autoapply-overlay";
  const MAX_DYNAMIC_ROUNDS = 3;
  const MAX_BACKOFF_RETRIES = 3;
  const MAX_RUN_LOGS = 30;
  const RUN_LOGS_KEY = "autoapply_logs";

  let fillInProgress = false;
  let abortController = null;

  /* ========== Logger ========== */

  const log = {
    info: (...args) => console.info(LOG_PREFIX, ...args),
    warn: (...args) => console.warn(LOG_PREFIX, ...args),
    error: (...args) => console.error(LOG_PREFIX, ...args),
  };

  /* ========== Generic Adapter ========== */

  const genericAdapter = {
    name: "generic",
    selectors: { form: "form", field: "input, textarea, select" },
    matches() { return true; },
    getLabel(el) {
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return cleanLabel(l); }
      if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
      const by = el.getAttribute("aria-labelledby");
      if (by) { const t = by.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" "); if (t) return t; }
      const pl = el.closest("label");
      if (pl) return cleanLabel(pl);
      const fs = el.closest("fieldset");
      if (fs?.querySelector("legend")) return fs.querySelector("legend").textContent.trim();
      if (el.placeholder) return el.placeholder;
      return "";
    },
    getContext(el) {
      const p = [];
      const fs = el.closest("fieldset");
      if (fs?.querySelector("legend")) p.push(fs.querySelector("legend").textContent.trim());
      const s = el.closest("section, [role='group'], .section, .field-group");
      if (s) { const h = s.querySelector("h1,h2,h3,h4,h5,h6"); if (h) p.push(h.textContent.trim()); }
      return p.join(" > ");
    },
    getFieldType(el) {
      const tag = el.tagName.toLowerCase();
      if (tag === "textarea") return "textarea";
      if (tag === "select") return "select";
      if (el.getAttribute("role") === "combobox") return "select";
      if (tag === "input") return (el.getAttribute("type") || "text").toLowerCase();
      if (el.getAttribute("contenteditable") === "true") return "richtext";
      return "text";
    },
    getOptions(el) {
      if (el.tagName.toLowerCase() === "select") return Array.from(el.options).filter(o => o.value && !o.disabled).map(o => o.textContent.trim());
      if (el.getAttribute("role") === "combobox") {
        const listboxId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
        if (listboxId) { const lb = document.getElementById(listboxId); if (lb) return Array.from(lb.querySelectorAll("[role='option']")).map(o => o.textContent.trim()).filter(Boolean); }
      }
      if (el.type === "radio" && el.name) return Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)).map(r => this.getLabel(r) || r.value);
      return [];
    },
    getStableSelector(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.name) { const t = el.tagName.toLowerCase(), ty = el.getAttribute("type") || ""; return `${t}[name="${CSS.escape(el.name)}"]${ty ? `[type="${ty}"]` : ""}`; }
      const path = []; let cur = el;
      while (cur && cur !== document.body) {
        let s = cur.tagName.toLowerCase();
        if (cur.id) { path.unshift(`#${CSS.escape(cur.id)}`); break; }
        const par = cur.parentElement;
        if (par) { const sibs = Array.from(par.children).filter(c => c.tagName === cur.tagName); if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(cur) + 1})`; }
        path.unshift(s); cur = cur.parentElement;
      }
      return path.join(" > ");
    },
  };

  /* ========== Greenhouse Adapter ========== */

  const greenhouseAdapter = {
    ...genericAdapter, name: "greenhouse",
    selectors: {
      form: "#application_form, .application-form, #main_fields, form",
      field: "form input, form textarea, form select, form [role='combobox'], #application_form input, #application_form textarea, #application_form select, .application-form input, .application-form textarea, .application-form select",
    },
    matches() { return location.hostname.includes("greenhouse.io") || !!document.querySelector("#application_form, .application-form"); },
    getLabel(el) {
      const w = el.closest(".field, .form-field, .application-field");
      if (w) { const l = w.querySelector("label"); if (l) { const t = cleanLabel(l); if (t) return t; } }
      return genericAdapter.getLabel(el);
    },
    getContext(el) {
      const p = [];
      const s = el.closest(".section, .education-section, .custom-fields-section");
      if (s) { const h = s.querySelector("h2,h3,.section-header"); if (h) p.push(h.textContent.trim()); }
      const g = genericAdapter.getContext(el); if (g) p.push(g);
      return p.join(" > ");
    },
  };

  /* ========== Lever Adapter ========== */

  const leverAdapter = {
    ...genericAdapter, name: "lever",
    selectors: {
      form: ".application-form, .posting-page form",
      field: ".application-form input, .application-form textarea, .application-form select, .application-question input, .application-question textarea, .application-question select, [data-qa] input, [data-qa] textarea, [data-qa] select",
    },
    matches() { return location.hostname.includes("lever.co") || !!document.querySelector(".application-form .application-question"); },
    getLabel(el) {
      const w = el.closest(".application-question, .custom-question");
      if (w) { const l = w.querySelector(".application-label, label, .question-label"); if (l) { const t = cleanLabel(l); if (t) return t; } }
      return genericAdapter.getLabel(el);
    },
    getContext(el) {
      const p = [];
      const s = el.closest(".section-wrapper, .posting-section");
      if (s) { const h = s.querySelector("h3,.section-title"); if (h) p.push(h.textContent.trim()); }
      const g = genericAdapter.getContext(el); if (g) p.push(g);
      return p.join(" > ");
    },
  };

  /* ========== Helpers ========== */

  function cleanLabel(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll("input, textarea, select, .required-field, .required").forEach(x => x.remove());
    return c.textContent.trim();
  }

  function detectAdapter() {
    if (greenhouseAdapter.matches()) return greenhouseAdapter;
    if (leverAdapter.matches()) return leverAdapter;
    return genericAdapter;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ========== DOM Extractor ========== */

  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

  function extractFields(adapter, alreadyFilled) {
    const seen = new Set(alreadyFilled || []);
    const fields = [];
    const elements = document.querySelectorAll(adapter.selectors.field);

    for (const el of elements) {
      const type = adapter.getFieldType(el);
      if (SKIP_TYPES.has(type)) continue;
      if (el.disabled || el.readOnly) continue;
      if (el.offsetParent === null && type !== "hidden") continue;
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (el.tabIndex === -1 && !el.id && !el.name) continue;

      if (type === "radio") { const k = `radio:${el.name}`; if (seen.has(k)) continue; seen.add(k); }
      const id = adapter.getStableSelector(el);
      if (seen.has(id)) continue;
      seen.add(id);

      const label = adapter.getLabel(el);
      if (!label && type !== "checkbox") continue;

      const field = { id, label, type, placeholder: el.placeholder || "", context: adapter.getContext(el) };
      const options = adapter.getOptions(el);
      if (options.length > 0) field.options = options;
      if (el.maxLength > 0) field.maxLength = el.maxLength;
      fields.push(field);
    }
    return fields;
  }

  function waitForDynamicFields(ms = 2000) {
    return new Promise(resolve => {
      let timer = null;
      const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => { obs.disconnect(); resolve(); }, 500); });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(); }, ms);
    });
  }

  /* ========== Field Filler ========== */

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function typeText(el, text, minD = 30, maxD = 80) {
    el.focus();
    el.dispatchEvent(new Event("focus", { bubbles: true }));
    setNativeValue(el, "");
    for (let i = 0; i < text.length; i++) {
      setNativeValue(el, text.slice(0, i + 1));
      await sleep(minD + Math.random() * (maxD - minD));
    }
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function fillField(selector, value, fieldType, resumeFile) {
    if (value === "SKIP") return { status: "skipped", message: "No matching profile value" };
    const el = document.querySelector(selector);
    if (!el) return { status: "error", message: `Element not found: ${selector}` };
    try {
      switch (fieldType) {
        case "file": return await fillFileInput(el, resumeFile);
        case "select": return el.tagName.toLowerCase() === "select" ? fillNativeSelect(el, value) : await fillCustomDropdown(el, value);
        case "radio": return fillRadio(el, value);
        case "checkbox": return fillCheckbox(el, value);
        case "textarea": await typeText(el, value, 10, 30); return { status: "filled" };
        case "richtext":
          el.focus(); el.innerHTML = "";
          document.execCommand("insertText", false, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return { status: "filled" };
        default: await typeText(el, value, 30, 80); return { status: "filled" };
      }
    } catch (err) { return { status: "error", message: err.message }; }
  }

  async function fillFileInput(el, resumeFile) {
    if (!resumeFile) return { status: "skipped", message: "No resume on file — attach manually or upload one in options" };
    try {
      const resp = await fetch(resumeFile.dataUrl);
      const blob = await resp.blob();
      const file = new File([blob], resumeFile.name, { type: resumeFile.mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { status: "filled", message: `Attached: ${resumeFile.name}` };
    } catch (err) {
      return { status: "error", message: `Failed to attach resume: ${err.message}` };
    }
  }

  function fillNativeSelect(el, value) {
    const lower = value.toLowerCase();
    const exact = Array.from(el.options).find(o => o.textContent.trim().toLowerCase() === lower);
    if (exact) { el.value = exact.value; el.dispatchEvent(new Event("change", { bubbles: true })); return { status: "filled" }; }
    const fuzzy = Array.from(el.options).filter(o => o.value && !o.disabled).find(o => o.textContent.trim().toLowerCase().includes(lower) || lower.includes(o.textContent.trim().toLowerCase()));
    if (fuzzy) { el.value = fuzzy.value; el.dispatchEvent(new Event("change", { bubbles: true })); return { status: "filled", message: `Matched: "${fuzzy.textContent.trim()}"` }; }
    const neutral = Array.from(el.options).find(o => /prefer not|rather not|n\/a|not applicable/i.test(o.textContent));
    if (neutral) { el.value = neutral.value; el.dispatchEvent(new Event("change", { bubbles: true })); return { status: "review", message: `No match — selected: "${neutral.textContent.trim()}"` }; }
    return { status: "review", message: "No matching dropdown option" };
  }

  async function fillCustomDropdown(el, value) {
    // Click to open the custom dropdown
    el.click();
    await sleep(300);

    // Look for an options panel that appeared
    const lower = value.toLowerCase();
    const optionSelectors = [
      "[role='option']", "[role='listbox'] li", ".select-option",
      ".dropdown-option", "[class*='option']", "li[data-value]",
    ];

    for (const sel of optionSelectors) {
      const options = document.querySelectorAll(sel);
      if (options.length === 0) continue;
      for (const opt of options) {
        if (opt.textContent.trim().toLowerCase().includes(lower)) {
          opt.click();
          await sleep(100);
          return { status: "filled", message: `Custom dropdown: "${opt.textContent.trim()}"` };
        }
      }
    }

    // Try typing into it (combobox)
    if (el.tagName.toLowerCase() === "input") {
      await typeText(el, value, 50, 100);
      await sleep(500);
      const suggestion = document.querySelector("[role='option'][aria-selected='true'], [role='option']:first-child, .suggestion:first-child");
      if (suggestion) {
        suggestion.click();
        await sleep(100);
        return { status: "filled", message: "Selected from typeahead" };
      }
    }

    // Close by pressing Escape
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { status: "review", message: "Custom dropdown — no matching option" };
  }

  function fillRadio(el, value) {
    if (!el.name) return { status: "error", message: "Radio without name" };
    const lower = value.toLowerCase();
    const radios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
    for (const r of radios) {
      const label = r.closest("label")?.textContent?.trim() || document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent?.trim() || r.value;
      if (label.toLowerCase() === lower || label.toLowerCase().includes(lower)) {
        r.click(); r.dispatchEvent(new Event("change", { bubbles: true })); return { status: "filled" };
      }
    }
    return { status: "review", message: "No matching radio option" };
  }

  function fillCheckbox(el, value) {
    const should = /^(true|yes|1|on|checked)$/i.test(String(value));
    if (el.checked !== should) el.click();
    return { status: "filled" };
  }

  /* ========== Validation Error Scanner ========== */

  function scanValidationErrors() {
    const errors = [];
    const errorEls = document.querySelectorAll(".error, .field-error, [aria-invalid='true'], .has-error, .invalid-feedback:not(:empty)");
    for (const el of errorEls) {
      const text = el.textContent.trim();
      if (!text) continue;
      const field = el.closest(".field, .form-field, .application-question, .application-field");
      const label = field?.querySelector("label")?.textContent?.trim() || "Unknown field";
      errors.push({ label, message: text });
    }
    return errors;
  }

  /* ========== Overlay ========== */

  const STATUS_ICONS = { pending: "⏳", filling: "✍️", filled: "✅", skipped: "⏭️", review: "⚠️", error: "❌" };
  const STATUS_COLORS = { pending: "#6b7280", filling: "#2563eb", filled: "#16a34a", skipped: "#9ca3af", review: "#d97706", error: "#ef4444" };

  function createOverlay() {
    let ov = document.getElementById(OVERLAY_ID);
    if (ov) ov.remove();
    ov = document.createElement("div");
    ov.id = OVERLAY_ID;
    ov.innerHTML = `<style>
      #${OVERLAY_ID}{position:fixed;top:16px;right:16px;width:320px;max-height:80vh;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#1f2937;z-index:2147483647;overflow:hidden;display:flex;flex-direction:column}
      #${OVERLAY_ID} *{box-sizing:border-box;margin:0;padding:0}
      .aa-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e5e7eb;background:#f9fafb}
      .aa-title{font-weight:700;font-size:14px}.aa-sts{font-size:12px;color:#6b7280;margin-top:2px}
      .aa-close{background:none;border:none;cursor:pointer;font-size:18px;color:#9ca3af;padding:2px 6px;border-radius:4px}
      .aa-close:hover{background:#f3f4f6;color:#374151}
      .aa-fields{overflow-y:auto;max-height:calc(80vh - 90px);padding:8px 0}
      .aa-f{display:flex;align-items:center;gap:8px;padding:6px 16px;transition:background .15s}
      .aa-f:hover{background:#f9fafb}
      .aa-fi{font-size:14px;flex-shrink:0;width:20px;text-align:center}
      .aa-fn{flex:1;min-width:0}
      .aa-fl{font-size:12px;font-weight:600;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .aa-fm{font-size:11px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .aa-fb{font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid #d1d5db;background:#fff;color:#374151;cursor:pointer;font-family:inherit;flex-shrink:0}
      .aa-fb:hover{background:#f3f4f6}
      .aa-ft{padding:8px 16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center}
    </style>
    <div class="aa-hdr"><div><div class="aa-title">AutoApply</div><div class="aa-sts" id="aa-sts">Starting...</div></div><button class="aa-close" id="aa-close">&times;</button></div>
    <div class="aa-fields" id="aa-fields"></div>
    <div class="aa-ft">Fields are pre-filled — review before submitting</div>`;
    document.body.appendChild(ov);
    ov.querySelector("#aa-close").addEventListener("click", () => ov.style.display = "none");
    return ov;
  }

  function setOverlayStatus(text) {
    const el = document.querySelector(`#${OVERLAY_ID} #aa-sts`);
    if (el) el.textContent = text;
  }

  function updateFieldUI(fieldId, label, status, message) {
    const c = document.querySelector(`#${OVERLAY_ID} #aa-fields`);
    if (!c) return;
    let row = c.querySelector(`[data-fid="${CSS.escape(fieldId)}"]`);
    if (!row) { row = document.createElement("div"); row.className = "aa-f"; row.dataset.fid = fieldId; c.appendChild(row); }
    row.innerHTML = `<span class="aa-fi" style="color:${STATUS_COLORS[status] || "#6b7280"}">${STATUS_ICONS[status] || STATUS_ICONS.pending}</span><div class="aa-fn"><div class="aa-fl" title="${label}">${label}</div>${message ? `<div class="aa-fm" title="${message}">${message}</div>` : ""}</div>${status === "review" || status === "error" ? `<button class="aa-fb" data-sel="${fieldId}">Review</button>` : ""}`;
    const btn = row.querySelector(".aa-fb");
    if (btn) btn.addEventListener("click", () => { try { const t = document.querySelector(fieldId); if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); t.focus(); t.style.outline = "3px solid #d97706"; setTimeout(() => t.style.outline = "", 3000); } } catch {} });
  }

  /* ========== API Client with Backoff ========== */

  async function requestFill(payload, signal) {
    let lastErr;
    for (let attempt = 0; attempt < MAX_BACKOFF_RETRIES; attempt++) {
      try {
        const resp = await fetch(`${BACKEND_URL}/api/fill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });
        if (resp.status === 429) {
          const wait = [2000, 5000, 15000][attempt] || 15000;
          log.warn(`Rate limited. Waiting ${wait / 1000}s...`);
          setOverlayStatus(`Rate limited — retrying in ${wait / 1000}s...`);
          await sleep(wait);
          continue;
        }
        if (!resp.ok) { const t = await resp.text().catch(() => ""); throw new Error(`Backend error ${resp.status}: ${t || resp.statusText}`); }
        return resp.json();
      } catch (err) {
        lastErr = err;
        if (err.name === "AbortError") throw new Error("Request cancelled.");
        if (attempt < MAX_BACKOFF_RETRIES - 1) { log.warn(`Retry ${attempt + 1}:`, err.message); continue; }
      }
    }
    throw lastErr || new Error("Request failed after retries.");
  }

  /* ========== Run Log Persistence (for the Performance Logs page) ========== */

  async function saveRunLog(entry) {
    const result = await chrome.storage.local.get(RUN_LOGS_KEY);
    const logs = result[RUN_LOGS_KEY] || [];
    logs.unshift(entry);
    if (logs.length > MAX_RUN_LOGS) logs.length = MAX_RUN_LOGS;
    await chrome.storage.local.set({ [RUN_LOGS_KEY]: logs });
  }

  /* ========== Job Context Extraction ========== */

  function extractJobContext() {
    const ctx = {};
    const title = document.querySelector("h1, .job-title, .posting-headline h2, #header .app-title");
    if (title) ctx.jobTitle = title.textContent.trim();
    const co = document.querySelector(".company-name, .posting-categories .sort-by-time, [data-company]") || document.querySelector('meta[property="og:site_name"]');
    if (co) ctx.company = co.content || co.textContent?.trim();
    const desc = document.querySelector("#content .section-wrapper, .posting-page .section-wrapper, .job-description, #job_description");
    if (desc) ctx.description = desc.textContent.trim().slice(0, 2000);
    return ctx;
  }

  /* ========== Main Autofill Flow ========== */

  async function runAutofill() {
    if (fillInProgress) { log.warn("Fill already in progress."); return; }
    fillInProgress = true;
    abortController = new AbortController();
    createOverlay();
    setOverlayStatus("Detecting form fields...");

    try {
      if (!navigator.onLine) throw new Error("You're offline — connect to the internet and try again.");

      const result = await chrome.storage.local.get(["autoapply_profile", "autoapply_resume_file"]);
      const profile = result.autoapply_profile;
      if (!profile) throw new Error("Profile not found. Set up your profile in the extension options.");
      const resumeFile = result.autoapply_resume_file || null;

      const trimmedProfile = { ...profile };
      if (trimmedProfile.experience?.length > 5) trimmedProfile.experience = trimmedProfile.experience.slice(0, 5);

      await waitForDynamicFields(2000);
      const adapter = detectAdapter();
      log.info(`Adapter: ${adapter.name}`);

      // Track all field IDs already attempted (filled OR errored) across dynamic rounds
      const allFilledIds = new Set();
      let totalFilled = 0, totalSkipped = 0, totalReview = 0, totalErrors = 0;
      const runDebugCalls = [];
      const runStartedAt = Date.now();

      for (let round = 0; round < MAX_DYNAMIC_ROUNDS; round++) {
        const fields = extractFields(adapter, allFilledIds);
        if (fields.length === 0) {
          if (round === 0) throw new Error("No fillable form fields found on this page.");
          break;
        }

        if (round > 0) {
          log.info(`Dynamic round ${round + 1}: found ${fields.length} new fields`);
          setOverlayStatus(`Found ${fields.length} new fields (round ${round + 1})...`);
        } else {
          setOverlayStatus(`Found ${fields.length} fields. Calling AI...`);
        }

        for (const f of fields) updateFieldUI(f.id, f.label, "pending");

        // File inputs (resume/cover letter attach) never need the LLM —
        // handle them locally so we don't waste an AI call on an "Attach" button.
        const fileFields = fields.filter((f) => f.type === "file");
        const llmFields = fields.filter((f) => f.type !== "file");

        for (const f of fileFields) {
          allFilledIds.add(f.id);
          updateFieldUI(f.id, f.label, "filling");
          const res = await fillField(f.id, "ATTACH", "file", resumeFile);
          if (res.status === "filled") { updateFieldUI(f.id, f.label, "filled", res.message); totalFilled++; }
          else if (res.status === "skipped") { updateFieldUI(f.id, f.label, "skipped", res.message); totalSkipped++; }
          else { updateFieldUI(f.id, f.label, "error", res.message); totalErrors++; }
        }

        if (llmFields.length === 0) {
          if (round < MAX_DYNAMIC_ROUNDS - 1) { await sleep(500); const newFields = extractFields(adapter, allFilledIds); if (newFields.length === 0) break; }
          continue;
        }

        const jobContext = extractJobContext();
        const apiResult = await requestFill(
          { fields: llmFields, profile: trimmedProfile, jobContext },
          abortController.signal
        );

        if (!apiResult?.fills) throw new Error("Backend returned invalid response.");

        if (apiResult.debug) runDebugCalls.push(...apiResult.debug);

        const errorMap = new Map();
        if (apiResult.errors) for (const e of apiResult.errors) errorMap.set(e.id, e.message);

        setOverlayStatus("Filling fields...");

        for (const fill of apiResult.fills) {
          if (abortController.signal.aborted) break;
          allFilledIds.add(fill.id);

          if (errorMap.has(fill.id)) {
            updateFieldUI(fill.id, fill.id, "error", errorMap.get(fill.id));
            totalErrors++; continue;
          }

          const field = fields.find(f => f.id === fill.id);
          const label = field?.label || fill.id;
          updateFieldUI(fill.id, label, "filling");

          let value = fill.value;
          if (field?.maxLength && value !== "SKIP" && value.length > field.maxLength - 10) {
            value = value.slice(0, field.maxLength - 10) + "...";
          }

          const res = await fillField(fill.id, value, field?.type || "text", resumeFile);

          if (res.status === "filled" && fill.confidence < 0.6) {
            updateFieldUI(fill.id, label, "review", `Low confidence (${Math.round(fill.confidence * 100)}%)`);
            highlightField(fill.id); totalReview++;
          } else if (res.status === "filled") { updateFieldUI(fill.id, label, "filled", res.message); totalFilled++; }
          else if (res.status === "skipped") { updateFieldUI(fill.id, label, "skipped", res.message); totalSkipped++; }
          else if (res.status === "review") { updateFieldUI(fill.id, label, "review", res.message); totalReview++; }
          else { updateFieldUI(fill.id, label, "error", res.message); totalErrors++; }
        }

        // Fields that errored out at the LLM level never got a "fill" entry —
        // mark them as attempted too, or they'd be re-sent to the LLM every
        // dynamic round and keep hammering a rate-limited model.
        for (const [id, msg] of errorMap) {
          allFilledIds.add(id);
          if (!apiResult.fills.some(f => f.id === id)) {
            updateFieldUI(id, id, "error", msg); totalErrors++;
          }
        }

        // Wait and check for dynamically added fields
        if (round < MAX_DYNAMIC_ROUNDS - 1) {
          await sleep(500);
          const newFields = extractFields(adapter, allFilledIds);
          if (newFields.length === 0) break;
        }
      }

      // Scan for validation errors after fill
      await sleep(500);
      const validationErrors = scanValidationErrors();
      if (validationErrors.length > 0) {
        for (const ve of validationErrors) {
          log.warn(`Validation error on "${ve.label}": ${ve.message}`);
          updateFieldUI(`ve-${ve.label}`, ve.label, "error", `Validation: ${ve.message}`);
          totalErrors++;
        }
      }

      setOverlayStatus(`Done: ${totalFilled} filled, ${totalSkipped} skipped, ${totalReview} review, ${totalErrors} errors`);

      try {
        await saveRunLog({
          timestamp: runStartedAt,
          url: window.location.href,
          adapter: adapter.name,
          totalFilled, totalSkipped, totalReview, totalErrors,
          durationMs: Date.now() - runStartedAt,
          calls: runDebugCalls,
        });
      } catch (logErr) {
        log.warn("Failed to save run log:", logErr.message);
      }

      // Multi-page form detection
      const nextBtn = document.querySelector(
        'button:not([type="submit"]):not([name="commit"])'
      );
      const allBtns = document.querySelectorAll("button, input[type='button'], a.btn");
      for (const btn of allBtns) {
        const text = btn.textContent.trim().toLowerCase();
        if ((text === "next" || text === "continue" || text.includes("next step")) && !text.includes("submit")) {
          setOverlayStatus(`Page filled! Click "${btn.textContent.trim()}" when ready — AutoApply will fill the next page too.`);
          break;
        }
      }

    } catch (err) {
      log.error("Autofill failed:", err.message);
      setOverlayStatus(`Error: ${err.message}`);
    } finally {
      fillInProgress = false;
      abortController = null;
    }
  }

  function highlightField(selector) {
    try { const el = document.querySelector(selector); if (el) { el.style.outline = "3px solid #d97706"; el.style.outlineOffset = "2px"; } } catch {}
  }

  /* ========== Message Listener ========== */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startAutofill") {
      runAutofill().then(() => sendResponse({ ok: true })).catch(err => sendResponse({ error: err.message }));
      return true;
    }
    if (message.action === "getFieldCount") {
      const adapter = detectAdapter();
      const fields = extractFields(adapter);
      sendResponse({ count: fields.length, adapter: adapter.name });
      return true;
    }
  });

  window.addEventListener("beforeunload", () => { if (abortController) abortController.abort(); });

  log.info("Content script loaded on:", window.location.href);
})();
