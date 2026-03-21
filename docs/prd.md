# Product Requirements Document: @shizziio/agent-kit

## Document Info

| Field | Value |
|---|---|
| Product Name | @shizziio/agent-kit |
| CLI Command | agentkit |
| Version | 1.0.0 |
| Author | Shizziio |
| Date | 2026-03-07 |
| Last Updated | 2026-03-20 |
| Status | Release Candidate |
| Doc Version | 2 |

---

## 1. Product Overview

### 1.1 Problem Statement

The project-automation project uses shell scripts to orchestrate a multi-agent pipeline for software development. The old architecture has many serious issues:

- **File-based state management**: Uses the filesystem as queue, state, and worker. Loses linkage between steps when files are moved/deleted.
- **No visibility**: `claude -p` runs headless, with no way to see what the agent is doing.
- **Hardcoded prompts**: Prompts are tightly coupled to a specific project and cannot be reused.
- **Platform dependency**: Depends on iTerm2 (macOS).
- **No data persistence**: Files are moved/deleted when tasks complete — audit trail is lost.
- **No version tracking**: No way to tell if a story has changed when reloaded.

### 1.2 Solution

`@shizziio/agent-kit` — a professional npm package with:

- Database-backed pipeline (SQLite) replacing the file-based system
- Real-time streaming dashboard in the terminal (Ink/React TUI)
- Team-based architecture: config-driven pipeline flow for different projects/industries
- Multi-provider support: Claude CLI, Gemini CLI, Codex CLI
- Session continuity: resume provider sessions on retry, reducing token waste
- Story dependencies: automatically orchestrate execution order based on the dependency graph
- Priority queue: stories further along in the pipeline are processed first
- Global `~/.agentkit/` directory for teams and resources, decoupled from package installation path
- Full observability: task logs, trace, inspect, replay, diagnose

### 1.3 Target Users

Individual developers or small teams who want to automate software development workflows using AI agents.

---

## 2. Feature Set (v1.0)

### 2.1 Core Pipeline Engine

- **DB-backed queue**: SQLite + Drizzle ORM, atomic dequeue, WAL mode
- **Config-driven stages**: Team config.json defines pipeline flow (stages, routing, retries)
- **Task routing**: Automatic next stage, reject_to for rework, loop detection
- **Task chaining**: parent_id chain traces the entire execution process
- **Priority queue**: Stories further along in the pipeline are prioritized (priority auto-increment on route)
- **Story dependencies**: depends_on field, DAG validation, auto-queue when deps satisfied
- **Crash recovery**: Tasks in 'running' state on restart are reset to 'queued'
- **Graceful drain**: Finish current tasks, cancel queued, no new routing — no corrupted status

### 2.2 AI Providers

| Provider | CLI Tool | Output Mode | Session Support |
|---|---|---|---|
| ClaudeCliProvider | `claude` | Plain text (`--verbose`) | Yes |
| GeminiCliProvider | `gemini` | JSON output | Yes |
| CodexCliProvider | `codex` | Child process | No |

- **File-based output contract**: Provider writes output to file (`_agent_kit/.outputs/task-{id}.json`), stdout is only for display
- **3-tier fallback**: file → parseOutput(stdout) → failed
- **Session continuity**: Resume provider sessions on retry (reduce token waste)
- **Provider abstraction**: BaseProvider interface allows adding new providers
- **CLI installation check**: During `agentkit init`, the selected provider's CLI is verified. If not found, the user is warned and offered the option to skip

### 2.3 Multi-Team Architecture

- **Team config**: Each team has a config.json + prompts/ directory
- **1 bundled team**: Only `agentkit` ships bundled with the package
- **User-managed teams**: Other teams (agent-kit, google-veo3, janitor, ldj-cms) are user-managed in `~/.agentkit/teams/`
- **Global directory**: `~/.agentkit/` is created on first CLI run, syncs bundled resources (never overwrites user customizations)
- **Init team discovery**: `agentkit init` reads available teams from `~/.agentkit/teams/`, copies the selected team to the project
- **Runtime team switching**: Switch teams when workers are stopped
- **Task team isolation**: Tasks are tagged by team, dequeue filters by active team
- **Multi-provider models**: Each team defines allowed models per provider
- **Config v2 schema**: `activeTeam` + `teams[]` + models per provider

