import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Shape of the daemon connection file at ~/.loomflo/daemon.json. */
interface DaemonConfig {
  port: number;
  token: string;
}

/** Shape of a successful POST /workflow/init response. */
interface InitSuccessResponse {
  id: string;
  status: string;
  description: string;
}

/** Shape of an error response from the daemon API. */
interface ErrorResponse {
  error: string;
}

/** Parsed CLI options for the init command. */
interface InitOptions {
  projectPath: string;
  budget?: string;
  reviewer?: boolean;
}

/** Handle for a text-based progress spinner. */
interface Spinner {
  /** Stop the spinner and clear the line. */
  stop: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Read the daemon connection file from ~/.loomflo/daemon.json.
 *
 * The daemon writes this file at startup with the port it is listening on
 * and the auto-generated auth token. If the file is missing, the daemon
 * is not running.
 *
 * @returns The parsed daemon configuration containing port and auth token.
 */
async function readDaemonConfig(): Promise<DaemonConfig> {
  const configPath = join(homedir(), '.loomflo', 'daemon.json');

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    console.error('Daemon not running. Start with: loomflo start');
    process.exit(1);
  }

  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as DaemonConfig).port !== 'number' ||
    typeof (parsed as DaemonConfig).token !== 'string'
  ) {
    console.error('Invalid daemon.json. Re-start the daemon with: loomflo start');
    process.exit(1);
  }

  return parsed as DaemonConfig;
}

/**
 * Create a simple text-based progress spinner for terminal output.
 *
 * Renders a braille-pattern animation alongside the given message,
 * updating every 80 ms. Call `stop()` on the returned handle to
 * clear the spinner line.
 *
 * @param message - The message to display alongside the spinner.
 * @returns A spinner handle with a `stop` method.
 */
function createSpinner(message: string): Spinner {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  process.stdout.write(`${String(frames[0])} ${message}`);

  const interval = setInterval((): void => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${String(frames[i])} ${message}`);
  }, 80);

  return {
    stop(): void {
      clearInterval(interval);
      process.stdout.write(`\r${' '.repeat(message.length + 3)}\r`);
    },
  };
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `init` command for the loomflo CLI.
 *
 * Usage: `loomflo init <description>`
 *
 * Calls POST /workflow/init on the running daemon to start Phase 1
 * (spec generation) from a natural language project description.
 *
 * Options:
 * - `--project-path <path>` — Project directory (defaults to cwd).
 * - `--budget <number>` — Budget limit in dollars.
 * - `--reviewer` — Enable the reviewer agent.
 *
 * @returns A configured commander Command instance.
 */
export function createInitCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize a new workflow from a project description')
    .argument('<description>', 'Natural language description of the project')
    .option('--project-path <path>', 'Project directory path', process.cwd())
    .option('--budget <number>', 'Budget limit in dollars')
    .option('--reviewer', 'Enable the reviewer agent')
    .action(async (description: string, options: InitOptions): Promise<void> => {
      const daemon = await readDaemonConfig();
      const projectPath = resolve(options.projectPath);

      const config: Record<string, unknown> = {};
      if (options.budget !== undefined) {
        const budgetLimit = Number(options.budget);
        if (Number.isNaN(budgetLimit) || budgetLimit <= 0) {
          console.error('Error: --budget must be a positive number');
          process.exit(1);
        }
        config['budgetLimit'] = budgetLimit;
      }
      if (options.reviewer === true) {
        config['reviewerEnabled'] = true;
      }

      const body: Record<string, unknown> = {
        description,
        projectPath,
      };
      if (Object.keys(config).length > 0) {
        body['config'] = config;
      }

      const url = `http://127.0.0.1:${String(daemon.port)}/workflow/init`;
      const spinner = createSpinner('Initializing workflow...');

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${daemon.token}`,
          },
          body: JSON.stringify(body),
        });

        spinner.stop();

        if (response.status === 201) {
          const data = (await response.json()) as InitSuccessResponse;
          console.log('Workflow initialized successfully.');
          console.log(`  ID:     ${data.id}`);
          console.log(`  Status: ${data.status}`);
        } else {
          const data = (await response.json()) as ErrorResponse;
          console.error(`Error: ${data.error}`);
          process.exit(1);
        }
      } catch (error: unknown) {
        spinner.stop();
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to connect to daemon: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}
