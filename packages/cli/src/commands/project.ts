import { Command } from "commander";
import { stat } from "node:fs/promises";
import { getRunningDaemon } from "../daemon-control.js";
import { withJsonSupport, isJsonMode, writeJson, writeError } from "../output.js";
import { theme, type Column } from "../theme/index.js";

interface ProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  status: string;
  startedAt: string;
}

export function createProjectCommand(): Command {
  const root = new Command("project").description("Manage Loomflo projects");

  const listCmd = root
    .command("list")
    .description("List projects known to the daemon");
  withJsonSupport(listCmd);
  listCmd.action(async (options: { json?: boolean }) => {
    const info = await getRunningDaemon();
    if (!info) {
      if (isJsonMode(options)) {
        writeJson({ projects: [] });
      } else {
        process.stdout.write(
          theme.line(theme.glyph.dot, "dim", "daemon is not running") + "\n",
        );
      }
      return;
    }
    const res = await fetch(`http://127.0.0.1:${String(info.port)}/projects`, {
      headers: { authorization: `Bearer ${info.token}` },
    });
    const projects = (await res.json()) as ProjectSummary[];
    if (isJsonMode(options)) {
      writeJson(projects);
    } else {
      const columns: Column<ProjectSummary>[] = [
        { header: "ID", get: (p) => p.id },
        { header: "NAME", get: (p) => p.name },
        { header: "STATUS", get: (p) => p.status },
        { header: "PATH", get: (p) => p.projectPath },
      ];
      process.stdout.write(
        theme.table(
          columns.map((c) => c.header),
          projects,
          columns,
        ) + "\n",
      );
    }
  });

  const removeCmd = root
    .command("remove")
    .argument("<id>", "Project ID to remove")
    .description("Remove a project from the daemon registry");
  withJsonSupport(removeCmd);
  removeCmd.action(async (id: string, options: { json?: boolean }) => {
    try {
      const info = await getRunningDaemon();
      if (!info) {
        writeError(options, "Daemon is not running.");
        process.exitCode = 1;
        return;
      }
      const res = await fetch(`http://127.0.0.1:${String(info.port)}/projects/${id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${info.token}` },
      });
      if (!res.ok) {
        writeError(options, `HTTP ${String(res.status)}`);
        process.exitCode = 1;
        return;
      }
      if (isJsonMode(options)) {
        writeJson({ removed: id });
      } else {
        process.stdout.write(
          theme.line(theme.glyph.check, "accent", `removed ${id}`) + "\n",
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      writeError(options, msg);
      process.exitCode = 1;
    }
  });

  const pruneCmd = root
    .command("prune")
    .description("Remove projects whose directory no longer exists");
  withJsonSupport(pruneCmd);
  pruneCmd.action(async (options: { json?: boolean }) => {
    try {
      const info = await getRunningDaemon();
      if (!info) {
        writeError(options, "Daemon is not running.");
        process.exitCode = 1;
        return;
      }
      const res = await fetch(`http://127.0.0.1:${String(info.port)}/projects`, {
        headers: { authorization: `Bearer ${info.token}` },
      });
      const projects = (await res.json()) as ProjectSummary[];
      let removed = 0;
      for (const p of projects) {
        const exists = await stat(p.projectPath)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          await fetch(`http://127.0.0.1:${String(info.port)}/projects/${p.id}`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${info.token}` },
          });
          removed++;
        }
      }
      if (isJsonMode(options)) {
        writeJson({ pruned: removed });
      } else {
        process.stdout.write(
          theme.line(theme.glyph.check, "accent", `pruned ${String(removed)} orphan project(s)`) + "\n",
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      writeError(options, msg);
      process.exitCode = 1;
    }
  });

  return root;
}
