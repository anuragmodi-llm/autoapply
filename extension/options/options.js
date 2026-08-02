/**
 * Options page controller.
 * Manages profile creation, editing, and dynamic entry lists
 * (experience, education, Q&A).
 */

import { saveProfile, getProfile, clearProfile, saveResumeFile, getResumeFile, clearResumeFile, getFieldRules, saveFieldRules, DEFAULT_FIELD_RULES } from "../lib/storage.js";
import * as log from "../lib/logger.js";

const BACKEND_URL = "https://autoapply-beryl.vercel.app";

const DEFAULT_QA = [
  { question_pattern: "Why are you interested in this role?", answer: "" },
  { question_pattern: "Why do you want to leave your current job?", answer: "" },
  { question_pattern: "What are your salary expectations?", answer: "" },
  { question_pattern: "Where do you see yourself in 5 years?", answer: "" },
  { question_pattern: "Tell us about yourself", answer: "" },
  { question_pattern: "What are your strengths?", answer: "" },
  { question_pattern: "What are your weaknesses?", answer: "" },
  { question_pattern: "Describe a challenging project", answer: "" },
];

let experienceEntries = [];
let educationEntries = [];
let qaEntries = [];
let fieldRuleEntries = [];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

document.addEventListener("DOMContentLoaded", init);

async function init() {
  // Attach listeners FIRST so buttons always work even if async calls fail
  $("#btn-save").addEventListener("click", handleSave);
  $("#btn-clear").addEventListener("click", handleClear);
  $("#btn-add-exp").addEventListener("click", () => addExperienceEntry());
  $("#btn-add-edu").addEventListener("click", () => addEducationEntry());
  $("#btn-add-qa").addEventListener("click", () => addQAEntry());
  $("#btn-export").addEventListener("click", handleExport);
  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", handleImport);
  $("#resume-file").addEventListener("change", handleResumeUpload);
  $("#btn-remove-resume").addEventListener("click", handleRemoveResume);
  $("#btn-add-rule").addEventListener("click", () => addFieldRule());
  $("#btn-reset-rules").addEventListener("click", handleResetRules);
  $("#btn-save-rules").addEventListener("click", handleSaveRules);
  setupNavigation();

  // Enable save button
  $("#btn-save").disabled = false;

  showStoredResume(await getResumeFile().catch(() => null));

  try {
    fieldRuleEntries = (await getFieldRules()).map((r) => ({ ...r }));
  } catch (err) {
    log.error("Failed to load field rules:", err);
    fieldRuleEntries = DEFAULT_FIELD_RULES.map((r) => ({ ...r }));
  }
  renderFieldRules();

  // Load existing profile or start fresh
  try {
    const profile = await getProfile();
    if (profile) {
      populateProfile(profile);
      setSaveStatus("", "Profile loaded.");
      setTimeout(() => setSaveStatus("", ""), 2000);
    } else {
      // First time — seed with default Q&A
      qaEntries = DEFAULT_QA.map((qa) => ({ ...qa }));
      renderExperienceEntries();
      renderEducationEntries();
      renderQAEntries();
    }
  } catch (err) {
    log.error("Failed to load profile:", err);
    setSaveStatus("error", "Failed to load profile: " + err.message);
    // Still show empty form so user can start fresh
    qaEntries = DEFAULT_QA.map((qa) => ({ ...qa }));
    renderExperienceEntries();
    renderEducationEntries();
    renderQAEntries();
  }
}

function populateProfile(p) {
  if (p.personal) {
    $("#personal-name").value = p.personal.name || "";
    $("#personal-email").value = p.personal.email || "";
    $("#personal-phone").value = p.personal.phone || "";
    $("#personal-location").value = p.personal.location || "";
    $("#personal-linkedin").value = p.personal.linkedin || "";
    $("#personal-github").value = p.personal.github || "";
    $("#personal-portfolio").value = p.personal.portfolio || "";
    $("#personal-company").value = p.personal.company || "";
    $("#personal-role").value = p.personal.role || "";
    $("#personal-notice").value = p.personal.notice_period || "";
    $("#personal-ctc").value = p.personal.current_ctc || "";
    $("#personal-expected-ctc").value = p.personal.expected_ctc || "";
    $("#personal-work-auth").value = p.personal.work_authorization || "";
  }

  experienceEntries = p.experience || [];
  educationEntries = p.education || [];
  qaEntries =
    p.qa_bank && p.qa_bank.length
      ? p.qa_bank
      : DEFAULT_QA.map((qa) => ({ ...qa }));

  if (p.skills) {
    $("#skills-technical").value = (p.skills.technical || []).join(", ");
    $("#skills-soft").value = (p.skills.soft || []).join(", ");
    $("#skills-tools").value = (p.skills.tools || []).join(", ");
    $("#skills-languages").value = (p.skills.languages || []).join(", ");
  }

  if (p.preferences) {
    $("#pref-relocate").value = p.preferences.willing_to_relocate || "";
    $("#pref-remote").value = p.preferences.remote_preference || "";
    $("#pref-locations").value = (
      p.preferences.preferred_locations || []
    ).join(", ");
  }

  renderExperienceEntries();
  renderEducationEntries();
  renderQAEntries();
}

