# @shizziio/agent-kit — Architecture & Design Reference

## Document Info

| Field | Value |
|---|---|
| Product | @shizziio/agent-kit |
| Version | 1.0.0 |
| Last Updated | 2026-03-20 |

> **Role of this file:** System-level architecture reference — diagrams, type interfaces, provider/worker/config schemas, data flow.
> **For coding rules** (naming, TS rules, DB rules, EventBus, Logger, UI, Testing): see `architecture-rules.md`.

---

## 1. Architecture Overview

### 1.1 System Diagram

```
                         agentkit CLI (Commander.js)
                              |
              +---------------+----------------+
              |               |                |
          CLI Commands    Ink TUI App     Simple Logger
          (23 commands)      |           (non-TTY mode)
              |               |                |
              +-------+-------+--------+-------+
                      |                |
                  EventBus          ConfigLoader + ConfigService
                      |                |
              +-------+-------+--------+-------+
              |       |       |        |       |
           Pipeline  Queue  StateManager    Logger ─── log file
              |       |       |                |
              +---+---+---+---+           EventBus
                  |       |              (app:log events)
            StageWorker   DB (SQLite + Drizzle ORM)
                  |
            +-----+-----+
            |            |
          Router    CompletionHandler
            |
      Provider (BaseProvider interface)
            |
      +-----+-----+--------+
      |           |         |
ClaudeCliProvider GeminiCli CodexCli
      |              |         |
  Claude CLI    Gemini CLI  Codex CLI
  (--verbose)   (--json)    (child proc)

GlobalSetup ─── ensures ~/.agentkit/ exists, syncs bundled resources
```

### 1.2 Layer Rules

| Layer | Can Depend On | Cannot Depend On |
|---|---|---|
| cli/ | core/, ui/, providers/ | — |
| ui/ | core/ (via EventBus only) | providers/, cli/ |
| core/ | db/ | ui/, cli/, providers/ (except via interface) |
| providers/ | core/interfaces only | ui/, cli/, db/ |
| workers/ | core/, providers/ | ui/, cli/ |
| shared/ | nothing (neutral utilities) | any layer |
| db/ | — | anything else |

**Strictly forbidden**: The UI layer must NEVER import directly from providers/ or workers/. All communication must go through EventBus.

### 1.3 Source Layout

