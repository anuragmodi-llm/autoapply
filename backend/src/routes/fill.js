/**
 * POST /api/fill route.
 * Accepts form fields + profile, returns LLM-generated fill values.
 */

import { processFields } from "../llm/index.js";

const FIELD_SCHEMA = {
  type: "object",
  required: ["id", "label", "type"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    type: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    placeholder: { type: "string" },
    context: { type: "string" },
  },
};

const REQUEST_SCHEMA = {
  type: "object",
  required: ["fields", "profile"],
  properties: {
    fields: {
      type: "array",
      items: FIELD_SCHEMA,
      minItems: 1,
      maxItems: 50,
    },
    profile: { type: "object" },
    jobContext: {
      type: "object",
      properties: {
        jobTitle: { type: "string" },
        company: { type: "string" },
        description: { type: "string" },
      },
    },
  },
};

/**
 * Registers the /api/fill route on a Fastify instance.
 * @param {import('fastify').FastifyInstance} app
 */
export default async function fillRoute(app) {
  app.post("/api/fill", {
    schema: {
      body: REQUEST_SCHEMA,
    },
  }, async (request, reply) => {
    const { fields, profile, jobContext } = request.body;

    // Log field IDs and types only — never log profile contents
    const fieldSummary = fields.map((f) => `${f.id}(${f.type})`).join(", ");
    request.log.info(`Processing ${fields.length} fields: ${fieldSummary}`);

    try {
      const result = await processFields({ fields, profile, jobContext });

      request.log.info(
        `Done: ${result.fills.length} fills, ${result.errors?.length || 0} errors, ` +
        `model=${result.meta.model}, tokens=${result.meta.usage.prompt_tokens}+${result.meta.usage.completion_tokens}`
      );

      return {
        fills: result.fills,
        errors: result.errors,
        debug: result.debug,
      };
    } catch (err) {
      request.log.error(`Fill failed: ${err.message}`);
      return reply.status(502).send({
        error: "LLM processing failed",
        message: err.message,
      });
    }
  });
}