### 2.4 Unified Dashboard (TUI)

- **Fullscreen dashboard**: `agentkit start` clears terminal, renders 2x2 grid
- **BrandHeader**: ASCII logo + info bar (project, team, provider, pipeline status)
- **4 panels**: CommandMenu (TL), ActiveStories (TR), LiveActivity (BL), DiagnosePanel+PipelineCrew (BR)
- **Menu/submenu navigation**: Hierarchical menu with stack-based nav (Enter/→ enter, Q back)
- **Pipeline actions**: `[R] Run Pipeline` when stopped; when running: `[R] Drain Pipeline (finish current)` + `[F] Stop Pipeline (force)`
- **Inline wizards**: Load, Ship, Config, Diagnose — render in TL panel, no modal overlay
- **Trace mode**: Interactive tree browser (epic → story → task → logs)
- **Focus mode**: Fullscreen single panel
- **Pipeline Crew**: ASCII robot characters represent team members with animation
- **Event-driven updates**: DiagnosePanel re-scans on task:completed/failed, no polling
- **Non-TTY mode**: SimpleLogger outputs plain text for CI/CD

### 2.5 Story Lifecycle Management

| Action | Description |
|---|---|
| Load | Parse markdown → extract epics/stories → hash comparison → DB sync |
| Ship | Multi-select stories → create tasks at first stage → queue |
| Reset | Return story to earlier stage, soft-mark old tasks superseded |
| Cancel | Cancel story, delete queued tasks |
| Reopen | Reopen done/cancelled story for re-processing |
| Mark Done | User manually mark story as done |

- **Auto-discovery**: Scan current dir, `docs/`, `_agent_kit/docs/` for epic files
- **Epic artifact storage**: Epic artifacts stored in `_agentkit-output/planning/epic-{N}/`
- **Ship tree picker**: Multi-select across epics with arrow keys + space
- **Dependency orchestration**: Stories with unmet deps → `waiting` status → auto-queue when deps are done

### 2.6 Observability & Management

| Feature | Description |
|---|---|
| Diagnose | Pipeline health check, gap detection, loop_blocked recovery |
| Status | Quick pipeline status overview |
| History | Command execution history |
| Logs | Task logs viewer (filter by task/stage, follow mode) |
| Inspect | Full task context: metadata, parent chain, input/output, logs |
| Replay | Replay task execution timeline |
| Trace | Interactive tree browser (epic → story → task) |
| Cleanup | Remove superseded tasks, compact logs, reclaim space |
| Uninstall | Remove _agent_kit directory and all data |

### 2.7 CLI Commands

| Command | Description | Mode |
|---|---|---|
| `agentkit init` | Set up a new project | Interactive |
| `agentkit start` | Open the Unified Dashboard | Interactive |
| `agentkit run` | Start workers + dashboard/logger | Both |
| `agentkit load <file>` | Load epics/stories from markdown | Both |
| `agentkit ship [options]` | Ship stories into the pipeline | Both |
| `agentkit dashboard` | Open dashboard (without starting workers) | Interactive |
| `agentkit stop` | Stop workers | Non-interactive |
| `agentkit diagnose` | Pipeline diagnostics | Both |
| `agentkit status` | Quick pipeline status | Non-interactive |
| `agentkit history` | View task history | Both |
| `agentkit logs [options]` | View task logs | Both |
| `agentkit inspect <task-id>` | View full context of a task | Both |
| `agentkit replay <task-id>` | Replay execution process | Interactive |
| `agentkit trace` | Interactive trace browser | Interactive |
| `agentkit config` | View/edit settings | Both |
| `agentkit cleanup` | DB cleanup | Non-interactive |
| `agentkit update` | Update DB schema + resources | Non-interactive |
| `agentkit switch-team` | Switch active team | Non-interactive |
| `agentkit uninstall` | Remove project data | Interactive |
| `agentkit help [topic]` | Help system | Non-interactive |

**Global Options:**
- `--verbose` — Verbose logging (DEBUG level)
- `--team <name>` — Override active team
- `--provider <name>` — Override AI provider (claude-cli, gemini-cli, codex-cli)
- `--model <name>` — Override model for all stages

