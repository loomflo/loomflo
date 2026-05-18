import type { UiProject } from "./types.js";

/**
 * Empty fixtures kept as a typed shape for tests.
 *
 * The SPA must hydrate from the daemon — no project seed is shipped.
 * The shape is retained so tests can craft fixtures locally.
 */

export const SEED_PROJECTS: UiProject[] = [];