function collectProfile() {
  return {
    personal: {
      name: $("#personal-name").value.trim(),
      email: $("#personal-email").value.trim(),
      phone: $("#personal-phone").value.trim(),
      location: $("#personal-location").value.trim(),
      linkedin: $("#personal-linkedin").value.trim(),
      github: $("#personal-github").value.trim(),
      portfolio: $("#personal-portfolio").value.trim(),
      company: $("#personal-company").value.trim(),
      role: $("#personal-role").value.trim(),
      notice_period: $("#personal-notice").value.trim(),
      current_ctc: $("#personal-ctc").value.trim(),
      expected_ctc: $("#personal-expected-ctc").value.trim(),
      work_authorization: $("#personal-work-auth").value,
    },
    experience: collectExperienceFromDOM(),
    education: collectEducationFromDOM(),
    skills: {
      technical: parseCSV($("#skills-technical").value),
      soft: parseCSV($("#skills-soft").value),
      tools: parseCSV($("#skills-tools").value),
      languages: parseCSV($("#skills-languages").value),
    },
    qa_bank: collectQAFromDOM(),
    preferences: {
      willing_to_relocate: $("#pref-relocate").value,
      remote_preference: $("#pref-remote").value,
      preferred_locations: parseCSV($("#pref-locations").value),
    },
  };
}

