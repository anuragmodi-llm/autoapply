/**
 * POST /api/parse-resume route.
 * Accepts a base64-encoded resume file, extracts its text, and uses the
 * LLM to return structured profile data (personal, experience, education, skills).
 */

import { extractResumeText } from "../resume/extract-text.js";
import { parseResume } from "../llm/index.js";

const REQUEST_SCHEMA = {
  type: "object",
  required: ["fileBase64", "mimeType", "fileName"],
  properties: {
    fileBase64: { type: "string" },
    mimeType: { type: "string" },
    fileName: { type: "string" },
  },
};

/**
 * Registers the /api/parse-resume route on a Fastify instance.
 * @param {import('fastify').FastifyInstance} app
 */
export default async function parseResumeRoute(app) {
  app.post("/api/parse-resume", {
    schema: {
      body: REQUEST_SCHEMA,
    },
  }, async (request, reply) => {
    const { fileBase64, mimeType, fileName } = request.body;

    request.log.info(`Parsing resume: ${fileName} (${mimeType})`);

    try {
      const buffer = Buffer.from(fileBase64, "base64");
      const text = await extractResumeText(buffer, mimeType);
      const result = await parseResume(text);

      request.log.info(
        `Resume parsed: ${result.profile.experience?.length || 0} experience entries, ` +
        `${result.profile.education?.length || 0} education entries, model=${result.debug.model}`
      );

      return { profile: result.profile, debug: result.debug };
    } catch (err) {
      request.log.error(`Resume parse failed: ${err.message}`);
      return reply.status(422).send({
        error: "Resume parsing failed",
        message: err.message,
      });
    }
  });
}