```
src/
|-- cli/                       # 23 CLI command handlers
|   |-- index.ts               # Commander.js entry point (bin)
|   |-- Init.ts                # agentkit init
|   |-- Start.ts               # agentkit start (unified dashboard)
|   |-- Run.ts                 # agentkit run (start workers + dashboard/logger)
|   |-- Load.ts                # agentkit load <file>
|   |-- Ship.ts                # agentkit ship [options]
|   |-- Dashboard.ts           # agentkit dashboard
|   |-- Diagnose.ts            # agentkit diagnose
|   |-- Status.ts              # agentkit status
|   |-- History.ts             # agentkit history
|   |-- Logs.ts                # agentkit logs [options]
|   |-- Inspect.ts             # agentkit inspect <task-id>
|   |-- Replay.ts              # agentkit replay <task-id>
|   |-- Trace.ts               # agentkit trace
|   |-- Config.ts              # agentkit config
|   |-- Cleanup.ts             # agentkit cleanup
|   |-- Update.ts              # agentkit update
|   |-- Stop.ts                # agentkit stop
|   |-- SwitchTeam.ts          # agentkit switch-team
|   |-- Uninstall.ts           # agentkit uninstall
|   |-- Help.ts                # agentkit help [topic]
|   |-- WorkerToggle.ts        # Start/stop workers from dashboard
|   +-- RequireInitialized.ts  # Shared guard: ensure project initialized
|
|-- core/                      # Business logic — NO UI dependencies
|   |-- EventBus.ts            # Typesafe singleton pub/sub
|   |-- EventTypes.ts          # Full event type definitions (EventMap)
|   |-- Queue.ts               # DB-backed: dequeue (atomic), cancelAllQueued
|   |-- QueueTypes.ts          # DequeueResult interface
|   |-- StateManager.ts        # Query: task chains, state
|   |-- ConfigLoader.ts        # Load, merge, validate config
|   |-- ConfigService.ts       # IConfigService: models, providers, env, settings
|   |-- ConfigValidator.ts     # Validate config integrity
|   |-- ConfigTypes.ts         # StageConfig, TeamConfig, ProjectConfig, PipelineConfig
|   |-- Parser.ts              # Markdown -> ParsedContent
|   |-- Logger.ts              # Dual-output: file + EventBus emit
|   |-- Errors.ts              # AgentKitError hierarchy
|   |-- LoadService.ts         # Load epics/stories from markdown
|   |-- ShipService.ts         # Ship stories into pipeline
|   |-- DiagnoseService.ts     # Pipeline diagnostics & auto-fix
|   |-- DiagnoseTypes.ts       # DiagnoseResult, DiagnoseIssue
|   |-- ResetService.ts        # Reset, cancel, reopen stories
|   |-- MarkDoneService.ts     # Mark story/epic done
|   |-- TraceService.ts        # Historical trace queries
|   |-- InspectService.ts      # Task/story inspection
|   |-- HistoryService.ts      # Command execution history
|   |-- CleanupService.ts      # DB cleanup (superseded tasks, compact logs)
|   |-- TeamSwitchService.ts   # Switch active team
|   |-- UpdateService.ts       # Update config/resources
|   |-- UninstallService.ts    # Remove project data
|   |-- EpicDiscovery.ts       # Auto-discover epic files from filesystem
|   |-- DependencyResolver.ts  # Story dependency DAG resolution
|   |-- DrainSignal.ts         # Shared drain flag for graceful shutdown
|   |-- GlobalSetup.ts         # Ensure ~/.agentkit/ exists, sync bundled resources
|   |-- PipelineTypes.ts       # RecoveryResult, ShutdownState
|   +-- db/
|       |-- schema.ts          # Drizzle table definitions (4 tables)
|       |-- Connection.ts      # createConnection: SQLite + WAL + auto-migrate
|       +-- migrations/        # 7 SQL migration files (0000-0006)
|
|-- providers/
|   |-- interfaces/
|   |   +-- BaseProvider.ts    # Contract: execute(), isAvailable(), SessionIdResolver
|   +-- agent/
|       |-- ClaudeCliProvider.ts   # Claude CLI: plain text mode (--verbose)
|       |-- GeminiCliProvider.ts   # Gemini CLI: JSON output mode
|       |-- CodexCliProvider.ts    # OpenAI Codex CLI
|       |-- ProcessManager.ts      # Centralized child process tracking
|       +-- GeminiSessionResolver.ts  # Gemini session name → ID resolution
|
|-- workers/
|   |-- Pipeline.ts            # Orchestrator: create workers, signal handlers, dependency resolver
|   |-- StageWorker.ts         # Poll loop, execute task, handle completion/failure
|   |-- Router.ts              # Route completed/rejected tasks, loop detection, complete story
|   |-- CompletionHandler.ts   # Handle task:completed events, delegate to Router
|   |-- SessionManager.ts      # Generate/parse session names for resume
|   |-- SessionResolver.ts     # Provider-specific session ID resolution
|   |-- PromptLoader.ts        # Load prompt template, inject variables, build resume prompt
|   |-- OutputFileManager.ts   # Manage task output files (.outputs/)
|   |-- OutputResolver.ts      # 3-tier fallback: file → parseOutput(stdout) → failed
|   |-- TaskLogWriter.ts       # Batch write stream events to task_logs table
|   +-- PipelineTypes.ts       # StageWorkerConfig
|
|-- ui/
|   |-- UnifiedApp.tsx         # Root: routes to DashboardApp or SimpleLogger
|   |-- dashboard/             # 2x2 grid dashboard (BrandHeader + 4 panels)
|   |   |-- DashboardApp.tsx   # Main component, mode switching
|   |   |-- GridLayout.tsx     # 2x2 panel layout
|   |   |-- CompactLayout.tsx  # Stacked layout for small terminals
|   |   |-- BrandHeader.tsx    # ASCII logo + info bar
|   |   |-- CommandMenuPanel.tsx   # TL: hierarchical menu/submenu
|   |   |-- ActiveStoriesPanel.tsx # TR: stories table
|   |   |-- LiveActivityPanel.tsx  # BL: app logs + stream events
|   |   |-- DiagnosePanel.tsx      # BR: diagnostics + pipeline crew
|   |   |-- PipelineCrew.tsx       # ASCII robot team visualization
|   |   |-- RobotChar.tsx          # Individual robot character
|   |   |-- DrainConfirmPanel.tsx  # Drain confirmation dialog
|   |   |-- KeyBindings.tsx        # Global hotkey handler
|   |   |-- AlertOverlay.tsx       # Alert notifications
|   |   |-- HelpModal.tsx          # Help reference
|   |   |-- useWorkerStatus.ts     # Hook: worker status polling
|   |   |-- useDashboardContent.tsx # Hook: resolve action mode → wizard
|   |   |-- useMenuStack.ts        # Hook: menu/submenu navigation state
|   |   |-- useLiveActivity.ts     # Hook: stream events from current task
|   |   |-- usePipelineFlow.ts     # Hook: pipeline stage tracking
|   |   |-- useActiveStories.ts    # Hook: story list with filtering
|   |   |-- useCrewState.ts        # Hook: robot crew state
|   |   +-- CrewTypes.ts           # Crew type definitions
|   |-- chat/                  # ChatPanel: spawn agent for Q&A
|   |-- config/                # Config wizards (model, provider, team, env)
|   |-- diagnose/              # DiagnoseWizard
|   |-- history/               # HistoryWizard
|   |-- init/                  # InitWizard
|   |-- inspect/               # InspectView
|   |-- load/                  # LoadWizard
|   |-- logs/                  # LogViewer
|   |-- mark-done/             # MarkDoneWizard
|   |-- replay/                # ReplayPlayer
|   |-- ship/                  # ShipTreePicker (multi-select)
|   |-- simple/                # SimpleLogger (non-TTY output)
|   |-- trace/                 # TraceModeLayout, TraceTreePanel, TraceDetailPanel
|   +-- shared/                # Shared UI components
|
|-- shared/                    # Neutral utilities — no layer deps
|   |-- ChainInputBuilder.ts   # Build input for chained tasks
|   |-- FormatTime.ts          # Duration formatting
|   |-- GlobalPath.ts          # ~/.agentkit/ path helpers (getGlobalDir, getGlobalTeamsDir, etc.)
|   |-- Greeting.ts            # Random greetings
|   +-- ResourcePath.ts        # Locate bundled teams/resources directory
|
|-- config/
|   +-- defaults.ts            # Constants: intervals, thresholds, defaults
|
+-- resources/
    |-- teams/                 # Bundled team templates
    |   +-- agentkit/          # Default AgentKit pipeline (sm → tester → review → dev)
    +-- project-resources/     # Bundled project resources
        |-- agents/            # Agent prompt templates
        +-- workflows/         # Workflow definitions
```

