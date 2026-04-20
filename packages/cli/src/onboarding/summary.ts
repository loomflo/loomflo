import { theme } from "../theme/index.js";
import type { WizardAnswers } from "./types.js";

export interface SummaryInput {
  projectName: string;
  answers: WizardAnswers;
}

function fmtBudget(v: number): string {
  if (v <= 0) return "unlimited";
  return `$${v.toFixed(2)}`;
}

function fmtMs(v: number): string {
  return `${String(v)}ms`;
}

export function renderSummary(input: SummaryInput): string {
  const { projectName, answers } = input;
  const lines = [
    theme.heading(projectName),
    "",
    theme.kv("provider", answers.providerProfileId),
    theme.kv("level", answers.level === "custom" ? "custom" : String(answers.level)),
    theme.kv("budget", fmtBudget(answers.budgetLimit)),
    theme.kv("delay", fmtMs(answers.defaultDelay)),
    theme.kv("retry", fmtMs(answers.retryDelay)),
    theme.kv("validator retry", fmtMs(answers.validatorRetryDelay)),
    theme.kv("validator attempts", String(answers.validatorMaxAttempts)),
  ];
  if (answers.advanced) {
    lines.push(
      "",
      theme.muted("  advanced:"),
      theme.kv("maxRetries", String(answers.advanced.maxRetriesPerNode), 13),
      theme.kv("reviewer", answers.advanced.reviewerEnabled ? "on" : "off", 13),
      theme.kv("timeout", fmtMs(answers.advanced.agentTimeout), 13),
    );
  }
  return lines.join("\n");
}
