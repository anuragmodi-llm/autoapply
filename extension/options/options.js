/**
 * Options page controller.
 * Manages profile creation, editing, and dynamic entry lists
 * (experience, education, Q&A).
 */

import { saveProfile, getProfile, clearProfile } from "../lib/storage.js";
import * as log from "../lib/logger.js";

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
  setupNavigation();

  // Enable save button
  $("#btn-save").disabled = false;

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
