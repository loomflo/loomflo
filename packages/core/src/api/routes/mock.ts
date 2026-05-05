/**
 * /mock/* routes — fixture endpoints for dashboard development.
 *
 * Only registered when `LOOMFLO_MOCK_API=1` is set in the environment, so
 * production deployments never expose these. Lets the dashboard team
 * iterate against realistic, type-correct API responses without a live
 * daemon driving real workflows.
 *
 * @module api/routes/mock
 */

import type { FastifyPluginAsync } from "fastify";
import {
  MOCK_CLI_AVAILABILITY,
  MOCK_EVENTS,
  MOCK_PROJECTS,
  MOCK_WORKFLOW,
} from "../mock-fixtures.js";

export const mockRoutes: FastifyPluginAsync = async (server) => {
  /** GET /mock/workflow — sample Workflow object. */
  server.get("/mock/workflow", async () => ({ workflow: MOCK_WORKFLOW }));

  /** GET /mock/events — sample event log. */
  server.get("/mock/events", async () => ({ events: MOCK_EVENTS }));

  /** GET /mock/projects — sample project list. */
  server.get("/mock/projects", async () => ({ projects: MOCK_PROJECTS }));

  /** GET /mock/runtimes/availability — sample CLI detection result. */
  server.get("/mock/runtimes/availability", async () => ({
    clis: MOCK_CLI_AVAILABILITY,
  }));

  /**
   * GET /mock/seed — bundled fixture for one-shot bootstrap. Lets the
   * dashboard hydrate every page from a single round-trip in mock mode.
   */
  server.get("/mock/seed", async () => ({
    workflow: MOCK_WORKFLOW,
    events: MOCK_EVENTS,
    projects: MOCK_PROJECTS,
    clis: MOCK_CLI_AVAILABILITY,
  }));
};

/**
 * Helper: returns true when mock routes should be exposed.
 * Centralised so server.ts stays declarative.
 */
export function isMockApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["LOOMFLO_MOCK_API"] === "1";
}