**Help Topics:** `agentkit help providers` — lists available providers (claude-cli, gemini-cli, codex-cli)

---

## 3. Technical Architecture

### 3.1 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js >= 18 (ESM) |
| Language | TypeScript 5.7+ |
| Database | SQLite (better-sqlite3) |
| ORM | Drizzle ORM |
| CLI Framework | Commander.js |
| Terminal UI | Ink 5 (React for CLI) + @inkjs/ui |
| AI Providers | Claude CLI, Gemini CLI, Codex CLI |
| Package | npm scoped (@shizziio/agent-kit) |
| Build | tsc + tsc-alias |
| Test | vitest |

### 3.2 Project Structure

> See `architecture.md` Section 1.3 for the full source layout.

```
@shizziio/agent-kit/
|-- src/
|   |-- cli/          # 23 CLI command handlers
|   |-- core/         # Business logic + db/
|   |-- workers/      # Pipeline workers + routing
|   |-- providers/    # AI provider adapters
|   |-- ui/           # Ink TUI components
|   |-- shared/       # Neutral utilities
|   |-- config/       # Constants & defaults
|   +-- resources/    # Bundled teams & prompts
|-- tests/
|   |-- unit/
|   +-- integration/
|-- package.json
+-- tsconfig.json

Project runtime directories:
  _agent_kit/           # Runtime (config, db, teams, resources)
  _agentkit-output/     # Generated artifacts (epics)
  docs/                 # Project documentation (user managed)
  ~/.agentkit/          # Global directory (teams, resources)
```

### 3.3 Database Schema

> See `architecture.md` Section 2 for the full schema.

4 tables: `projects`, `epics`, `stories`, `tasks`, `task_logs`
7 migrations tracking schema evolution.

Key relationships:
- projects 1:N epics (CASCADE)
- epics 1:N stories (CASCADE)
- stories 1:N tasks
- tasks 1:N task_logs
- tasks self-reference via parent_id
- stories.depends_on → stories.story_key (soft ref)

### 3.4 Team Config Format

> See `architecture.md` Section 6 for the full config schemas.

```json
{
  "team": "agent-kit",
  "displayName": "AgentKit Development",
  "version": 1,
  "models": {
    "claude-cli": {
      "allowed": ["opus", "sonnet", "haiku"],
      "defaults": { "sm": "sonnet", "dev": "opus", "review": "sonnet", "tester": "haiku" }
    },
    "gemini-cli": {
      "allowed": ["gemini-2.5-pro", "gemini-3-flash"],
      "defaults": { "sm": "gemini-3-flash", "dev": "gemini-2.5-pro" }
    }
  },
  "stages": [
    { "name": "sm", "next": "dev", "workers": 1, "retries": 0, "timeout": 3600 },
    { "name": "dev", "next": "review", "workers": 1, "retries": 0, "timeout": 3600 },
    { "name": "review", "next": "tester", "workers": 1, "retries": 0, "timeout": 300, "reject_to": "dev" },
    { "name": "tester", "workers": 2, "retries": 3, "timeout": 300, "reject_to": "dev", "reset_to": ["sm", "dev"] }
  ]
}
```

### 3.5 Project Config Format

File: `_agent_kit/agentkit.config.json`

```json
{
  "version": 2,
  "project": { "name": "my-app", "owner": "Shizziio" },
  "activeTeam": "agent-kit",
  "teams": ["agent-kit"],
  "provider": "claude-cli",
  "models": {
    "claude-cli": { "sm": "sonnet", "dev": "opus", "review": "sonnet", "tester": "haiku" }
  }
}
```

---

## 4. User Flows

### 4.1 First-time Setup: `agentkit init`

1. Display welcome screen
2. Ask for project_name (required, unique)
3. Ask for owner (optional)
4. Choose team template (discover teams from `~/.agentkit/teams/`)
5. Choose AI provider (claude-cli, gemini-cli, codex-cli)
6. Check provider CLI installation — warn if not found, offer to skip
7. Display default model assignment for each stage
8. User chooses [Y] Use defaults or [C] Customize
9. If Customize: interactive select for each stage, showing only allowed models
10. Generate `_agent_kit/` folder with config, database, and team resources
11. Display next steps

