import { input, password, confirm, select, number } from "@inquirer/prompts";

import type { PromptBackend } from "./prompts.js";

export const inquirerBackend: PromptBackend = {
  input: async (opts) => input(opts),
  password: async (opts) => password(opts),
  confirm: async (opts) => confirm({ message: opts.message, default: opts.default ?? true }),
  select: async (opts) =>
    select({
      message: opts.message,
      choices: opts.choices.map((c) => ({ name: c.name, value: c.value, description: c.description })),
      default: opts.default,
    }),
  number: async (opts) => {
    const raw = await number({ message: opts.message, default: opts.default, min: opts.min });
    if (raw === undefined) throw new Error("number prompt returned undefined");
    return raw;
  },
};
