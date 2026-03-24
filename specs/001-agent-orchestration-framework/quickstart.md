# Quickstart: Loomflo

## Install

```bash
npm install -g loomflo
```

## Run

```bash
# 1. Set your API key
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# 2. Start the daemon
loomflo start

# 3. Initialize a project
loomflo init "Build a REST API with auth, user management, and PostgreSQL"
```

The daemon starts, Loom generates a complete spec and execution graph, and opens the dashboard in your browser. Review the spec, confirm, and watch your project build itself.

## What Happens Next

1. **Review the spec** — The dashboard shows the generated constitution, functional spec, technical plan, task list, and coherence analysis. Read through them.
2. **Review the graph** — The Graph page shows all execution nodes with their connections, instructions, and estimated costs. Click any node to see its details.
3. **Confirm execution** — When satisfied, confirm in the dashboard or run `loomflo chat "proceed with execution"`.
4. **Watch it build** — Nodes activate in order. Workers write code, reviewers check quality, and the graph may evolve as the Architect adapts to discoveries.
5. **Chat anytime** — Run `loomflo chat "use bcrypt for password hashing"` to give instructions mid-execution.

## Key Commands

```bash
loomflo start                          # Start the daemon
loomflo stop                           # Stop the daemon (graceful)
loomflo init "description"             # Start a new project
loomflo chat "message"                 # Chat with Loom
loomflo status                         # View workflow state + costs
loomflo resume                         # Resume after interruption
loomflo config set budgetLimit 20      # Set budget to $20
loomflo dashboard                      # Open the web dashboard
loomflo logs node-3                    # View agent logs for a node
```

## Configuration

Create `~/.loomflo/config.json` for global defaults:

```json
{
  "models": {
    "loom": "claude-opus-4-6",
    "loomi": "claude-sonnet-4-6",
    "looma": "claude-sonnet-4-6",
    "loomex": "claude-sonnet-4-6"
  },
  "reviewerEnabled": true,
  "budgetLimit": null,
  "defaultDelay": "0",
  "dashboardPort": 3000
}
```

Or pass flags per-run:

```bash
loomflo init "Build a todo app" --no-reviewer --budget 5
```

## Development (from source)

```bash
git clone https://github.com/your-org/loomflo.git
cd loomflo
pnpm install && pnpm build
```