Generated structure:
```
_agent_kit/
|-- agentkit.config.json
|-- agentkit.db
|-- resources/          # Team prompts & resources (copied from ~/.agentkit/)
+-- logs/
    +-- agentkit.log
_agentkit-output/
+-- planning/           # Epic artifacts (epic-{N}/)
```

### 4.2 Unified Dashboard: `agentkit start`

Clears terminal → renders fullscreen Unified Dashboard. This is the main interface.

**Layout:** BrandHeader + 2x2 Grid
- TL: CommandMenuPanel (menu/submenu navigation + inline wizards)
- TR: ActiveStoriesPanel (stories table)
- BL: LiveActivityPanel (app logs + stream events)
- BR: DiagnosePanel + PipelineCrew (diagnostics + ASCII robots)

**Menu navigation:** Arrow keys, Enter/→ enter, Q back.

**Modes:**
- Overview (default): 4 panels
- Trace: Tree browser (epic → story → task)
- Focus: Fullscreen single panel

### 4.3 Load Epics & Stories

1. User selects Load from menu
2. System automatically scans directories to find epic files
3. Displays list of found files + [Manual entry]
4. Parser reads markdown, extracts epics and stories
5. Hash comparison with database: NEW (green), UPDATED (yellow), SKIP (gray)
6. User confirms → save to database

Supports: markdown files, folder-based epic structure, drag & drop.

### 4.4 Ship Stories

1. User selects Ship from menu
2. Ship tree picker: multi-select stories across epics
3. Stories currently in_progress display a warning
4. Stories with unmet dependencies → status `waiting`
5. Create tasks with status 'queued' at first stage

### 4.5 Pipeline Execution

1. User starts workers from dashboard (R key) or `agentkit run`
2. Workers poll database for queued tasks
3. When picking a task:
   - Load prompt template, inject task input + output file path
   - Check session resume (if retry + sessionSupport)
   - Execute via provider (stream events → Live Activity)
   - Collect output (file → stdout fallback → failed)
   - Route to next stage or reject_to
4. DependencyResolver auto-queues stories when deps are satisfied
5. Graceful drain: finish current, cancel queued

### 4.6 Story Lifecycle Actions

From the dashboard menu "Epic & Story Management":
- **Mark Done**: User manually marks story as done
- **Reset Story**: Reset to earlier stage (configurable via `reset_to`)
- **Cancel Story**: Cancel, remove from pipeline

From Trace mode:
- Navigate tree, inspect tasks, view logs, replay

---

## 5. Dashboard UI Specification

### 5.1 Layout Structure

```
+-- BrandHeader ------------------------------------------------+
|            ╔═╗                                                 |
|  AGENT     ╚═╝  KIT      project · team · provider · status   |
+----------------------------------------------------------------+
|  TL: CommandMenuPanel    |  TR: ActiveStoriesPanel             |
|                          |                                     |
|  Main Menu               |  # Story          Stage  Status Dur |
|  > Load Story            |  1 Registration   test   ● RUN  07:|
|    Ship Story            |  2 Login          dev    ◷ QUEUE   |
|    Epic & Story Mgmt ─►  |  3 Password       sm     ○ idle    |
|    Task Management   ─►  |                                     |
|    Diagnose              |                                     |
|    Config            ─►  |                                     |
|    Ask Agent             |                                     |
|    Help                  |                                     |
|    Quit                  |                                     |
+---------------------------+-------------------------------------+
|  BL: LiveActivityPanel   |  BR: DiagnosePanel + PipelineCrew   |
|                          |                                     |
|  14:30:22 ℹ Workers up   |  Queue: 3 pending, 1 running       |
|  14:30:25 📖 Read: src/  |  Issues: 0 gaps, 0 blocked         |
|  14:30:26 ✏️ Edit: src/  |                                     |
|  14:30:28 ⚡ npm test     |  [🤖] [🤖] [🤖] [🤖]              |
|  14:31:45 ✅ Task #5 done |   SM   Dev  Rev  Test              |
+---------------------------+-------------------------------------+
```

