/**
 * Unit tests for packages/cli/src/commands/init.ts — createInitCommand.
 *
 * Covers happy path workflow initialization, daemon config errors,
 * API error responses, CLI options (--budget, --reviewer, --project-path),
 * spinner behavior, and network failure handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInitCommand } from "../../src/commands/init.js";

// ---------------------------------------------------------------------------
// Mock typecasts
// ---------------------------------------------------------------------------

const mockReadFile = readFile as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default valid daemon config for tests. */
const DAEMON_CONFIG = { port: 4000, token: "test-token" };

/** Create a minimal mock fetch Response with given status and JSON body. */
function createMockResponse(options: { status: number; body: unknown }): Response {
  return {
    status: options.status,
    json: vi.fn().mockResolvedValue(options.body),
  } as unknown as Response;
}

/**
 * Run the init command with the given CLI arguments.
 *
 * @param args - Arguments to pass after `node init`.
 * @returns A promise that resolves or rejects based on command execution.
 */
async function runInit(args: string[]): Promise<void> {
  const cmd = createInitCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "init", ...args]);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;
let mockProcessExit: ReturnType<typeof vi.fn>;
let mockConsoleLog: ReturnType<typeof vi.fn>;
let mockConsoleError: ReturnType<typeof vi.fn>;
let mockStdoutWrite: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Set required API key env var (T166 check runs before daemon config read)
  process.env["ANTHROPIC_API_KEY"] = "sk-test";

  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);

  mockProcessExit = vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  }) as unknown as ReturnType<typeof vi.fn>;

  mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mockStdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  vi.useFakeTimers();
});

afterEach(() => {
  delete process.env["ANTHROPIC_API_KEY"];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ===========================================================================
// Happy path
// ===========================================================================

/** Tests for successful workflow initialization via POST /workflow/init. */
describe("init command — happy path", () => {
  it("should POST to /workflow/init with correct body and display success output", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));
    mockFetch.mockResolvedValue(
      createMockResponse({
        status: 201,
        body: {
          id: "wf-abc123",
          status: "initializing",
          description: "Build a todo app",
        },
      }),
    );

    await runInit(["Build a todo app"]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4000/workflow/init");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-token");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["description"]).toBe("Build a todo app");
    expect(body["projectPath"]).toBe(resolve(process.cwd()));
    expect(body["config"]).toBeUndefined();

    expect(mockConsoleLog).toHaveBeenCalledWith("Workflow initialized successfully.");
    expect(mockConsoleLog).toHaveBeenCalledWith("  ID:     wf-abc123");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Status: initializing");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Daemon not running
// ===========================================================================

/** Tests for when daemon.json is missing (daemon not running). */
describe("init command — daemon not running", () => {
  it("should log an error and exit(1) when readFile throws", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await expect(runInit(["Build a todo app"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Daemon not running. Start with: loomflo start");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Non-201 response
// ===========================================================================

/** Tests for non-201 error responses from the daemon API. */
describe("init command — error response", () => {
  it("should log the error and exit(1) on a 400 response", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));
    mockFetch.mockResolvedValue(
      createMockResponse({
        status: 400,
        body: { error: "Invalid project description" },
      }),
    );

    await expect(runInit(["Build a todo app"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: Invalid project description");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it("should log the error and exit(1) on a 500 response", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));
    mockFetch.mockResolvedValue(
      createMockResponse({
        status: 500,
        body: { error: "Internal server error" },
      }),
    );

    await expect(runInit(["Build a todo app"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: Internal server error");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// --budget option (valid)
// ===========================================================================

/** Tests for the --budget CLI option with valid numeric values. */
describe("init command — --budget option", () => {
  it("should include budgetLimit in config when --budget is a valid positive number", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));
    mockFetch.mockResolvedValue(
      createMockResponse({
        status: 201,
        body: { id: "wf-1", status: "initializing", description: "test" },
      }),
    );

    await runInit(["--budget", "50", "Build a todo app"]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    const config = body["config"] as Record<string, unknown>;
    expect(config["budgetLimit"]).toBe(50);
  });
});

// ===========================================================================
// --budget invalid
// ===========================================================================

/** Tests for the --budget CLI option with invalid values. */
describe("init command — --budget invalid", () => {
  it("should log error and exit(1) when --budget is a non-number string", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));

    await expect(runInit(["--budget", "abc", "Build a todo app"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: --budget must be a positive number");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should log error and exit(1) when --budget is zero", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));

    await expect(runInit(["--budget", "0", "Build a todo app"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: --budget must be a positive number");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should log error and exit(1) when --budget is negative", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));

    await expect(runInit(["--budget", "-10", "Build a todo app"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: --budget must be a positive number");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// --reviewer option
// ===========================================================================

/** Tests for the --reviewer CLI option. */
describe("init command — --reviewer option", () => {
  it("should include reviewerEnabled: true in config when --reviewer is set", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));
    mockFetch.mockResolvedValue(
      createMockResponse({
        status: 201,
        body: { id: "wf-1", status: "initializing", description: "test" },
      }),
    );

    await runInit(["--reviewer", "Build a todo app"]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    const config = body["config"] as Record<string, unknown>;
    expect(config["reviewerEnabled"]).toBe(true);
  });
});

// ===========================================================================
// --project-path option
// ===========================================================================

/** Tests for the --project-path CLI option. */
describe("init command — --project-path option", () => {
  it("should resolve and send the provided project path", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));
    mockFetch.mockResolvedValue(
      createMockResponse({
        status: 201,
        body: { id: "wf-1", status: "initializing", description: "test" },
      }),
    );

    await runInit(["--project-path", "/tmp/my-project", "Build a todo app"]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["projectPath"]).toBe("/tmp/my-project");
  });
});

// ===========================================================================
// Spinner behavior
// ===========================================================================

/** Tests for the CLI progress spinner during workflow initialization. */
describe("init command — spinner behavior", () => {
  it("should display a spinner character while the request is in progress", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));
    mockFetch.mockResolvedValue(
      createMockResponse({
        status: 201,
        body: { id: "wf-1", status: "initializing", description: "test" },
      }),
    );

    await runInit(["Build a todo app"]);

    const stdoutCalls = mockStdoutWrite.mock.calls.map((call: unknown[]) => call[0] as string);
    const hasSpinnerChar = stdoutCalls.some((output: string) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(output));
    expect(hasSpinnerChar).toBe(true);
  });

  it("should clear the spinner line after fetch completes", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));
    mockFetch.mockResolvedValue(
      createMockResponse({
        status: 201,
        body: { id: "wf-1", status: "initializing", description: "test" },
      }),
    );

    await runInit(["Build a todo app"]);

    const stdoutCalls = mockStdoutWrite.mock.calls.map((call: unknown[]) => call[0] as string);
    const hasClearLine = stdoutCalls.some(
      (output: string) => output.startsWith("\r") && output.trim() === "",
    );
    expect(hasClearLine).toBe(true);
  });
});

// ===========================================================================
// Network error
// ===========================================================================

/** Tests for network errors when the daemon is unreachable. */
describe("init command — network error", () => {
  it("should log a connection error and exit(1) when fetch throws", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(DAEMON_CONFIG));
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(runInit(["Build a todo app"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Failed to connect to daemon: ECONNREFUSED");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});