---

## 2. Database Schema

### 2.1 Tables

#### projects

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| project_name | TEXT | UNIQUE NOT NULL |
| owner | TEXT | NULL |
| active_team | TEXT | NOT NULL DEFAULT 'agentkit' |
| created_at | TEXT | NOT NULL (ISO 8601) |
| updated_at | TEXT | NOT NULL (ISO 8601) |
| version | INTEGER | DEFAULT 1 |

#### epics

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| project_id | INTEGER | FK → projects.id ON DELETE CASCADE |
| epic_key | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| description | TEXT | NULL |
| status | TEXT | NOT NULL DEFAULT 'draft' (draft/queued/running/done) |
| content_hash | TEXT | NULL |
| source_file | TEXT | NULL |
| order_index | INTEGER | NOT NULL |
| depends_on | TEXT | NULL (JSON: array of epic keys) |
| team | TEXT | NULL (team name for multi-team pipeline) |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |
| version | INTEGER | DEFAULT 1 |
| | | UNIQUE(project_id, epic_key) |

#### stories

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| epic_id | INTEGER | FK → epics.id ON DELETE CASCADE |
| story_key | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| description | TEXT | NULL |
| content | TEXT | NULL (full markdown) |
| status | TEXT | NOT NULL DEFAULT 'draft' (draft/queued/waiting/in_progress/done/cancelled/blocked) |
| content_hash | TEXT | NULL |
| order_index | INTEGER | NOT NULL |
| priority | INTEGER | NOT NULL DEFAULT 0 |
| session_info | TEXT | NULL (JSON: per-stage session names) |
| depends_on | TEXT | NULL (JSON: array of storyKey strings) |
| waiting_stage | TEXT | NULL (stage name to resume at when deps met) |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |
| version | INTEGER | DEFAULT 1 |
| | | UNIQUE(epic_id, story_key) |

#### tasks

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| story_id | INTEGER | FK → stories.id NOT NULL |
| parent_id | INTEGER | FK → tasks.id (self-referencing) NULL |
| team | TEXT | NOT NULL DEFAULT 'agentkit' |
| stage_name | TEXT | NOT NULL |
| status | TEXT | NOT NULL DEFAULT 'queued' (queued/running/completed/failed/routed/rejected/cancelled) |
| prompt | TEXT | NULL (full prompt text sent to provider) |
| input | TEXT | NULL (JSON — output of previous stage) |
| output | TEXT | NULL (JSON — structured output from provider) |
| worker_model | TEXT | NULL |
| input_tokens | INTEGER | NULL |
| output_tokens | INTEGER | NULL |
| attempt | INTEGER | NOT NULL DEFAULT 1 |
| session_name | TEXT | NULL (human-readable session identifier) |
| superseded | INTEGER | NOT NULL DEFAULT 0 (boolean: soft-mark for reset/retry) |
| max_attempts | INTEGER | NOT NULL DEFAULT 3 |
| started_at | TEXT | NULL |
| completed_at | TEXT | NULL |
| duration_ms | INTEGER | NULL |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |
| version | INTEGER | DEFAULT 1 |

**Indexes:**
- `idx_tasks_stage_status(stage_name, status)`
- `idx_tasks_team_stage_status(team, stage_name, status)`

#### task_logs

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| task_id | INTEGER | FK → tasks.id NOT NULL |
| sequence | INTEGER | NOT NULL (per-task ordering) |
| event_type | TEXT | NOT NULL |
| event_data | TEXT | NOT NULL (JSON) |
| created_at | TEXT | NOT NULL |

**Index:** `idx_task_logs_task_sequence(task_id, sequence)`