### 5.2 Responsive Layout

- Small (< 100 cols): CompactLayout — stacked vertical
- Medium+ (>= 100 cols): GridLayout — 2x2 panels

### 5.3 Keyboard Shortcuts

#### Dashboard Navigation

| Key | Action |
|---|---|
| Tab / Shift+Tab | Switch focus between panels |
| 1-4 | Jump to panel |
| T | Toggle Trace mode |
| F | Toggle Focus mode |
| R | Run Pipeline (when stopped) / Drain Pipeline (when running) |
| F | Stop Pipeline — force stop (when running) |
| Q | Quit (from main menu) / Back (from submenu) |

#### Menu Navigation

| Key | Action |
|---|---|
| ↑↓ | Navigate menu items |
| Enter / → | Enter submenu or run action |
| Q | Back to parent menu |

#### Trace Mode

| Key | Action |
|---|---|
| ↑↓ | Navigate tree |
| ←→ | Collapse/expand nodes |
| i | Inspect task |
| l | View task logs |
| r | Replay task |
| V | Toggle superseded tasks visibility |
| Q | Back to Overview |

---

## 6. Data Formats

### 6.1 Epic/Story Markdown Format

```markdown
## Epic N: {epic_title}
{epic description}

### Story N.M: {story_title}
{story content — full markdown block}
```

### 6.2 Parser Output

```typescript
interface ParsedContent {
  epics: {
    key: string           // "1", "2"
    title: string
    description: string
    contentHash: string   // SHA-256
    stories: {
      key: string         // "1.1", "1.2"
      title: string
      content: string     // Full markdown block
      contentHash: string // SHA-256
    }[]
  }[]
}
```

### 6.3 Comparison Logic

1. Parse markdown → extract epics + stories
2. Hash each block's content (SHA-256)
3. Compare with database:
   - Story key does not exist → **NEW**
   - Story key exists, hash differs → **UPDATED**
   - Story key exists, hash matches → **SKIP**

---

## 7. Non-functional Requirements

### 7.1 Performance

- Dashboard render < 16ms (60fps)
- Database query < 50ms
- Worker poll interval: 3s default, 30s max backoff
- Stream event latency: < 100ms provider → UI
- TaskLog batch write: 500ms flush interval

### 7.2 Reliability

- SQLite WAL mode for concurrent read/write
- Atomic task claiming (transaction-based dequeue)
- Graceful shutdown: Ctrl+C → finish active → save state
- Graceful drain: finish current, cancel queued
- Crash recovery: running tasks → reset to queued on startup
- Session continuity: resume sessions on retry

### 7.3 Compatibility

- Node.js >= 18 LTS
- macOS, Linux, Windows (WSL)
- Terminal: any terminal supporting ANSI escape codes
- Non-TTY: SimpleLogger mode for CI/CD

### 7.4 Data Integrity

- Version column on every table
- Content hash for change detection
- Parent_id chain for full task traceability
- Soft-delete (superseded) instead of hard delete
- Transaction for every state transition
- 7 migrations tracking schema evolution

---

## 8. Future Roadmap (Post v1.0)

### Phase 2: More Teams & Custom Teams

- Add bundled teams for other industries
- CLI `agentkit create-team` chatbot workflow

### Phase 3: API Providers

- ClaudeApiProvider (APIProvider type — tool execution loop)
- OllamaProvider
- OpenAI API Provider

### Phase 4: Extensions

- Extension loader + interface system
- Notification extensions (Telegram, Lark, Slack)
- Bot integration extensions

### Phase 5: Distribution & CI

- GitHub Actions CI/CD (test, build, publish)
- npm publish workflow
- `npx @shizziio/agent-kit init` public availability

### Phase 6: Advanced

- Web dashboard (subscribe to the same EventBus)
- Remote execution
- Analytics dashboard (task performance, model comparison)
- Multi-user support

---

## 9. Glossary