function parseCSV(str) {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function handleSave() {
  const profile = collectProfile();

  if (!profile.personal.name || !profile.personal.email) {
    setSaveStatus("error", "Name and Email are required.");
    return;
  }

  try {
    $("#btn-save").disabled = true;
    setSaveStatus("", "Saving...");
    await saveProfile(profile);
    setSaveStatus("success", "Profile saved!");
    setTimeout(() => setSaveStatus("", ""), 3000);
  } catch (err) {
    log.error("Save failed:", err);
    setSaveStatus("error", "Save failed: " + err.message);
  } finally {
    $("#btn-save").disabled = false;
  }
}

async function handleClear() {
  if (
    !confirm(
      "This will permanently delete your profile. Are you sure?"
    )
  ) {
    return;
  }
  try {
    await clearProfile();
    location.reload();
  } catch (err) {
    log.error("Clear failed:", err);
    setSaveStatus("error", "Failed to clear: " + err.message);
  }
}

function setSaveStatus(type, text) {
  const el = $("#save-status");
  el.textContent = text;
  el.className = "save-status" + (type ? " " + type : "");
}

/* ========== Experience Entries ========== */

function renderExperienceEntries() {
  const list = $("#experience-list");
  list.innerHTML = "";

  if (experienceEntries.length === 0) {
    list.innerHTML =
      '<div class="empty-state">No experience added yet. Click "+ Add Experience" to start.</div>';
    return;
  }

  experienceEntries.forEach((exp, i) => {
    const card = document.createElement("div");
    card.className = "entry-card";
    card.dataset.index = i;
    card.innerHTML = `
      <div class="entry-card-header">
        <span class="entry-card-title">Experience #${i + 1}</span>
        <button class="btn-icon btn-remove-exp" data-index="${i}" title="Remove">&#x2715;</button>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Company</label>
          <input type="text" class="exp-company" value="${esc(exp.company)}" placeholder="Acme Corp">
        </div>
        <div class="field">
          <label>Role</label>
          <input type="text" class="exp-role" value="${esc(exp.role)}" placeholder="Software Engineer">
        </div>
        <div class="field">
          <label>Start Date</label>
          <input type="text" class="exp-start" value="${esc(exp.start_date)}" placeholder="Jan 2022">
        </div>
        <div class="field">
          <label>End Date</label>
          <input type="text" class="exp-end" value="${esc(exp.end_date)}" placeholder="Present">
        </div>
        <div class="field full-width">
          <label>Description</label>
          <textarea class="exp-desc" rows="3" placeholder="What you did, impact, technologies used...">${esc(exp.description)}</textarea>
        </div>
        <div class="achievements-wrapper">
          <label>Key Achievements</label>
          <div class="achievements-list">
            ${(exp.achievements || [])
              .map(
                (a, ai) => `
              <div class="achievement-row">
                <input type="text" class="exp-achievement" value="${esc(a)}" placeholder="Achievement ${ai + 1}">
                <button class="btn-icon btn-remove-achievement" data-exp="${i}" data-ach="${ai}" title="Remove">&#x2715;</button>
              </div>
            `
              )
              .join("")}
          </div>
          <button class="btn-add-achievement" data-exp="${i}">+ Add achievement</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll(".btn-remove-exp").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      syncExperienceFromDOM();
      experienceEntries.splice(Number(e.target.dataset.index), 1);
      renderExperienceEntries();
    })
  );

  list.querySelectorAll(".btn-add-achievement").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.exp);
      syncExperienceFromDOM();
      experienceEntries[idx].achievements.push("");
      renderExperienceEntries();
    })
  );

  list.querySelectorAll(".btn-remove-achievement").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      const expIdx = Number(e.target.dataset.exp);
      const achIdx = Number(e.target.dataset.ach);
      syncExperienceFromDOM();
      experienceEntries[expIdx].achievements.splice(achIdx, 1);
      renderExperienceEntries();
    })
  );
}

function addExperienceEntry() {
  syncExperienceFromDOM();
  experienceEntries.push({
    company: "",
    role: "",
    start_date: "",
    end_date: "",
    description: "",
    achievements: [],
  });
  renderExperienceEntries();
  scrollToLast("#experience-list");
}

function syncExperienceFromDOM() {
  const cards = $$("#experience-list .entry-card");
  cards.forEach((card, i) => {
    if (experienceEntries[i]) {
      experienceEntries[i].company =
        card.querySelector(".exp-company").value;
      experienceEntries[i].role = card.querySelector(".exp-role").value;
      experienceEntries[i].start_date =
        card.querySelector(".exp-start").value;
      experienceEntries[i].end_date =
        card.querySelector(".exp-end").value;
      experienceEntries[i].description =
        card.querySelector(".exp-desc").value;
      experienceEntries[i].achievements = Array.from(
        card.querySelectorAll(".exp-achievement")
      ).map((inp) => inp.value);
    }
  });
}

function collectExperienceFromDOM() {
  syncExperienceFromDOM();
  return experienceEntries.map((e) => ({
    ...e,
    company: e.company.trim(),
    role: e.role.trim(),
    start_date: e.start_date.trim(),
    end_date: e.end_date.trim(),
    description: e.description.trim(),
    achievements: e.achievements.filter((a) => a.trim()),
  }));
}

/* ========== Education Entries ========== */

function renderEducationEntries() {
  const list = $("#education-list");
  list.innerHTML = "";

  if (educationEntries.length === 0) {
    list.innerHTML =
      '<div class="empty-state">No education added yet. Click "+ Add Education" to start.</div>';
    return;
  }

  educationEntries.forEach((edu, i) => {
    const card = document.createElement("div");
    card.className = "entry-card";
    card.innerHTML = `
      <div class="entry-card-header">
        <span class="entry-card-title">Education #${i + 1}</span>
        <button class="btn-icon btn-remove-edu" data-index="${i}" title="Remove">&#x2715;</button>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Institution</label>
          <input type="text" class="edu-institution" value="${esc(edu.institution)}" placeholder="MIT">
        </div>
        <div class="field">
          <label>Degree</label>
          <input type="text" class="edu-degree" value="${esc(edu.degree)}" placeholder="B.S.">
        </div>
        <div class="field">
          <label>Field of Study</label>
          <input type="text" class="edu-field" value="${esc(edu.field)}" placeholder="Computer Science">
        </div>
        <div class="field">
          <label>GPA</label>
          <input type="text" class="edu-gpa" value="${esc(edu.gpa)}" placeholder="3.8">
        </div>
        <div class="field">
          <label>Start Year</label>
          <input type="text" class="edu-start" value="${esc(edu.start_year)}" placeholder="2018">
        </div>
        <div class="field">
          <label>End Year</label>
          <input type="text" class="edu-end" value="${esc(edu.end_year)}" placeholder="2022">
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll(".btn-remove-edu").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      syncEducationFromDOM();
      educationEntries.splice(Number(e.target.dataset.index), 1);
      renderEducationEntries();
    })
  );
}