### 2.2 Relationships

```
projects 1:N epics (CASCADE delete)
epics 1:N stories (CASCADE delete)
stories 1:N tasks (NO cascade — tasks preserved)
tasks 1:N task_logs
tasks self-reference via parent_id (trace chain)
stories.depends_on → stories.story_key (soft reference via JSON)
```

### 2.3 Migrations

7 migration files tracking schema evolution:

| File | Description |
|---|---|
| 0000_initial_schema | projects, epics, stories, tasks, task_logs |
| 0001_add_superseded | tasks.superseded column |
| 0002_multi_team | projects.active_team column |
| 0003_team_isolation | tasks.team column + index |
| 0004_session_continuity | stories.session_info, tasks.session_name |
| 0005_story_priority | stories.priority column |
| 0006_story_dependencies | stories.depends_on column |
| 0007_epic_dependencies | epics.depends_on column (cross-epic dependency keys) |
| 0008_waiting_stage | stories.waiting_stage column (stage-level dep blocking) |
| 0009_epic_team | epics.team column (multi-team pipeline assignment) |

Migrations auto-run on startup via `Connection.ts`. Tracked in `_agentkit_meta` table.

> **Note:** Migrations 0000-0006 were consolidated into `0000_init.sql`. Runtime migration files are `0000_init`, `0001_epic_dependencies`, `0002_waiting_stage`, `0003_epic_team`.

---

## 3. EventBus — Full Event Map

### 3.1 Event Categories

```typescript
interface EventMap {
  // Pipeline lifecycle
  'pipeline:start': PipelineEvent
  'pipeline:stop': PipelineEvent
  'pipeline:stopping': PipelineEvent
  'pipeline:terminated': PipelineEvent
  'pipeline:ready': PipelineReadyEvent
  'pipeline:starting': { stages: string[] }
  'pipeline:reconfigured': PipelineConfig
  'pipeline:draining': PipelineDrainingEvent

  // Worker activity
  'worker:idle': WorkerEvent
  'worker:busy': WorkerEvent

  // Task execution
  'task:queued': TaskEvent
  'task:started': TaskEvent
  'task:completed': TaskEvent
  'task:failed': TaskEvent
  'task:routed': TaskEvent
  'task:rejected': TaskEvent
  'task:recovered': TaskRecoveredEvent
  'task:alert': AlertEvent
  'task:drained': TaskDrainedEvent

  // Stream events (provider → worker → dashboard)
  'stream:text': StreamEvent
  'stream:error': StreamEvent
  'stream:done': StreamEvent
  'stream:raw_trace': StreamEvent        // internal, not re-emitted
  'stream:thinking': StreamEvent         // reserved for future API providers
  'stream:tool_use': StreamEvent         // reserved for future API providers
  'stream:tool_result': StreamEvent      // reserved for future API providers

  // Queue
  'queue:enqueued': { stage: string; storyId: number }
  'queue:updated': QueueEvent

  // Story lifecycle
  'story:completed': StoryCompleteEvent
  'story:blocked': StoryBlockedEvent
  'story:done': StoryDoneEvent
  'story:reset': StoryResetEvent
  'story:cancelled': StoryCancelEvent
  'story:request-done': { storyId: number }
  'story:request-reset': { storyId: number; targetStage: string }
  'story:request-cancel': { storyId: number }

  // Epic
  'epic:done': EpicDoneEvent
  'epic:request-done': { epicId: number }

  // Team
  'team:switched': TeamSwitchedEvent
  'team:request-switch': TeamRequestSwitchEvent

  // Application
  'app:log': LogEvent
  'diagnose:result': DiagnoseResultEvent
}
```

### 3.2 Key Payload Types

```typescript
interface StreamEvent {
  taskId: number
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'error' | 'done' | 'raw_trace'
  stageName: string
  timestamp: number
  data: {
    text?: string
    toolName?: string
    toolInput?: Record<string, unknown>
    toolResult?: string
    thinking?: string
    error?: string
    inputTokens?: number      // from done event (undefined in plain text mode)
    outputTokens?: number     // from done event (undefined in plain text mode)
    stdout?: string           // raw_trace only
    stderr?: string           // raw_trace only
  }
}

interface TaskEvent {
  taskId: number
  storyId: number
  stageName: string
  status: TaskStatus
  workerModel?: string
  attempt?: number
  durationMs?: number
  error?: string
}

type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'routed' | 'rejected' | 'cancelled'

interface StoryCompleteEvent {
  storyId: number
  storyKey: string
  epicKey: string
  durationMs: number
  storyTitle: string
  stageDurations: Array<{ stageName: string; durationMs: number }>
  totalAttempts: number
}

interface AlertEvent {
  taskId: number
  storyId: number
  storyTitle: string
  stageName: string
  issues: string[]
  routedTo?: string
  attempt: number
  maxAttempts: number
  isBlocked: boolean
}

interface LogEvent {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  module: string
  message: string
  timestamp: string
  data?: Record<string, unknown>
}
```

