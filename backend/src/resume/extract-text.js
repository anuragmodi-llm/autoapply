/**
 * Extracts raw text from an uploaded resume file (PDF, DOCX, or plain text).
 */

import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";

const MAX_TEXT_LENGTH = 15000;

/**
 * @param {Buffer} buffer - Raw file bytes
 * @param {string} mimeType
 * @returns {Promise<string>} Extracted plain text, capped in length
 */
export async function extractResumeText(buffer, mimeType) {
  let text;

  if (mimeType === "application/pdf") {
    const data = await pdfParse(buffer);
    text = data.text;
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (mimeType === "text/plain") {
    text = buffer.toString("utf-8");
  } else {
    throw new Error(`Unsupported resume file type: ${mimeType}. Use PDF, DOC, DOCX, or TXT.`);
  }

  text = text.trim();
  if (!text) throw new Error("No readable text found in the resume file.");

  return text.slice(0, MAX_TEXT_LENGTH);
}
