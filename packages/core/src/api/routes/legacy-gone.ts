import type { FastifyPluginAsync } from "fastify";

const MIGRATIONS: ReadonlyArray<readonly [string, string, string]> = [
  ["POST", "/workflow/init",   "/projects/:id/workflow/init"],
  ["POST", "/workflow/start",  "/projects/:id/workflow/start"],
  ["POST", "/workflow/pause",  "/projects/:id/workflow/pause"],
  ["POST", "/workflow/resume", "/projects/:id/workflow/resume"],
  ["POST", "/workflow/stop",   "/projects/:id/workflow/stop"],
  ["GET",  "/workflow",        "/projects/:id/workflow"],
  ["GET",  "/events",          "/projects/:id/events"],
  ["GET",  "/nodes",           "/projects/:id/nodes"],
  ["POST", "/chat",            "/projects/:id/chat"],
  ["GET",  "/config",          "/projects/:id/config"],
];

export const legacyGoneRoutes: FastifyPluginAsync = (app) => {
  for (const [method, url, newRoute] of MIGRATIONS) {
    app.route({
      method: method as "GET" | "POST",
      url,
      handler: async (_req, reply) => {
        return reply.code(410).send({ error: "route_moved", newRoute });
      },
    });
  }
  return Promise.resolve();
};