---

## 4. Provider Architecture

### 4.1 Interface Contract

```typescript
interface BaseProvider {
  readonly name: string
  readonly type: 'agent' | 'api'
  readonly capabilities: ProviderCapabilities
  execute(prompt: string, config: ProviderConfig): AsyncIterable<StreamEvent>
  isAvailable(): Promise<boolean>
  validateConfig(config: ProviderConfig): ValidationResult
  createSessionResolver?(db: DrizzleDB, projectPath: string): SessionIdResolver | null
}

interface ProviderConfig {
  taskId: number
  stageName: string
  model: string
  timeout: number
  permissions: 'dangerously-skip' | 'accept-edits' | 'default'
  providerEnv?: Record<string, string>
  settingsPath?: string
  sessionName?: string       // human-readable session identifier
  resumeSession?: string     // provider-specific session ID for resume
}

interface ProviderCapabilities {
  streaming: boolean
  nativeToolUse: boolean
  supportedModels: string[]
  sessionSupport: boolean
}

interface SessionIdResolver {
  resolve(sessionName: string): string | null
  scanNewSessions(): number
}
```

### 4.2 Implemented Providers

| Provider | CLI Tool | Output Mode | Session Support | Models |
|---|---|---|---|---|
| ClaudeCliProvider | `claude` | Plain text (`--verbose`) | Yes (`-n`/`-r` flags) | opus, sonnet, haiku |
| GeminiCliProvider | `gemini` | JSON (`--output-format json`) | Yes (`--list-sessions`, `-r UUID`) | gemini-3.1-pro-preview, gemini-3-flash, gemini-2.5-pro, etc. |
| CodexCliProvider | `codex` | Child process | No | o4-mini, o3, gpt-4.1, etc. |

### 4.3 File-Based Output Contract

3 separate channels:

| Channel | Purpose | Parsed? |
|---|---|---|
| **File** `_agent_kit/.outputs/task-{id}.json` | ONLY source of structured data | `JSON.parse()` |
| **stdout** | Live Activity display | NO |
| **stderr** | Diagnostic log | NO |

**3-tier Fallback Chain:**

```
1. Read file at outputPath
   ├── Exists + valid JSON        → task done (source: 'file')
   ├── Exists + invalid JSON      → task failed (INVALID_OUTPUT_JSON)
   └── Does not exist             → fall through to tier 2

2. parseOutput(collectedText) — stdout fallback
   ├── Found JSON code block      → task done (source: 'stdout')
   ├── Found balanced braces      → task done (source: 'stdout')
   └── Not found                  → fall through to tier 3

3. Task failed: OUTPUT_MISSING   → save rawText + stderr for debugging
```

### 4.4 Provider Type Classification

- **AgentProvider** (Claude CLI, Gemini CLI, Codex CLI): Handles tools internally, returns stream events. Code only needs to stream and collect output.
- **APIProvider** (reserved — Claude API, Ollama, OpenAI): Returns tool_use requests, code must implement tool execution loop. No implementation yet.

---

## 5. Worker Architecture

### 5.1 StageWorker Lifecycle

```
INIT → IDLE → POLLING → CLAIMED → EXECUTING → ROUTING → IDLE
                                      |
                                      → FAILED → IDLE
```

### 5.2 Polling with Exponential Backoff

```
DEFAULT_POLL_INTERVAL = 3000ms
MAX_POLL_INTERVAL = 30000ms
BACKOFF_MULTIPLIER = 1.5x

When queue is empty: interval *= 1.5 (max 30s)
When task found: reset to 3s
```

### 5.3 Task Execution Flow

```
StageWorker.pollLoop()
  └─ while running && !drainSignal:
      ├ queue.dequeue(stageName, activeTeam)
      │   → SELECT + UPDATE in transaction
      │   → ORDER BY stories.priority DESC, tasks.created_at ASC
      ├ if task found:
      │   ├ PromptLoader.loadPrompt(stageConfig, task)
      │   │   ├ Load template from team prompts
      │   │   ├ Inject: {{TASK_INPUT}}, {{TASK_ID}}, {{STORY_TITLE}}, {{OUTPUT_FILE}}
      │   │   └ If resume: build resume prompt with feedback extraction
      │   ├ SessionManager.resolveSession(task)
      │   │   ├ Generate: {PROJECT}-{STORY_KEY}-{STAGE}-{RANDOM_8}
      │   │   └ If retry + sessionSupport: resolve to provider session ID
      │   ├ provider.execute(prompt, config)
      │   │   ├ Yield StreamEvent → EventBus + TaskLogWriter
      │   │   └ stdout → Live Activity display
      │   ├ OutputResolver.resolveOutput(taskId, collectedText)
      │   │   └ 3-tier fallback (file → stdout → failed)
      │   ├ Update task: status, output, duration, tokens
      │   └ CompletionHandler → Router
      │       ├ detectLoop() → block if MAX_CHAIN=10 or MAX_STAGE_REPEATS=3
      │       ├ routeCompletedTask() → create next task, story.priority++
      │       ├ routeRejectedTask() → reject_to stage, attempt++
      │       └ completeStory() → story.status = 'done', emit story:completed
      └ else:
          └ backoff(currentPollInterval)
```

