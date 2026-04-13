import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolContext } from "../../src/tools/base.js";
import { readFileTool } from "../../src/tools/file-read.js";
import { writeFileTool } from "../../src/tools/file-write.js";
import { editFileTool } from "../../src/tools/file-edit.js";
import { searchFilesTool } from "../../src/tools/file-search.js";
import { listFilesTool } from "../../src/tools/file-list.js";
import { shellExecTool } from "../../src/tools/shell-exec.js";
import { memoryReadTool } from "../../src/tools/memory-read.js";
import { memoryWriteTool } from "../../src/tools/memory-write.js";
import { createSendMessageTool } from "../../src/tools/send-message.js";
import type { MessageBusLike } from "../../src/tools/send-message.js";
import { createReportCompleteTool } from "../../src/tools/report-complete.js";
import type { CompletionHandlerLike } from "../../src/tools/report-complete.js";
import { createEscalateTool } from "../../src/tools/escalate.js";
import type { EscalationHandlerLike } from "../../src/tools/escalate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a default ToolContext pointing at the given workspace. */
function makeContext(workspacePath: string, overrides?: Partial<ToolContext>): ToolContext {
  return {
    workspacePath,
    agentId: "test-agent",
    nodeId: "test-node",
    writeScope: ["**/*"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared workspace setup
// ---------------------------------------------------------------------------

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "loomflo-tools-test-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ===========================================================================
// read_file
// ===========================================================================

describe("read_file", () => {
  it("reads an existing file successfully", async () => {
    await writeFile(join(workspace, "hello.txt"), "Hello World", "utf-8");
    const ctx = makeContext(workspace);
    const result = await readFileTool.execute({ path: "hello.txt" }, ctx);
    expect(result).toBe("Hello World");
  });

  it("returns error for non-existent file", async () => {
    const ctx = makeContext(workspace);
    const result = await readFileTool.execute({ path: "missing.txt" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("missing.txt");
  });

  it("rejects path traversal via ../", async () => {
    const ctx = makeContext(workspace);
    const result = await readFileTool.execute({ path: "../etc/passwd" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("outside the workspace");
  });

  it("reads a file in a subdirectory", async () => {
    await mkdir(join(workspace, "sub"), { recursive: true });
    await writeFile(join(workspace, "sub", "data.txt"), "nested", "utf-8");
    const ctx = makeContext(workspace);
    const result = await readFileTool.execute({ path: "sub/data.txt" }, ctx);
    expect(result).toBe("nested");
  });

  it("returns error when input is missing required path field", async () => {
    const ctx = makeContext(workspace);
    const result = await readFileTool.execute({}, ctx);
    expect(result).toContain("Error");
  });
});

// ===========================================================================
// write_file
// ===========================================================================

describe("write_file", () => {
  it("writes a new file within scope", async () => {
    const ctx = makeContext(workspace);
    const result = await writeFileTool.execute({ path: "out.txt", content: "written" }, ctx);
    expect(result).toContain("Successfully wrote");
    const content = await readFile(join(workspace, "out.txt"), "utf-8");
    expect(content).toBe("written");
  });

  it("creates parent directories automatically", async () => {
    const ctx = makeContext(workspace);
    const result = await writeFileTool.execute({ path: "a/b/c.txt", content: "deep" }, ctx);
    expect(result).toContain("Successfully wrote");
    const content = await readFile(join(workspace, "a", "b", "c.txt"), "utf-8");
    expect(content).toBe("deep");
  });

  it("rejects path traversal outside workspace", async () => {
    const ctx = makeContext(workspace);
    const result = await writeFileTool.execute({ path: "../../evil.txt", content: "bad" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("outside the workspace");
  });

  it("rejects write outside assigned scope", async () => {
    const ctx = makeContext(workspace, { writeScope: ["src/**"] });
    const result = await writeFileTool.execute({ path: "docs/readme.md", content: "nope" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("Write denied");
  });

  it("allows write inside assigned scope", async () => {
    const ctx = makeContext(workspace, { writeScope: ["src/**"] });
    const result = await writeFileTool.execute({ path: "src/index.ts", content: "export {}" }, ctx);
    expect(result).toContain("Successfully wrote");
  });

  it("returns error when input is missing required fields", async () => {
    const ctx = makeContext(workspace);
    const result = await writeFileTool.execute({ path: "x.txt" }, ctx);
    expect(result).toContain("Error");
  });

  it("reports correct byte count for multi-byte content", async () => {
    const ctx = makeContext(workspace);
    const content = "héllo wörld"; // multi-byte UTF-8 chars
    const result = await writeFileTool.execute({ path: "utf8.txt", content }, ctx);
    const expectedBytes = Buffer.byteLength(content, "utf-8");
    expect(result).toContain(`${expectedBytes} bytes`);
  });
});

// ===========================================================================
// edit_file
// ===========================================================================

describe("edit_file", () => {
  it("replaces text in an existing file", async () => {
    await writeFile(join(workspace, "code.ts"), "const x = 1;\n", "utf-8");
    const ctx = makeContext(workspace);
    const result = await editFileTool.execute(
      { path: "code.ts", oldText: "const x = 1;", newText: "const x = 2;" },
      ctx,
    );
    expect(result).toContain("Successfully edited");
    const content = await readFile(join(workspace, "code.ts"), "utf-8");
    expect(content).toBe("const x = 2;\n");
  });

  it("returns error for non-existent file", async () => {
    const ctx = makeContext(workspace);
    const result = await editFileTool.execute({ path: "nope.ts", oldText: "a", newText: "b" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("file not found");
  });

  it("returns error when oldText is not found", async () => {
    await writeFile(join(workspace, "f.txt"), "abc", "utf-8");
    const ctx = makeContext(workspace);
    const result = await editFileTool.execute(
      { path: "f.txt", oldText: "xyz", newText: "new" },
      ctx,
    );
    expect(result).toContain("Error");
    expect(result).toContain("oldText not found");
  });

  it("rejects edit outside assigned scope", async () => {
    await writeFile(join(workspace, "secret.txt"), "data", "utf-8");
    const ctx = makeContext(workspace, { writeScope: ["src/**"] });
    const result = await editFileTool.execute(
      { path: "secret.txt", oldText: "data", newText: "hacked" },
      ctx,
    );
    expect(result).toContain("Error");
    expect(result).toContain("Write denied");
  });

  it("replaces only the first occurrence when multiple exist", async () => {
    await writeFile(join(workspace, "dup.txt"), "aaa bbb aaa", "utf-8");
    const ctx = makeContext(workspace);
    const result = await editFileTool.execute(
      { path: "dup.txt", oldText: "aaa", newText: "ccc" },
      ctx,
    );
    expect(result).toContain("first of 2 occurrences");
    const content = await readFile(join(workspace, "dup.txt"), "utf-8");
    expect(content).toBe("ccc bbb aaa");
  });

  it("rejects path traversal outside workspace", async () => {
    const ctx = makeContext(workspace);
    const result = await editFileTool.execute(
      { path: "../../../etc/passwd", oldText: "root", newText: "evil" },
      ctx,
    );
    expect(result).toContain("Error");
    expect(result).toContain("outside the workspace");
  });
});

// ===========================================================================
// search_files
// ===========================================================================

describe("search_files", () => {
  it("finds matching lines in workspace files", async () => {
    await writeFile(join(workspace, "hello.ts"), 'const greeting = "hello";\n', "utf-8");
    const ctx = makeContext(workspace);
    const result = await searchFilesTool.execute({ pattern: "greeting" }, ctx);
    expect(result).toContain("hello.ts");
    expect(result).toContain("greeting");
  });

  it("returns no matches message when nothing found", async () => {
    await writeFile(join(workspace, "empty.txt"), "nothing here\n", "utf-8");
    const ctx = makeContext(workspace);
    const result = await searchFilesTool.execute({ pattern: "zzzznotfound" }, ctx);
    expect(result).toBe("No matches found");
  });

  it("returns error for invalid regex", async () => {
    const ctx = makeContext(workspace);
    const result = await searchFilesTool.execute({ pattern: "[invalid" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("invalid regex");
  });

  it("filters files by glob pattern", async () => {
    await writeFile(join(workspace, "a.ts"), "match\n", "utf-8");
    await writeFile(join(workspace, "b.js"), "match\n", "utf-8");
    const ctx = makeContext(workspace);
    const result = await searchFilesTool.execute({ pattern: "match", glob: "**/*.ts" }, ctx);
    expect(result).toContain("a.ts");
    expect(result).not.toContain("b.js");
  });

  it("respects maxResults limit", async () => {
    // Create a file with many matching lines.
    const lines = Array.from({ length: 20 }, (_, i) => `line${i} match`).join("\n");
    await writeFile(join(workspace, "many.txt"), lines, "utf-8");
    const ctx = makeContext(workspace);
    const result = await searchFilesTool.execute({ pattern: "match", maxResults: 3 }, ctx);
    const matchLines = result.split("\n");
    expect(matchLines.length).toBe(3);
  });

  it("returns error when pattern field is missing", async () => {
    const ctx = makeContext(workspace);
    const result = await searchFilesTool.execute({}, ctx);
    expect(result).toContain("Error");
  });
});

// ===========================================================================
// list_files
// ===========================================================================

describe("list_files", () => {
  it("lists files in the workspace", async () => {
    await writeFile(join(workspace, "a.txt"), "", "utf-8");
    await writeFile(join(workspace, "b.txt"), "", "utf-8");
    const ctx = makeContext(workspace);
    const result = await listFilesTool.execute({}, ctx);
    expect(result).toContain("a.txt");
    expect(result).toContain("b.txt");
  });

  it("returns no files message for non-matching glob", async () => {
    await writeFile(join(workspace, "a.txt"), "", "utf-8");
    const ctx = makeContext(workspace);
    const result = await listFilesTool.execute({ glob: "**/*.rs" }, ctx);
    expect(result).toBe("No files found matching the pattern");
  });

  it("filters files by glob pattern", async () => {
    await writeFile(join(workspace, "app.ts"), "", "utf-8");
    await writeFile(join(workspace, "style.css"), "", "utf-8");
    const ctx = makeContext(workspace);
    const result = await listFilesTool.execute({ glob: "**/*.ts" }, ctx);
    expect(result).toContain("app.ts");
    expect(result).not.toContain("style.css");
  });

  it("respects maxResults limit", async () => {
    for (let i = 0; i < 5; i++) {
      await writeFile(join(workspace, `file${i}.txt`), "", "utf-8");
    }
    const ctx = makeContext(workspace);
    const result = await listFilesTool.execute({ maxResults: 2 }, ctx);
    expect(result).toContain("Showing 2 of 5");
  });

  it("lists files in subdirectories", async () => {
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "src", "index.ts"), "", "utf-8");
    const ctx = makeContext(workspace);
    const result = await listFilesTool.execute({}, ctx);
    expect(result).toContain("src/index.ts");
  });
});

// ===========================================================================
// exec_command (shell-exec)
// ===========================================================================

describe("exec_command", () => {
  it("executes a simple command successfully", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "echo hello" }, ctx);
    expect(result).toBe("hello");
  });

  it("returns error for empty command", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "   " }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("must not be empty");
  });

  it("rejects path traversal with ../", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "cat ../etc/passwd" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("path traversal");
  });

  it("rejects access to /etc", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "cat /etc/hostname" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("/etc");
  });

  it("rejects access to /proc", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "cat /proc/cpuinfo" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("/proc");
  });

  it("rejects home directory expansion", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "ls ~/" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("home directory");
  });

  it("rejects cd / directory escape", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "cd /tmp && ls" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("directory escape");
  });

  it("captures combined stdout and stderr", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "echo out && echo err >&2" }, ctx);
    expect(result).toContain("out");
    expect(result).toContain("err");
  });

  it("returns error for non-zero exit code", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "exit 42" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("exited with code");
  });

  it("returns (no output) for silent command", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({ command: "true" }, ctx);
    expect(result).toBe("(no output)");
  });

  it("returns error when input is missing command field", async () => {
    const ctx = makeContext(workspace);
    const result = await shellExecTool.execute({}, ctx);
    expect(result).toContain("Error");
  });
});

