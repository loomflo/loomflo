#!/usr/bin/env node

import { Command } from "commander";

import { createChatCommand } from "./commands/chat.js";
import { createConfigCommand } from "./commands/config.js";
import { createDashboardCommand } from "./commands/dashboard.js";
import { createInitCommand } from "./commands/init.js";
import { createLogsCommand } from "./commands/logs.js";
import { createResumeCommand } from "./commands/resume.js";
import { createStartCommand } from "./commands/start.js";
import { createStatusCommand } from "./commands/status.js";
import { createStopCommand } from "./commands/stop.js";

/**
 * Create and configure the loomflo CLI program.
 *
 * Registers all subcommands (both implemented and placeholder stubs)
 * and configures global program metadata. Implemented commands include
 * init, start, stop, chat, and config; remaining commands are stubs
 * that will be wired up in later tasks.
 *
 * @returns The configured commander Program instance.
 */
function createProgram(): Command {
  const program = new Command()
    .name("loomflo")
    .description("AI Agent Orchestration Framework")
    .version("0.1.0");

  // Implemented commands
  program.addCommand(createInitCommand());
  program.addCommand(createStartCommand());
  program.addCommand(createStopCommand());
  program.addCommand(createChatCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createResumeCommand());
  program.addCommand(createStatusCommand());

  program.addCommand(createLogsCommand());
  program.addCommand(createDashboardCommand());

  return program;
}

const program = createProgram();
program.parse(process.argv);

if (program.args.length === 0 && process.argv.length <= 2) {
  program.help();
}
