import type { Level } from "./types.js";

export interface PresetConfig {
  defaultDelay: number;
  retryDelay: number;
  maxRetriesPerNode: number;
  maxRetriesPerTask: number;
  maxLoomasPerLoomi: number;
  reviewerEnabled: boolean;
  agentTimeout: number;
}

const L1: PresetConfig = {
  defaultDelay: 500,
  retryDelay: 1000,
  maxRetriesPerNode: 1,
  maxRetriesPerTask: 1,
  maxLoomasPerLoomi: 3,
  reviewerEnabled: false,
  agentTimeout: 60_000,
};

const L2: PresetConfig = {
  defaultDelay: 1000,
  retryDelay: 2000,
  maxRetriesPerNode: 3,
  maxRetriesPerTask: 2,
  maxLoomasPerLoomi: 5,
  reviewerEnabled: true,
  agentTimeout: 120_000,
};

const L3: PresetConfig = {
  defaultDelay: 2000,
  retryDelay: 5000,
  maxRetriesPerNode: 5,
  maxRetriesPerTask: 3,
  maxLoomasPerLoomi: 8,
  reviewerEnabled: true,
  agentTimeout: 240_000,
};

export function presetDefaults(level: Level): PresetConfig {
  if (level === 1) return { ...L1 };
  if (level === 3) return { ...L3 };
  // level === 2 or "custom"
  return { ...L2 };
}