### 5.4 Routing Rules

- Updating task status and routing the new task MUST happen within the **SAME TRANSACTION**
- Task done + stage has `next`: create new task, `parent_id = current`, `input = current output`
- Task rejected + stage has `reject_to`: create new task, `attempt = current + 1`
- `attempt > max_attempts`: task `status = 'blocked'`, NO routing
- Loop detection: only counts forward-progress tasks (`done | running`, `superseded = false`). Does NOT count `rejected`

### 5.5 Session Continuity

Format: `{PROJECT}-{STORY_KEY}-{STAGE}-{RANDOM_8}`

```
New task (attempt 1): sessionName generated, stored in task + story.session_info
Retry task (attempt 2+):
  ├ Provider has sessionSupport?
  │   ├ Yes: SessionResolver resolves name → provider ID → resume session
  │   └ No: start fresh (graceful degradation)
  └ PromptLoader builds resume prompt with rejection feedback
```

### 5.6 Graceful Shutdown & Drain

**Hard stop (Ctrl+C):**
- First time: `shutdownRequested = true`, workers stop polling, wait for active tasks (max 30s)
- Second time: Force kill all child processes via ProcessManager, `process.exit(1)`

**Graceful drain (from dashboard):**
- Set DrainSignal shared flag
- Workers finish their current task but do NOT route to the next stage
- Queue.cancelAllQueued(team) — cancel all queued tasks
- Pipeline emits `pipeline:draining` event
- When all workers are idle: pipeline stops cleanly

### 5.7 Task Log Persistence

- Batch writer: flushes every 500ms or when buffer reaches 50 entries
- Batch insert within a transaction
- `drain()` when task completes and during graceful shutdown
- Sequence number increments per task, starting from 1

---

## 6. Config System

### 6.1 Config Files

```
{projectRoot}/
└── _agent_kit/
    ├── agentkit.config.json    # ProjectConfig (user overrides)
    ├── agentkit.db             # SQLite database
    ├── agentkit.db-shm/.wal   # WAL files
    └── logs/
        └── agentkit.log        # Rolling log file (10MB max, 3 backups)
```

### 6.2 ProjectConfig Schema (v2)

```typescript
interface ProjectConfig {
  version: number               // currently 2
  project: {
    name: string
    owner?: string
  }
  activeTeam: string            // e.g. "agent-kit" (primary team)
  activeTeams?: string[]        // all teams that run concurrently (defaults to [activeTeam])
  defaultTeam?: string          // fallback for epics without team field (defaults to activeTeam)
  teams: string[]               // registry of installed teams
  provider: string              // e.g. "claude-cli"
  models: Record<string, Record<string, string>>
  // { "claude-cli": { "sm": "sonnet", "dev": "opus" }, "gemini-cli": { ... } }
  env?: Record<string, Record<string, string>>
  // { "claude-cli": { "SOME_VAR": "value" } }
  settings?: Record<string, string>
  // { "claude-cli": "/path/to/settings" }
  maxConcurrentSessions?: number  // global cap on concurrent AI sessions (default: Infinity)
}
```

### 6.3 TeamConfig Schema

```typescript
interface TeamConfig {
  team: string                  // e.g. "agent-kit"
  displayName: string           // e.g. "AgentKit Development"
  version: number
  models: Record<string, ProviderModelsConfig>
  // { "claude-cli": { allowed: [...], defaults: {...} }, "gemini-cli": {...} }
  stages: StageConfig[]
  ownership?: FileOwnership     // file ownership rules (optional, multi-team only)
}

interface FileOwnership {
  include: string[]             // glob patterns of files this team owns
  exclude?: string[]            // glob patterns to exclude from ownership
}

interface StageConfig {
  name: string                  // e.g. "sm"
  displayName: string           // e.g. "Scrum Master"
  icon: string                  // e.g. "📋"
  prompt: string                // relative path to prompt file
  timeout: number               // seconds
  workers: number               // number of concurrent workers
  retries: number               // max retries
  next?: string                 // next stage name
  reject_to?: string            // stage to route rejected tasks
  reset_to?: string[]           // valid stages for manual reset
  skipDeps?: boolean            // skip all dependency checks (default: false)
  skipDepsLevel?: 'epic' | 'story'  // scope of dep check (default: 'epic')
  agentTeam?: AgentTeamConfig   // optional: use Claude native agent teams for parallel execution
}

interface AgentTeamConfig {
  teammates: number             // number of teammates to spawn (1-8)
  teammateModel?: string        // model for teammates (default: inherit stage model)
  timeoutMultiplier?: number    // multiply stage timeout (default: 3)
  planApproval?: boolean        // require plan approval before implementation (default: false)
}

interface ProviderModelsConfig {
  allowed: string[]
  defaults: Record<string, string>
}
```

