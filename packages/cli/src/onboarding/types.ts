import { z } from "zod";

export const LEVELS = [1, 2, 3] as const;
export type Level = (typeof LEVELS)[number] | "custom";

export interface AdvancedAnswers {
  maxRetriesPerNode: number;
  maxRetriesPerTask: number;
  maxLoomasPerLoomi: number;
  reviewerEnabled: boolean;
  agentTimeout: number;
}

export interface WizardAnswers {
  providerProfileId: string;
  level: Level;
  budgetLimit: number;
  defaultDelay: number;
  retryDelay: number;
  validatorRetryDelay: number;
  validatorMaxAttempts: number;
  advanced?: AdvancedAnswers;
}

const levelSchema = z
  .union([z.literal("1"), z.literal("2"), z.literal("3"), z.literal("custom")])
  .transform((v) => (v === "custom" ? ("custom" as const) : (Number(v) as 1 | 2 | 3)));

const numberFromString = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) throw new Error("expected a number");
  return n;
});

export const WizardFlagsSchema = z.object({
  provider: z
    .union([
      z.literal("anthropic-oauth"),
      z.literal("anthropic"),
      z.literal("openai"),
      z.literal("moonshot"),
      z.literal("nvidia"),
    ])
    .optional(),
  profile: z.string().optional(),
  level: levelSchema.optional(),
  budget: numberFromString.optional(),
  defaultDelay: numberFromString.optional(),
  retryDelay: numberFromString.optional(),
  validatorRetryDelay: numberFromString.optional(),
  validatorMaxAttempts: numberFromString.optional(),
  apiKey: z.string().optional(),
  advanced: z.boolean().optional().default(false),
  yes: z.boolean().optional().default(false),
  nonInteractive: z.boolean().optional().default(false),
});

export type WizardFlags = z.infer<typeof WizardFlagsSchema>;

export interface WizardResult {
  answers: WizardAnswers;
  providerProfileId: string;
  confirmed: boolean;
}