function addEducationEntry() {
  syncEducationFromDOM();
  educationEntries.push({
    institution: "",
    degree: "",
    field: "",
    start_year: "",
    end_year: "",
    gpa: "",
  });
  renderEducationEntries();
  scrollToLast("#education-list");
}

function syncEducationFromDOM() {
  const cards = $$("#education-list .entry-card");
  cards.forEach((card, i) => {
    if (educationEntries[i]) {
      educationEntries[i].institution =
        card.querySelector(".edu-institution").value;
      educationEntries[i].degree =
        card.querySelector(".edu-degree").value;
      educationEntries[i].field =
        card.querySelector(".edu-field").value;
      educationEntries[i].start_year =
        card.querySelector(".edu-start").value;
      educationEntries[i].end_year =
        card.querySelector(".edu-end").value;
      educationEntries[i].gpa = card.querySelector(".edu-gpa").value;
    }
  });
}

function collectEducationFromDOM() {
  syncEducationFromDOM();
  return educationEntries.map((e) => ({
    institution: e.institution.trim(),
    degree: e.degree.trim(),
    field: e.field.trim(),
    start_year: e.start_year.trim(),
    end_year: e.end_year.trim(),
    gpa: e.gpa.trim(),
  }));
}

/* ========== Q&A Entries ========== */

function renderQAEntries() {
  const list = $("#qa-list");
  list.innerHTML = "";

  if (qaEntries.length === 0) {
    list.innerHTML =
      '<div class="empty-state">No Q&A pairs. Click "+ Add Q&A" to start.</div>';
    return;
  }

  qaEntries.forEach((qa, i) => {
    const card = document.createElement("div");
    card.className = "entry-card qa-card";
    card.innerHTML = `
      <div class="entry-card-header">
        <span class="entry-card-title">Q&A #${i + 1}</span>
        <button class="btn-icon btn-remove-qa" data-index="${i}" title="Remove">&#x2715;</button>
      </div>
      <div class="grid-1">
        <div class="field">
          <label>Question Pattern</label>
          <input type="text" class="qa-question" value="${esc(qa.question_pattern)}" placeholder="Why are you interested in this role?">
        </div>
        <div class="field">
          <label>Your Answer</label>
          <textarea class="qa-answer" rows="4" placeholder="Write your best answer. The AI will adapt it per job.">${esc(qa.answer)}</textarea>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll(".btn-remove-qa").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      syncQAFromDOM();
      qaEntries.splice(Number(e.target.dataset.index), 1);
      renderQAEntries();
    })
  );
}

function addQAEntry() {
  syncQAFromDOM();
  qaEntries.push({ question_pattern: "", answer: "" });
  renderQAEntries();
  scrollToLast("#qa-list");
}

function syncQAFromDOM() {
  const cards = $$("#qa-list .entry-card");
  cards.forEach((card, i) => {
    if (qaEntries[i]) {
      qaEntries[i].question_pattern =
        card.querySelector(".qa-question").value;
      qaEntries[i].answer = card.querySelector(".qa-answer").value;
    }
  });
}

function collectQAFromDOM() {
  syncQAFromDOM();
  return qaEntries.map((qa) => ({
    question_pattern: qa.question_pattern.trim(),
    answer: qa.answer.trim(),
  }));
}

/* ========== Field Mapping Rules ========== */

function renderFieldRules() {
  const list = $("#field-rules-list");
  list.innerHTML = "";

  if (fieldRuleEntries.length === 0) {
    list.innerHTML = '<div class="empty-state">No rules. Click "+ Add Rule" to start.</div>';
    return;
  }

  fieldRuleEntries.forEach((rule, i) => {
    const card = document.createElement("div");
    card.className = "entry-card";
    card.innerHTML = `
      <div class="entry-card-header">
        <span class="entry-card-title">Rule #${i + 1}</span>
        <button class="btn-icon btn-remove-rule" data-index="${i}" title="Remove">&#x2715;</button>
      </div>
      <div class="grid-1">
        <div class="field">
          <label>Label Keywords (comma-separated, case-insensitive)</label>
          <input type="text" class="rule-keywords" value="${esc(rule.keywords)}" placeholder="first name, given name">
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Profile Field (dot path)</label>
            <input type="text" class="rule-field" value="${esc(rule.profileField)}" placeholder="personal.email">
          </div>
          <div class="field">
            <label>Transform</label>
            <select class="rule-transform">
              <option value="" ${!rule.transform ? "selected" : ""}>None</option>
              <option value="firstName" ${rule.transform === "firstName" ? "selected" : ""}>First word only</option>
              <option value="lastName" ${rule.transform === "lastName" ? "selected" : ""}>All but first word</option>
            </select>
          </div>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll(".btn-remove-rule").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      syncFieldRulesFromDOM();
      fieldRuleEntries.splice(Number(e.target.dataset.index), 1);
      renderFieldRules();
    })
  );
}