### 6.4 PipelineConfig (Runtime — Resolved)

```typescript
interface PipelineConfig {
  team: string
  displayName: string
  provider: string
  project: { name: string; owner?: string }
  stages: StageConfig[]
  models: {
    allowed: string[]
    resolved: Record<string, string>    // final model per stage
  }
  providerEnv?: Record<string, string>
  settingsPath?: string
}
```

### 6.5 Config Merge Order

```
1. Load TeamConfig from bundled teams (src/resources/teams/{team}/config.json)
2. Load ProjectConfig from _agent_kit/agentkit.config.json
3. Select models for active provider: team.models[provider].defaults
4. Override with project.models[provider] (user overrides)
5. Validate: every model in resolved must be in team.models[provider].allowed
6. Return PipelineConfig (fully resolved)
```

### 6.6 Bundled Teams

Only the default team ships bundled in `src/resources/teams/`:

| Team | Display Name | Stages |
|---|---|---|
| agentkit | AgentKit Development | sm → tester → review → dev |

Other teams (e.g. agent-kit, google-veo3, janitor, ldj-cms) are user-managed and live in `~/.agentkit/teams/`. They are not bundled with the package.

### 6.7 Global Directory

The global directory `~/.agentkit/` is created on first CLI invocation via `ensureGlobalDir()` in `GlobalSetup.ts`.

**Structure:**

```
~/.agentkit/
├── teams/              # All available teams (synced from bundled + user custom)
│   ├── agentkit/       # Synced from bundled src/resources/teams/agentkit/
│   ├── agent-kit/      # User-created or previously synced
│   ├── google-veo3/    # User-created
│   └── ...             # Any custom teams
└── resources/          # Project resources (synced from bundled)
    ├── agents/         # Agent prompt templates
    └── workflows/      # Workflow definitions
```

**Sync behavior:**
- On each CLI invocation, `GlobalSetup` walks the bundled `src/resources/teams/` and `src/resources/project-resources/` directories
- Files are copied to `~/.agentkit/teams/` and `~/.agentkit/resources/` respectively
- Only missing files are copied — existing files are never overwritten, preserving user customizations

**Init flow:**
- `agentkit init` reads available teams from `~/.agentkit/teams/` (not from bundled resources)
- The user selects a team during init, and the selected team config is copied into `_agent_kit/teams/`
- Epic artifacts (planning output) are stored in `_agentkit-output/planning/`

### 6.8 Constants

```typescript
AGENTKIT_DIR = '_agent_kit'
CONFIG_FILENAME = 'agentkit.config.json'
DB_FILENAME = 'agentkit.db'
DEFAULT_TEAM = 'agentkit'
DEFAULT_PROVIDER = 'claude-cli'
DEFAULT_POLL_INTERVAL = 3000     // ms
MAX_POLL_INTERVAL = 30000        // ms
BACKOFF_MULTIPLIER = 1.5
MAX_RETRY = 3
MAX_CHAIN_LENGTH = 10
BUSY_TIMEOUT = 5000              // ms (SQLite)
LOG_BATCH_SIZE = 50
LOG_FLUSH_INTERVAL = 500         // ms
DASHBOARD_CHROME_ROWS = 5
MAX_ACTIVITY_EVENTS = 500
LOG_FILE_MAX_SIZE = 10485760     // 10MB
LOG_MAX_BACKUPS = 3
APP_NAME = 'AgentKit'
APP_VERSION = '1.0.0'
```

---

## 7. Dashboard Architecture

### 7.1 Component Tree

```
UnifiedApp (root)
  |
  +-- TTY mode: DashboardApp
  |   |
  |   +-- BrandHeader (ASCII logo + info bar: project · team · provider · pipeline status)
  |   |
  |   +-- Mode: OVERVIEW (default)
  |   |   |-- GridLayout (2x2, flexGrow)
  |   |   |   |-- TL: CommandMenuPanel
  |   |   |   |   +-- Menu stack navigation (main → submenu → action)
  |   |   |   |   +-- Idle: menu list | Active: inline wizard
  |   |   |   |-- TR: ActiveStoriesPanel
  |   |   |   |   +-- Stories table with status, stage, duration
  |   |   |   |-- BL: LiveActivityPanel
  |   |   |   |   +-- App logs + stream events (wrap="truncate")
  |   |   |   +-- BR: DiagnosePanel + PipelineCrew
  |   |   |       +-- Event-driven re-scan (no polling)
  |   |   |       +-- ASCII robot visualization
  |   |   +-- KeyBindings (global hotkey handler)
  |   |
  |   +-- Mode: TRACE
  |   |   +-- TraceModeLayout
  |   |       |-- TraceTreePanel (left — epic/story/task tree)
  |   |       +-- TraceRightPanel (right — detail/logs/actions)
  |   |
  |   +-- Mode: FOCUS
  |       +-- Fullscreen single panel
  |
  +-- Non-TTY mode: SimpleLogger
      +-- Plain text output to stdout
```