// ===========================================================================
// read_memory
// ===========================================================================

describe("read_memory", () => {
  it("reads an existing shared memory file", async () => {
    const memDir = join(workspace, ".loomflo", "shared-memory");
    await mkdir(memDir, { recursive: true });
    await writeFile(join(memDir, "DECISIONS.md"), "# Decisions\nUse TypeScript", "utf-8");
    const ctx = makeContext(workspace);
    const result = await memoryReadTool.execute({ name: "DECISIONS.md" }, ctx);
    expect(result).toContain("# Decisions");
    expect(result).toContain("Use TypeScript");
  });

  it("returns error for non-existent memory file", async () => {
    const ctx = makeContext(workspace);
    const result = await memoryReadTool.execute({ name: "NOPE.md" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  it("rejects path traversal with slash", async () => {
    const ctx = makeContext(workspace);
    const result = await memoryReadTool.execute({ name: "../secret.txt" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("must not contain path separators");
  });

  it("rejects path traversal with backslash", async () => {
    const ctx = makeContext(workspace);
    const result = await memoryReadTool.execute({ name: "..\\secret.txt" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("must not contain path separators");
  });

  it("rejects name containing ..", async () => {
    const ctx = makeContext(workspace);
    const result = await memoryReadTool.execute({ name: "foo..bar" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain('".."');
  });

  it("returns error when name field is missing", async () => {
    const ctx = makeContext(workspace);
    const result = await memoryReadTool.execute({}, ctx);
    expect(result).toContain("Error");
  });
});

// ===========================================================================
// write_memory
// ===========================================================================

describe("write_memory", () => {
  it("appends content to a new shared memory file", async () => {
    const ctx = makeContext(workspace);
    const result = await memoryWriteTool.execute(
      { name: "PROGRESS.md", content: "Step 1 done" },
      ctx,
    );
    expect(result).toContain("Successfully appended");
    const filePath = join(workspace, ".loomflo", "shared-memory", "PROGRESS.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("Step 1 done");
    expect(content).toContain("test-agent");
  });

  it("creates the shared-memory directory if it does not exist", async () => {
    const ctx = makeContext(workspace);
    const result = await memoryWriteTool.execute({ name: "NEW.md", content: "first entry" }, ctx);
    expect(result).toContain("Successfully appended");
    const filePath = join(workspace, ".loomflo", "shared-memory", "NEW.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("first entry");
  });

  it("rejects path traversal with slash", async () => {
    const ctx = makeContext(workspace);
    const result = await memoryWriteTool.execute({ name: "../evil.md", content: "bad" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("must not contain path separators");
  });

  it("rejects path traversal with ..", async () => {
    const ctx = makeContext(workspace);
    const result = await memoryWriteTool.execute({ name: "x..y", content: "bad" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain('".."');
  });

  it("appends multiple entries sequentially", async () => {
    const ctx = makeContext(workspace);
    await memoryWriteTool.execute({ name: "LOG.md", content: "entry 1" }, ctx);
    await memoryWriteTool.execute({ name: "LOG.md", content: "entry 2" }, ctx);
    const filePath = join(workspace, ".loomflo", "shared-memory", "LOG.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("entry 1");
    expect(content).toContain("entry 2");
  });
});

// ===========================================================================
// send_message
// ===========================================================================

describe("send_message", () => {
  /** Stub message bus that records calls. */
  function makeStubBus(shouldReject = false): MessageBusLike & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
      calls,
      async send(from: string, to: string, nodeId: string, content: string): Promise<void> {
        calls.push([from, to, nodeId, content]);
        if (shouldReject) {
          throw new Error("bus error");
        }
      },
    };
  }

  it("sends a message and returns confirmation", async () => {
    const bus = makeStubBus();
    const tool = createSendMessageTool(bus);
    const ctx = makeContext(workspace);
    const result = await tool.execute({ to: "other-agent", content: "hello" }, ctx);
    expect(result).toContain("Message sent");
    expect(result).toContain("from: test-agent");
    expect(result).toContain("to: other-agent");
    expect(result).toContain("node: test-node");
    expect(bus.calls).toHaveLength(1);
    expect(bus.calls[0]).toEqual(["test-agent", "other-agent", "test-node", "hello"]);
  });

  it("returns error when bus rejects delivery", async () => {
    const bus = makeStubBus(true);
    const tool = createSendMessageTool(bus);
    const ctx = makeContext(workspace);
    const result = await tool.execute({ to: "bad-agent", content: "msg" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("message bus rejected");
  });

  it("returns error when required fields are missing", async () => {
    const bus = makeStubBus();
    const tool = createSendMessageTool(bus);
    const ctx = makeContext(workspace);
    const result = await tool.execute({ to: "agent" }, ctx);
    expect(result).toContain("Error");
    expect(bus.calls).toHaveLength(0);
  });

  it("uses context agentId and nodeId in the message", async () => {
    const bus = makeStubBus();
    const tool = createSendMessageTool(bus);
    const ctx = makeContext(workspace, { agentId: "looma-1", nodeId: "node-5" });
    const result = await tool.execute({ to: "loomi-1", content: "done" }, ctx);
    expect(result).toContain("from: looma-1");
    expect(result).toContain("node: node-5");
    expect(bus.calls[0]![0]).toBe("looma-1");
    expect(bus.calls[0]![2]).toBe("node-5");
  });
});

// ===========================================================================
// report_complete
// ===========================================================================

describe("report_complete", () => {
  /** Stub handler that records calls. */
  function makeStubHandler(shouldReject = false): CompletionHandlerLike & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
      calls,
      async reportComplete(agentId, nodeId, report): Promise<void> {
        calls.push([agentId, nodeId, report]);
        if (shouldReject) {
          throw new Error("handler error");
        }
      },
    };
  }

  it("reports completion with summary", async () => {
    const handler = makeStubHandler();
    const tool = createReportCompleteTool(handler);
    const ctx = makeContext(workspace);
    const result = await tool.execute({ summary: "Implemented feature X" }, ctx);
    expect(result).toContain("Completion reported");
    expect(result).toContain("agent: test-agent");
    expect(result).toContain("status: success");
    expect(handler.calls).toHaveLength(1);
  });

  it("includes files created and modified in the report", async () => {
    const handler = makeStubHandler();
    const tool = createReportCompleteTool(handler);
    const ctx = makeContext(workspace);
    const result = await tool.execute(
      {
        summary: "Done",
        filesCreated: ["src/new.ts"],
        filesModified: ["src/old.ts"],
        status: "success",
      },
      ctx,
    );
    expect(result).toContain("created: src/new.ts");
    expect(result).toContain("modified: src/old.ts");
  });

  it("returns error when handler rejects", async () => {
    const handler = makeStubHandler(true);
    const tool = createReportCompleteTool(handler);
    const ctx = makeContext(workspace);
    const result = await tool.execute({ summary: "something" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("handler rejected");
  });

  it("defaults to success status and empty file lists", async () => {
    const handler = makeStubHandler();
    const tool = createReportCompleteTool(handler);
    const ctx = makeContext(workspace);
    await tool.execute({ summary: "minimal" }, ctx);
    const report = handler.calls[0]![2] as {
      status: string;
      filesCreated: string[];
      filesModified: string[];
    };
    expect(report.status).toBe("success");
    expect(report.filesCreated).toEqual([]);
    expect(report.filesModified).toEqual([]);
  });

  it("supports partial status", async () => {
    const handler = makeStubHandler();
    const tool = createReportCompleteTool(handler);
    const ctx = makeContext(workspace);
    const result = await tool.execute({ summary: "partial work", status: "partial" }, ctx);
    expect(result).toContain("status: partial");
  });

  it("returns error when summary field is missing", async () => {
    const handler = makeStubHandler();
    const tool = createReportCompleteTool(handler);
    const ctx = makeContext(workspace);
    const result = await tool.execute({}, ctx);
    expect(result).toContain("Error");
    expect(handler.calls).toHaveLength(0);
  });
});

// ===========================================================================
// escalate
// ===========================================================================

describe("escalate", () => {
  /** Stub handler that records calls. */
  function makeStubHandler(shouldReject = false): EscalationHandlerLike & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
      calls,
      async escalate(request): Promise<void> {
        calls.push([request]);
        if (shouldReject) {
          throw new Error("handler error");
        }
      },
    };
  }

  it("submits an escalation with reason", async () => {
    const handler = makeStubHandler();
    const tool = createEscalateTool(handler);
    const ctx = makeContext(workspace);
    const result = await tool.execute({ reason: "Node failed after retries" }, ctx);
    expect(result).toContain("Escalation submitted");
    expect(result).toContain("agent: test-agent");
    expect(result).toContain("node: test-node");
    expect(result).toContain("Node failed after retries");
    expect(handler.calls).toHaveLength(1);
  });

  it("includes suggested action in the response", async () => {
    const handler = makeStubHandler();
    const tool = createEscalateTool(handler);
    const ctx = makeContext(workspace);
    const result = await tool.execute({ reason: "blocked", suggestedAction: "skip_node" }, ctx);
    expect(result).toContain("suggested: skip_node");
  });

  it("passes details and context identifiers to handler", async () => {
    const handler = makeStubHandler();
    const tool = createEscalateTool(handler);
    const ctx = makeContext(workspace, { agentId: "loomi-3", nodeId: "node-7" });
    await tool.execute(
      { reason: "stuck", details: "extra info", suggestedAction: "add_node" },
      ctx,
    );
    const request = handler.calls[0]![0] as {
      reason: string;
      nodeId: string;
      agentId: string;
      suggestedAction: string;
      details: string;
    };
    expect(request.reason).toBe("stuck");
    expect(request.nodeId).toBe("node-7");
    expect(request.agentId).toBe("loomi-3");
    expect(request.suggestedAction).toBe("add_node");
    expect(request.details).toBe("extra info");
  });

  it("returns error when handler rejects", async () => {
    const handler = makeStubHandler(true);
    const tool = createEscalateTool(handler);
    const ctx = makeContext(workspace);
    const result = await tool.execute({ reason: "problem" }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("handler rejected");
  });

  it("returns error when reason field is missing", async () => {
    const handler = makeStubHandler();
    const tool = createEscalateTool(handler);
    const ctx = makeContext(workspace);
    const result = await tool.execute({}, ctx);
    expect(result).toContain("Error");
    expect(handler.calls).toHaveLength(0);
  });
});
