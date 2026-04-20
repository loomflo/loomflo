import type { FastifyPluginAsync } from "fastify";
import type { ProjectSummary } from "../../daemon-types.js";

const VERSION = "0.3.0";

export interface DaemonRoutesOptions {
  listProjects: () => ProjectSummary[];
  daemonPort: number;
  startedAtMs: number;
}

export const daemonRoutes: FastifyPluginAsync<DaemonRoutesOptions> = (app, opts) => {
  app.get("/daemon/status", async (_req, reply) => {
    return reply.send({
      port: opts.daemonPort,
      pid: process.pid,
      version: VERSION,
      uptimeMs: Date.now() - opts.startedAtMs,
      projectCount: opts.listProjects().length,
    });
  });
  return Promise.resolve();
};