### 7.2 Menu/Submenu Navigation

```
Main Menu
├── Load Story                   (action)
├── Ship Story                   (action)
├── Run Pipeline            (R)  (action — when stopped: starts workers)
│   ── When running, replaced by:
│      ├── Drain Pipeline (finish current)  (R)  (graceful drain)
│      └── Stop Pipeline (force)            (F)  (force terminate)
├── Epic & Story Management  ─►  (submenu)
│   ├── Mark Story Done
│   ├── Reset Story
│   └── Cancel Story
├── Task Management          ─►  (submenu)
│   ├── Task List
│   ├── Trace Task
│   └── Replay Task
├── Diagnose                     (action)
├── Config                   ─►  (submenu)
│   ├── View Current Config
│   ├── Change Active Team
│   ├── Change Provider
│   └── Change Models
├── Ask Agent                    (action — ChatPanel)
├── Help                         (action)
└── Quit
```

**Navigation rules:**
- Arrow up/down: navigate within current menu
- Enter / right arrow: enter submenu or run action
- Q in submenu: back to parent menu
- Q in main menu: quit app

### 7.3 Dashboard Modes

| Mode | Trigger | Layout | Exit |
|---|---|---|---|
| Overview | Default | BrandHeader + 2x2 grid + KeyBindings | — |
| Trace | `T` key | TraceTreePanel + TraceRightPanel | `Q` → Overview |
| Focus | `F` key | Fullscreen single panel | `F` or `Q` → Overview |

---

## 8. Story Lifecycle

### 8.1 Status Flow

```
draft ──(ship)──► queued ──(dequeue)──► in_progress
                    |                       |
                    |                  ┌────┴────┐
                    |               done      blocked
                    |                |           |
                    |           (mark-done)  (reset)──► queued
                    |
               (has unmet deps)
                    |
                    ▼
                 waiting ──(deps satisfied)──► queued
```

### 8.2 Story Dependencies

- `depends_on` field: JSON array of storyKey strings
- When shipping: stories with unmet dependencies receive status `waiting` instead of `queued`
- `DependencyResolver`: polls every 10s + listens to `story:completed` event
- When all dependencies are done: auto-transition `waiting` → `queued`
- DAG validation: detects cycles before shipping

### 8.3 Queue Priority

- `stories.priority` column (default 0)
- Dequeue query: `ORDER BY stories.priority DESC, tasks.created_at ASC`
- Auto-increment: Router increments `priority++` each time it routes to the next stage
- Stories further along in the pipeline are processed first → reduces context waste

### 8.4 Reset / Cancel / Reopen

| Action | Effect |
|---|---|
| Reset | Creates a new task at the target stage, `attempt = 1`. Old tasks are soft-marked `superseded = true`. Story status → `in_progress` |
| Cancel | Story status → `cancelled`. Queued tasks are deleted. Running tasks are allowed to finish |
| Reopen | Story status → `queued` or `in_progress`. Allows re-processing |
| Mark Done | Story status → `done`. Final task → `done`. Emits `story:done` |

---

## 9. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js (ESM) | >= 18 LTS |
| Language | TypeScript | 5.7+ |
| Database | SQLite (better-sqlite3) | 11.0+ |
| ORM | Drizzle ORM | 0.36+ |
| CLI Framework | Commander.js | 12.0+ |
| Terminal UI | Ink (React for CLI) | 5.0+ |
| UI Components | @inkjs/ui | 2.0+ |
| Colors | chalk | 5.6+ |
| Build | tsc + tsc-alias | — |
| Test | vitest | 3.0+ |
| Package | npm scoped (@shizziio/agent-kit) | — |

---

## 10. Key Architectural Patterns

| Pattern | Where | Description |
|---|---|---|
| Event-Driven | EventBus | Decoupled communication: workers emit → dashboard/services subscribe |
| Transaction-Based State | Queue, Router | All state changes via DB transactions, prevents race conditions |
| Provider Abstraction | BaseProvider | AsyncIterable<StreamEvent> interface for multiple AI providers |
| Polling + Exponential Backoff | StageWorker | 3s → 30s backoff when queue empty, reset on task found |
| Task Chaining | Router | parent_id chain, priority auto-increment |
| Soft Delete (Superseding) | ResetService | Never delete tasks, soft-mark superseded for audit trail |
| 3-Tier Fallback | OutputResolver | File → stdout parse → failed |
| Session Continuity | SessionManager | Resume provider sessions on retry, reduce token waste |
| Priority Queue | Queue.dequeue | Stories further in pipeline processed first |
| Dependency DAG | DependencyResolver | Auto-queue stories when all dependencies satisfied |
| Graceful Drain | DrainSignal | Finish current, cancel queued, no new routing |
