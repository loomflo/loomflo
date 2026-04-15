import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ProjectRuntime, ProjectSummary } from "../../daemon-types.js";
import { toProjectSummary } from "../../daemon-types.js";

const RegisterSchema = z.object({
  id: z.string().regex(/^proj_[0-9a-f]{8}$/),
  name: z.string().min(1),
  projectPath: z.string().min(1),
  providerProfileId: z.string().min(1),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
});

export interface ProjectsCrudOptions {
  listProjects: () => ProjectSummary[];
  getProject: (id: string) => ProjectRuntime | null;
  /** Build and register a ProjectRuntime. Throws on missing profile etc. */
  registerProject: (input: z.infer<typeof RegisterSchema>) => Promise<ProjectRuntime>;
  deregisterProject: (id: string) => Promise<boolean>;
}

export const projectsCrudRoutes: FastifyPluginAsync<ProjectsCrudOptions> = (app, opts) => {
  app.get("/projects", async (_req, reply) => {
    return reply.send(opts.listProjects());
  });

  app.post("/projects", async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const existing = opts.getProject(parsed.data.id);
    if (existing) {
      return reply.code(409).send({ error: "project_already_registered", id: parsed.data.id });
    }
    try {
      const rt = await opts.registerProject(parsed.data);
      return await reply.code(201).send(toProjectSummary(rt));
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("provider_missing_credentials")) {
        return reply.code(400).send({ error: "provider_missing_credentials" });
      }
      return reply.code(500).send({ error: "register_failed", message });
    }
  });

  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rt = opts.getProject(id);
    if (!rt) return reply.code(404).send({ error: "project_not_registered", id });
    return reply.send(toProjectSummary(rt));
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const removed = await opts.deregisterProject(id);
    if (!removed) return reply.code(404).send({ error: "project_not_registered", id });
    return reply.code(204).send();
  });
  return Promise.resolve();
};