function addFieldRule() {
  syncFieldRulesFromDOM();
  fieldRuleEntries.push({ keywords: "", profileField: "", transform: "" });
  renderFieldRules();
  scrollToLast("#field-rules-list");
}

function syncFieldRulesFromDOM() {
  const cards = $$("#field-rules-list .entry-card");
  cards.forEach((card, i) => {
    if (fieldRuleEntries[i]) {
      fieldRuleEntries[i].keywords = card.querySelector(".rule-keywords").value;
      fieldRuleEntries[i].profileField = card.querySelector(".rule-field").value;
      fieldRuleEntries[i].transform = card.querySelector(".rule-transform").value;
    }
  });
}

function collectFieldRulesFromDOM() {
  syncFieldRulesFromDOM();
  return fieldRuleEntries
    .map((r) => ({ keywords: r.keywords.trim(), profileField: r.profileField.trim(), transform: r.transform || undefined }))
    .filter((r) => r.keywords && r.profileField);
}

async function handleSaveRules() {
  const rules = collectFieldRulesFromDOM();
  try {
    await saveFieldRules(rules);
    setRulesStatus("success", "Field mapping rules saved.");
    setTimeout(() => setRulesStatus("", ""), 3000);
  } catch (err) {
    log.error("Failed to save field rules:", err);
    setRulesStatus("error", "Save failed: " + err.message);
  }
}

async function handleResetRules() {
  if (!confirm("Reset field mapping rules to the built-in defaults? Custom rules will be lost.")) return;
  fieldRuleEntries = DEFAULT_FIELD_RULES.map((r) => ({ ...r }));
  renderFieldRules();
  await saveFieldRules(fieldRuleEntries);
  setRulesStatus("success", "Reset to defaults.");
  setTimeout(() => setRulesStatus("", ""), 3000);
}

function setRulesStatus(type, text) {
  const el = $("#rules-save-status");
  el.textContent = text;
  el.className = "save-status" + (type ? " " + type : "");
}

/* ========== Navigation ========== */

function setupNavigation() {
  $$(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      $$(".nav-link").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
      const target = document.querySelector(
        link.getAttribute("href")
      );
      if (target)
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          const section = id.replace("section-", "");
          $$(".nav-link").forEach((l) => l.classList.remove("active"));
          const active = $(
            `.nav-link[data-section="${section}"]`
          );
          if (active) active.classList.add("active");
        }
      });
    },
    { rootMargin: "-20% 0px -60% 0px" }
  );

  $$(".section").forEach((s) => observer.observe(s));
}

/* ========== Helpers ========== */

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function scrollToLast(containerSel) {
  const container = $(containerSel);
  const last = container.lastElementChild;
  if (last) {
    setTimeout(
      () =>
        last.scrollIntoView({ behavior: "smooth", block: "center" }),
      50
    );
  }
}

/* ========== Import / Export ========== */