| Term | Definition |
|---|---|
| project | A project managed by agentkit |
| team | A config set defining pipeline flow + prompts |
| stage | A step in the pipeline (sm, dev, review, tester) |
| task | The smallest unit of work, belonging to 1 story + 1 stage |
| story | A user requirement, containing multiple tasks |
| epic | A group of related stories |
| provider | An adapter connecting to an AI service |
| worker | A process that handles tasks at a given stage |
| queue | A waiting list of tasks to be processed (priority-based) |
| pipeline | The entire flow from the first stage to the last stage |
| ship | Send stories into the pipeline for processing |
| load | Import epics/stories from a file into the database |
| route | Move a task from one stage to another |
| reject | Review/Tester sends a task back to a previous stage |
| reset | Return a story to a previous stage (user manual action) |
| cancel | Cancel a story, remove it from the pipeline |
| superseded | An old task replaced by a newer attempt (soft-mark) |
| mark-done | Mark a story as complete (user manual action) |
| drain | Graceful stop: finish current, cancel queued, no new routing |
| session | Provider conversation identifier for session continuity |
| depends_on | Story dependency — wait for another story to complete first |
| priority | Queue ordering — stories further along in the pipeline are prioritized |
| brand | Display information (ASCII logo, project name, team) |
| mode | The display state of the dashboard (overview/trace/focus) |

---

## 10. Development History (24 Epics)

| Epic | Title | Key Deliverables |
|---|---|---|
| 1 | Project Foundation | Scaffolding, DB schema, ConfigLoader, Init wizard |
| 2 | Data Loading | Markdown parser, Load command, hash comparison |
| 3 | CLI & Interactive Menu | 14 CLI commands, interactive menu, Ship, Help |
| 4 | Pipeline Engine | EventBus, Queue, ClaudeCliProvider, StageWorker, Router, TaskLogs, Crash Recovery |
| 5 | Dashboard UI | Ink shell, panels (Pipeline Flow, Active Stories, Live Activity), Alert, SimpleLogger |
| 6 | Management & Observability | Diagnose, Status, History, Logs, Inspect, Replay, Trace, Cleanup, Uninstall |
| 7 | Unified Dashboard & Logging | Logger service, UnifiedApp, hotkey nav, modal overlay, trace/focus modes |
| 8 | Dashboard Command Center | 2x2 grid, inline actions, DiagnosePanel, folder-based epics, plain text provider, output capture |
| 9 | Dashboard UX Overhaul | CommandMenu (replace PipelineFlow), state isolation, Ship tree picker |
| 10 | Story Lifecycle | ResetService, Cancel/Reopen, reset_to config, superseded handling |
| 11 | Command Menu & Branding | Arrow nav, Mark Done, BrandHeader (ASCII logo), History/Replay inline, timezone |
| 12 | Multi-Team Support | Worker status API, terminate, multi-team config v2, task team isolation, switch team |
| 13 | File-Based Output Contract | OutputFileManager, OutputResolver, 3-channel architecture, {{OUTPUT_FILE}} injection |
| 14 | Consolidate Resources | src/resources/ centralization, unified ResourcePath |
| 15 | Bug Fixes & UX Polish | 13 fixes: story lifecycle, diagnose accuracy, replay stability, init flow, etc. |
| 16 | Menu/Submenu Navigation | Menu stack, submenus, ScrollablePanel, StatusBar removal, ChatPanel, folder rename _agent_kit |
| 17 | Dashboard Bug Fixes | 7 fixes: ModelConfig, SwitchTeam, ConfigViewer, trace keys, layout chrome |
| 18 | Auto-Migration & Update | Auto-migrate on startup, _agentkit_meta, agentkit update CLI |
| 19 | Session Continuity | session_info/session_name, provider sessionSupport, resume prompts |
| 20 | Story Queue Priority | stories.priority, dequeue ordering, auto-increment on route |
| 21 | Story Dependencies | depends_on, waiting status, DependencyResolver, DAG validation |
| 22 | Gemini Session Resume | GeminiCliProvider sessions, GeminiSessionResolver |
| 23 | Pipeline Crew | ASCII robot characters, animation, DiagnosePanel integration |
| 24 | Graceful Pipeline Drain | DrainSignal, cancelAllQueued, worker drain, UI drain action |

**Features outside epics:** CodexCliProvider, CompletionHandler separated from Router, ProcessManager, multi-provider models config, ChainInputBuilder, bundled teams (google-veo3, janitor, ldj-cms).
