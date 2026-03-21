# @shizziio/agent-kit

> **AI Pipeline Orchestrator** — Coordinate multi-stage AI agent workflows from your terminal.

---

## What is AgentKit?

AgentKit is an **orchestration tool** — it doesn't write code itself. Instead, it coordinates a team of AI agents through a configurable pipeline, managing the flow of work from planning to implementation to review to testing.

You define a **team** (a set of stages with prompts), load your **epics and stories**, and AgentKit handles everything else: queueing tasks, routing between stages, tracking state, managing retries, and giving you real-time visibility through a fullscreen terminal dashboard.

### Who is it for?

- **Solo developers** using AI assistants who want structured, repeatable workflows instead of ad-hoc prompting
- **Small teams** wanting to automate multi-step AI pipelines (planning → coding → review → testing)
- **Anyone** who needs to orchestrate AI agents across multiple stages with full traceability

### What does it actually do?

1. **You write stories** in markdown describing what needs to be built
2. **AgentKit loads them** into a database with change tracking
3. **You ship stories** to the pipeline queue
4. **AI agents execute** each stage sequentially (e.g., SM plans → Dev codes → Reviewer checks → Tester verifies)
5. **You watch it happen** in a real-time dashboard, or run it headless for CI/CD

```
Your Stories (markdown) → AgentKit Pipeline → AI Agents execute each stage
                              ↓
                    SM → Dev → Review → Tester
                              ↓
                    Real-time TUI Dashboard
```

---

## Key Concepts

| Concept | What it means |
|---------|---------------|
| **Team** | A pipeline configuration — defines stages, routing, models, and prompts |
| **Stage** | One step in the pipeline (e.g., "sm", "dev", "review", "tester") |
| **Story** | A unit of work loaded from markdown — flows through all stages |
| **Epic** | A group of related stories |
| **Task** | A story at a specific stage — the atomic unit of execution |
| **Provider** | The AI service that executes tasks (Claude CLI, Gemini CLI, or Codex CLI) |

---

## Requirements