function handleExport() {
  const profile = collectProfile();
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `autoapply-profile-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setSaveStatus("success", "Profile exported.");
  setTimeout(() => setSaveStatus("", ""), 2000);
}

async function handleImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const profile = JSON.parse(text);
    if (!profile.personal) throw new Error("Invalid profile file — missing personal section.");
    populateProfile(profile);
    setSaveStatus("success", "Profile imported — click Save to persist.");
  } catch (err) {
    log.error("Import failed:", err);
    setSaveStatus("error", "Import failed: " + err.message);
  }
  e.target.value = "";
}

/* ========== Resume Upload & Parsing ========== */

const RESUME_ACCEPTED_TYPES = {
  "application/pdf": true,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
  "application/msword": true,
  "text/plain": true,
};

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function setResumeStatus(type, text) {
  const el = $("#resume-status");
  el.textContent = text;
  el.className = "resume-status" + (type ? " " + type : "");
}

function showStoredResume(resumeFile) {
  const box = $("#resume-current");
  if (!resumeFile) {
    box.style.display = "none";
    return;
  }
  box.style.display = "flex";
  $("#resume-current-name").textContent = `📄 ${resumeFile.name} (uploaded ${new Date(resumeFile.uploadedAt).toLocaleDateString()})`;
}

async function handleResumeUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!RESUME_ACCEPTED_TYPES[file.type]) {
    setResumeStatus("error", "Unsupported file type. Use PDF, DOC, DOCX, or TXT.");
    e.target.value = "";
    return;
  }

  try {
    setResumeStatus("info", "Reading file...");
    const dataUrl = await readFileAsDataUrl(file);
    const fileBase64 = dataUrl.split(",")[1];

    // Store the raw file immediately so auto-attach works even if parsing fails
    await saveResumeFile({ name: file.name, mimeType: file.type, dataUrl });
    showStoredResume(await getResumeFile());

    setResumeStatus("info", "Parsing resume with AI — this may take a few seconds...");
    const resp = await fetch(`${BACKEND_URL}/api/parse-resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileBase64, mimeType: file.type, fileName: file.name }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.message || `Server error ${resp.status}`);
    }

    const { profile: parsed } = await resp.json();
    mergeParsedResume(parsed);

    setResumeStatus(
      "success",
      `Parsed: ${parsed.experience?.length || 0} experience, ${parsed.education?.length || 0} education entries. Review the fields below, then click Save Profile.`
    );
  } catch (err) {
    log.error("Resume upload/parse failed:", err);
    setResumeStatus("error", "Parsing failed: " + err.message + " — resume file is still saved for auto-attach.");
  } finally {
    e.target.value = "";
  }
}

async function handleRemoveResume() {
  if (!confirm("Remove the stored resume file?")) return;
  try {
    await clearResumeFile();
    showStoredResume(null);
    setResumeStatus("", "");
  } catch (err) {
    log.error("Failed to remove resume:", err);
    setResumeStatus("error", "Failed to remove: " + err.message);
  }
}

/**
 * Merges parsed resume data into the current form: fills empty personal
 * fields, appends new experience/education entries, and unions skills —
 * never overwrites data the user already entered.
 */
function mergeParsedResume(parsed) {
  if (parsed.personal) {
    const fieldMap = {
      "#personal-name": parsed.personal.name,
      "#personal-email": parsed.personal.email,
      "#personal-phone": parsed.personal.phone,
      "#personal-location": parsed.personal.location,
      "#personal-linkedin": parsed.personal.linkedin,
      "#personal-github": parsed.personal.github,
      "#personal-portfolio": parsed.personal.portfolio,
      "#personal-company": parsed.personal.company,
      "#personal-role": parsed.personal.role,
    };
    for (const [sel, value] of Object.entries(fieldMap)) {
      const input = $(sel);
      if (input && !input.value.trim() && value) input.value = value;
    }
  }

  if (parsed.experience?.length) {
    syncExperienceFromDOM();
    experienceEntries.push(...parsed.experience.map((e) => ({ ...e, achievements: e.achievements || [] })));
    renderExperienceEntries();
  }

  if (parsed.education?.length) {
    syncEducationFromDOM();
    educationEntries.push(...parsed.education);
    renderEducationEntries();
  }

  if (parsed.skills) {
    mergeSkillsField("#skills-technical", parsed.skills.technical);
    mergeSkillsField("#skills-soft", parsed.skills.soft);
    mergeSkillsField("#skills-tools", parsed.skills.tools);
    mergeSkillsField("#skills-languages", parsed.skills.languages);
  }
}

function mergeSkillsField(selector, newSkills) {
  if (!newSkills?.length) return;
  const input = $(selector);
  const existing = new Set(parseCSV(input.value).map((s) => s.toLowerCase()));
  const merged = parseCSV(input.value);
  for (const skill of newSkills) {
    if (!existing.has(skill.toLowerCase())) {
      merged.push(skill);
      existing.add(skill.toLowerCase());
    }
  }
  input.value = merged.join(", ");
}
