import { Command } from "commander";
import { stat } from "node:fs/promises";
import { getRunningDaemon } from "../daemon-control.js";

interface ProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  status: string;
  startedAt: string;
}

export function createProjectCommand(): Command {
  const root = new Command("project").description("Manage Loomflo projects");

  root
    .command("list")
    .description("List projects known to the daemon")
    .action(async () => {
      const info = await getRunningDaemon();
      if (!info) {
        console.log("Daemon is not running.");
        return;
      }
      const res = await fetch(`http://127.0.0.1:${String(info.port)}/projects`, {
        headers: { authorization: `Bearer ${info.token}` },
      });
      const projects = (await res.json()) as ProjectSummary[];
      for (const p of projects) {
        console.log(`${p.id}\t${p.name}\t${p.status}\t${p.projectPath}`);
      }
    });

  root
    .command("remove <id>")
    .description("Remove a project from the daemon registry")
    .action(async (id: string) => {
      const info = await getRunningDaemon();
      if (!info) throw new Error("Daemon is not running.");
      const res = await fetch(`http://127.0.0.1:${String(info.port)}/projects/${id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${info.token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
      console.log(`Removed ${id}.`);
    });

  root
    .command("prune")
    .description("Remove projects whose directory no longer exists")
    .action(async () => {
      const info = await getRunningDaemon();
      if (!info) throw new Error("Daemon is not running.");
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
      console.log(`Pruned ${String(removed)} orphan project(s).`);
    });

  return root;
}
