import type { UiProject } from "./types.js";

/**
 * Mock data for the dashboard SPA, ported as-is from the prototype.
 *
 * Phase A keeps these literals in TS so the SPA renders without a daemon.
 * Phase B replaces reads with daemon endpoints; Phase C tightens schemas.
 */

function isoMinusHours(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

export const SEED_PROJECTS: UiProject[] = [
  {
    id: "p_facture",
    name: "facture-flow",
    projectPath: "/Users/adrien/dev/clients/billy-corp/facture-flow",
    createdAt: isoMinusHours(2.4),
    lastActivityAt: isoMinusHours(0.05),
    status: "running",
    workflowStatus: "running",
    nodeCount: { spec: 5, worker: 8, done: 3 },
    runningNode: "node-04 · invoice-parser",
    runningAgent: "looma",
    config: { template: "fullstack-saas", stack: ["React", "Express", "Postgres"], level: 2 },
    createdBy: "user",
  },
  {
    id: "p_mathilde",
    name: "site-vitrine-mathilde",
    projectPath: "/Users/adrien/dev/perso/site-vitrine-mathilde",
    createdAt: isoMinusHours(36),
    lastActivityAt: isoMinusHours(28),
    status: "done",
    workflowStatus: "done",
    nodeCount: { spec: 3, worker: 4, done: 4 },
    config: { template: "static-site", stack: ["Astro"], level: 1 },
    createdBy: "user",
  },
  {
    id: "p_douyin",
    name: "douyin-pipeline",
    projectPath: "/Users/adrien/dev/labs/douyin-pipeline",
    createdAt: isoMinusHours(72),
    lastActivityAt: isoMinusHours(8),
    status: "paused",
    workflowStatus: "paused",
    nodeCount: { spec: 5, worker: 12, done: 6 },
    config: { template: "data-pipeline", stack: ["Python", "Airflow"], level: 3 },
    createdBy: "user",
  },
];