- **Node.js** >= 18
- **One AI CLI tool** installed and authenticated:
  - [Claude CLI](https://github.com/anthropics/claude-code) (`claude`) — recommended
  - [Gemini CLI](https://github.com/anthropics/gemini-cli) (`gemini`)
  - [Codex CLI](https://github.com/openai/codex) (`codex`)

> **Important:** AgentKit checks for CLI availability during `agentkit init`. If your chosen provider CLI is not installed, the wizard will warn you with install instructions. You can skip the check, but the pipeline won't run without a working CLI.

---

## Installation

```bash
npm install -g @shizziio/agent-kit
```

Or install from source:

```bash
git clone https://github.com/shizziio1999/agentkit.git
cd agentkit
npm run reinstall
```

On first run, AgentKit creates `~/.agentkit/` with bundled teams and resources.

---

## Setting Up Your Project

### Step 1: Initialize

```bash
cd my-project
agentkit init
```

The wizard asks for project name, owner, and AI provider (Claude CLI, Gemini CLI, or Codex CLI).

This creates `_agent_kit/` (runtime) and `_agentkit-output/` (artifacts) in your project.

### Step 2: Guided Setup

```bash
agentkit start
```

On first start, AgentKit detects missing setup and shows a **Setup Menu** that guides you through 3 steps in order:

```
AgentKit v0.1.0 · Project Setup

  ✗ Project Documentation    0/3 required docs found
  ✗ Team Configuration       No teams configured
  ✗ Epic Plans               No epics planned
──────────────────────────────────────────────────
  > Setup Project Documentation
    Setup Team Configuration (Requires: Project Docs)
    Setup Epic Plans (Requires: Project Docs, Team Config)
    Skip — Continue to Dashboard
```

Each setup step launches your AI provider CLI (Claude/Gemini/Codex) in interactive mode with the relevant workflow pre-loaded. When done, exit the provider CLI and run `agentkit start` again.

**Step order matters:**
1. **Project Docs** — AI scans your codebase and generates `docs/architecture.md`, `docs/architecture-rules.md`, `docs/project-context.md`
2. **Team Config** — AI reads your docs, analyzes project structure, and suggests teams (e.g., `myapp-frontend`, `myapp-backend`) with appropriate stages and file ownership
3. **Epic Plans** — AI helps you design epics and stories in `_agentkit-output/planning/`

> You can also run these directly: `agentkit setup`, `agentkit planning`, `agentkit ask`

### Step 3: Load, Ship, Run

```bash
agentkit start

# From the dashboard menu:
#   [L] Load Story → load epic files into database
#   [S] Ship Story → select which stories to queue
#   [R] Run Pipeline → agents start executing
#   [R] Drain Pipeline → graceful stop (when running)
#   [F] Stop Pipeline → force stop (when running)
```

---

## Bundled Resources

After init, `_agent_kit/resources/` contains guides you can use with any AI assistant:

### Agents

| Agent | File | Use for |
|-------|------|---------|
| **AgentKit Master** | `agents/agent-kit-master.md` | Project Q&A, list/run workflows, health check |
| **Tech Writer** | `agents/tech-writer.md` | Scan codebase, generate architecture docs |
| **Architect** | `agents/architect.md` | System design, epic/story creation, contracts |
| **Analyst** | `agents/analyst.md` | Requirements gathering, research, gap analysis |
| **Project Manager** | `agents/project-manager.md` | Sprint planning, progress tracking |

All agents have **auto-start behavior**: they load project docs, greet you, show a menu, and wait for your input.

### Workflows

| Workflow | File | Use for |
|----------|------|---------|
| **Document Project** | `workflows/document-project.md` | **Start here** — generate docs/architecture.md, rules, context, PRD |
| **Planning** | `workflows/planning.md` | Create structured epics with story dependencies |
| **Team Setup** | `workflows/team-setup.md` | Quick reference for team creation phases |
| **Create Team** | `workflows/create-team.md` | Full interactive chatbot workflow for team creation |

---

## Project Structure

```
my-project/
├── docs/                      # Your project docs (AgentKit doesn't touch these)
├── _agent_kit/                # AgentKit runtime (gitignored)
│   ├── agentkit.config.json   # Project config (team, provider, models)
│   ├── agentkit.db            # SQLite database (all state)
│   ├── teams/{team}/          # Selected team config + prompts
│   ├── resources/             # Agents + workflow guides
│   │   ├── agents/            # Architect, Analyst, Project Manager
│   │   └── workflows/         # Planning, Team Setup, Create Team
│   └── logs/                  # Application logs
├── _agentkit-output/          # Generated artifacts (gitignored)
│   └── planning/              # Epic folders (epic-1/, epic-2/, ...)
└── .gitignore                 # Includes _agent_kit/ and _agentkit-output/
```

### Global Directory

`~/.agentkit/` stores teams and resources shared across all your projects:

```
~/.agentkit/
├── teams/           # Your custom teams (created via setup workflow)
│   ├── myapp-frontend/
│   └── myapp-backend/
└── resources/       # Agent definitions + workflow guides
    ├── agents/
    └── workflows/
```

Created automatically on first CLI run. Teams created in one project are available for reuse in other projects.

---

## Dashboard

`agentkit start` opens a fullscreen TUI with 4 panels:

```
┌─────────────────── BrandHeader ──────────────────────┐
│           project · team · provider · status          │
├──────────────┬───────────────────────────────────────┤
│  TL: Menu    │  TR: Active Stories                    │
│              │  (story progress, deps, priority)      │
├──────────────┼───────────────────────────────────────┤
│  BL: Live    │  BR: Diagnose + Pipeline Crew          │
│  Activity    │  (health check, ASCII robots)          │
└──────────────┴───────────────────────────────────────┘
```

### Menu Actions

| Key | Action |
|-----|--------|
| `L` | Load stories from markdown |
| `S` | Ship stories to pipeline |
| `R` | Run Pipeline (when stopped) / Drain Pipeline (when running) |
| `F` | Stop Pipeline (force) — when running |
| `G` | Epic & Story Management (mark done, reset, cancel) |
| `K` | Task Management (task list, trace, replay) |
| `D` | Diagnose pipeline health |
| `C` | Config (view, change team/provider/models) |
| `P` | Create Planning — launch architect agent interactively |
| `W` | Ask AgentKit — launch master agent interactively |
| `A` | Ask Agent (AI chat within dashboard) |
| `H` | Help |
| `Q` | Back / Quit |

---

## Commands

**Primary commands:**

| Command | Description |
|---------|-------------|
| `agentkit init` | Initialize a new project |
| `agentkit start` | Launch the dashboard (main entry point) |
| `agentkit setup` | Check project readiness and guided setup |
| `agentkit planning` | Launch interactive planning session with Architect agent |
| `agentkit ask` | Launch interactive session with AgentKit Master agent |
| `agentkit help` | Show help |
| `agentkit update` | Update schema + resources |

All other operations (load, ship, run, diagnose, trace, config, etc.) are available from the dashboard menu or can be run directly as `agentkit <command>`.

---

## Providers

| Provider | CLI | Session Resume | Models |
|----------|-----|----------------|--------|
| `claude-cli` | `claude` | Yes | opus, sonnet, haiku |
| `gemini-cli` | `gemini` | Yes | gemini-2.5-pro, gemini-3-flash, etc. |
| `codex-cli` | `codex` | No | o4-mini, o3, gpt-4.1, etc. |

Switch provider: `agentkit config` → Change Provider, or edit `agentkit.config.json`.

---

## How It Works

```
1. agentkit load stories.md
   → Parse markdown → hash content → store in SQLite

2. agentkit ship
   → Select stories → create tasks at first stage (queued)

3. agentkit run (or [R] in dashboard)
   → Workers poll queue → claim task → load prompt
   → Inject story content + previous stage output
   → Execute via AI provider (Claude/Gemini/Codex)
   → Collect output (file-based, 3-tier fallback)
   → Route to next stage (or reject back for rework)
   → Repeat until last stage → story done

4. Pipeline features:
   - Priority queue (stories further along go first)
   - Story dependencies (auto-queue when deps complete)
   - Session continuity (resume AI sessions on retry)
   - Loop detection (prevent infinite rework cycles)
   - Graceful drain (finish current, cancel queued)
   - Crash recovery (reset interrupted tasks on restart)
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Shizziio
