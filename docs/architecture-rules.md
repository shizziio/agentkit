# @shizziio/agent-kit — Architecture Rules & Conventions

General rules that apply to the ENTIRE project. Each epic has its own `architect.md` with specific decisions.

> **Last Updated**: 2026-03-12 (Doc Version 2)

---

## 1. Naming Conventions

### 1.1 Files & Directories

| Type | Convention | Example |
|---|---|---|
| Directory | kebab-case | `live-activity/`, `stage-worker/` |
| TypeScript source | PascalCase.ts | `Pipeline.ts`, `EventBus.ts` |
| TypeScript types/interfaces | PascalCase.ts | `StreamEvent.ts`, `BaseProvider.ts` |
| React/Ink components | PascalCase.tsx | `PipelineFlow.tsx`, `StatusBar.tsx` |
| Test files | PascalCase.test.ts | `Pipeline.test.ts`, `Parser.test.ts` |
| Config files | kebab-case | `config.json`, `drizzle.config.ts` |
| Prompt files | kebab-case.md | `sm.md`, `dev.md` |
| DB migrations | NNNN_description.ts | `0001_initial_schema.ts` |

### 1.2 Code Naming

| Type | Convention | Example |
|---|---|---|
| Class | PascalCase | `StageWorker`, `ClaudeCliProvider` |
| Interface | PascalCase (no prefix I) | `BaseProvider`, `StreamEvent` |
| Type alias | PascalCase | `TaskStatus`, `StageConfig` |
| Enum | PascalCase | `TaskStatus` |
| Enum member | UPPER_SNAKE_CASE | `TaskStatus.IN_PROGRESS` |
| Function | camelCase | `resolveModel()`, `parseEpics()` |
| Variable | camelCase | `stageWorker`, `contentHash` |
| Constant | UPPER_SNAKE_CASE | `DEFAULT_POLL_INTERVAL`, `MAX_RETRY` |
| Private field | camelCase (no prefix _) | `this.pollInterval` (use `private` keyword) |
| EventBus event | kebab-case:kebab-case | `task:completed`, `stream:tool_use` |
| DB column | snake_case | `project_name`, `content_hash`, `created_at` |
| DB table | plural snake_case | `projects`, `epics`, `stories`, `tasks` |
| Config key (JSON) | camelCase | `displayName`, `allowedModels` |
| CLI command | kebab-case | `agentkit load`, `agentkit config` |
| CLI option | kebab-case | `--auto-fix`, `--output-format` |
| Environment variable | UPPER_SNAKE_CASE | `AGENTKIT_DB_PATH`, `AGENTKIT_VERBOSE` |

### 1.3 Domain Terminology (STRICT)

Use these names **exactly** in code, comments, logs, and UI. DO NOT use synonyms.

| Term | Meaning | DO NOT use |
|---|---|---|
| `project` | A project managed by agentkit | app, workspace, repo |
| `team` | A config set that defines the pipeline flow | template, profile, preset |
| `stage` | A step in the pipeline | step, phase, worker-type |
| `task` | The smallest unit of work, belonging to 1 story + 1 stage | job, work-item, unit |
| `story` | A user requirement, containing multiple tasks | ticket, issue, requirement |
| `epic` | A group of related stories | milestone, group, batch |
| `provider` | An adapter connecting to an AI service | adapter, connector, client |
| `worker` | A process that handles tasks at a stage | runner, executor, agent |
| `queue` | A task queue awaiting processing | buffer, backlog |
| `pipeline` | The entire flow from the first stage to the last stage | workflow, process |
| `ship` | Send stories into the pipeline for processing | push, send, dispatch, queue |
| `load` | Import epics/stories from a file into the database | import, ingest, sync |
| `logs` | Saved stream events of a task | history, output, trace |
| `inspect` | View the full context of a task | view, detail, show |
| `replay` | Visually play back the execution process of a task | playback, rewatch |
| `trace` | Interactive tree browser: epic -> story -> task | browse, tree, explore |
| `mode` | The display state of the dashboard | view, screen, page |
| `modal` | An overlay wizard on the dashboard | dialog, popup, window |
| `route` | Transfer a task from one stage to another | forward, move, transfer |
| `reject` | Review/Tester sends task back to the previous stage | fail-back, return, bounce |
| `attempt` | A try of a task (incremented on rejection) | retry, iteration |
| `reset` | Return a story/task to a previous stage for retry (user manual action) | restart, redo, rerun |
| `cancel` | Abort a story, remove it from the pipeline | delete, remove, discard |
| `superseded` | An old trace/task replaced by a newer attempt (soft-mark, not deleted) | archived, deprecated, invalidated |
| `mark-done` | Mark a story/epic as completed (user manual action) | complete, finish, close |
| `brand` | Display information for the project (logo, name, version) | header, banner, title |

---

## 2. Project Structure Rules

### 2.1 Source Layout

```
src/
|-- core/                    # Business logic — NO dependency on UI
|   |-- Pipeline.ts          # Orchestrator: start/stop, route tasks
|   |-- Worker.ts            # Abstract: poll, execute, report
|   |-- Queue.ts             # DB-backed: enqueue, dequeue (atomic)
|   |-- StateManager.ts      # Query: status, progress, statistics
|   |-- EventBus.ts          # Singleton pub/sub
|   |-- ConfigLoader.ts      # Load, merge, validate config
|   |-- Parser.ts            # Markdown -> ParsedContent
|   |-- Logger.ts            # Application logger: file + EventBus emit
|   +-- db/
|       |-- schema.ts        # Drizzle table definitions
|       |-- connection.ts    # createConnection(dbPath): DrizzleDB
|       +-- migrations/      # Numbered migration files
|
|-- providers/
|   |-- interfaces/
|   |   +-- BaseProvider.ts  # Contract: execute(), isAvailable(), capabilities
|   +-- agent/
|       |-- ClaudeCliProvider.ts   # Claude CLI: file-based output (Write tool)
|       |-- GeminiCliProvider.ts   # Gemini CLI: stdout JSON output (--output-format json)
|       +-- ProcessManager.ts      # Shared process lifecycle management
|
|-- workers/
|   +-- StageWorker.ts       # Extends Worker, config-driven
|
|-- ui/                      # Ink-based TUI components
|-- cli/                     # Commander.js command handlers
|-- shared/                  # Neutral utilities — no layer deps, safe to import from any layer
+-- config/
    +-- defaults.ts          # Default values, constants
```

### 2.2 File Rules

- Each file exports **1 main concern**. DO NOT contain multiple unrelated classes/functions.
- Files MUST NOT exceed **300 lines**. If exceeded, split into smaller modules.
- DO NOT create `utils.ts`, `helpers.ts`, `common.ts` files. Place functions in the module they belong to.
- Index files (`index.ts`) are only for re-exports, DO NOT contain logic.

### 2.3 Import Rules

- Use **relative imports** within the same layer: `./Queue`
- Use **path aliases** between layers: `@core/EventBus`, `@providers/ClaudeCliProvider`
- Import order (enforced by ESLint):
  1. Node built-in (`node:path`, `node:crypto`)
  2. External packages (`drizzle-orm`, `ink`, `commander`)
  3. Internal aliases (`@core/`, `@providers/`, `@ui/`)
  4. Relative (`./`, `../`)
- Each group separated by 1 blank line

---

## 3. TypeScript Rules

### 3.1 Strict Mode

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false
  }
}
```

### 3.2 Type Rules

- **DO NOT use `any`**. Use `unknown` + type guard if needed.
- **DO NOT use `as` type assertion** unless there is a comment explaining why it is safe.
- Public APIs must have explicit type annotations. Private functions may use inference.
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Database records use Drizzle's inferred types: `typeof projects.$inferSelect`.

### 3.3 Error Handling

```typescript
class AgentKitError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AgentKitError';
  }
}
class ConfigError extends AgentKitError { code = 'CONFIG_ERROR'; }
class ParserError extends AgentKitError { code = 'PARSER_ERROR'; }
class ProviderError extends AgentKitError { code = 'PROVIDER_ERROR'; }
class QueueError extends AgentKitError { code = 'QUEUE_ERROR'; }
```

- DO NOT catch errors and swallow them. Must log or re-throw.
- DO NOT use `try/catch` for flow control.
- Provider errors must be wrapped in ProviderError with context.

### 3.4 Async Rules

- Every async function must have error handling or let the caller handle it.
- DO NOT use `.then()/.catch()`. Use `async/await`.
- DO NOT use `new Promise()` unless wrapping a callback-based API.
- AsyncIterable must have cleanup logic in a `finally` block.

---

## 4. Database Rules

### 4.1 Schema Rules

- Every table must have: `id` (autoincrement), `created_at`, `updated_at`, `version` (default 1).
- `updated_at` must be updated every time a record changes.
- Foreign keys: `ON DELETE CASCADE` for epics and stories. Tasks DO NOT cascade.
- JSON columns are stored as TEXT. Application code handles parse/stringify.
- SQLite connection MUST set `busy_timeout = 5000`.
- All workers run within the **same Node.js process**. DO NOT spawn workers as child processes.
- Use `better-sqlite3` (synchronous driver).

### 4.2 Query Rules

- Every write operation must be within a transaction.
- Task claiming (dequeue) must use a single transaction: SELECT + UPDATE.
- DO NOT use raw SQL. Use Drizzle query builder.
- DO NOT use `SELECT *` on the tasks table unless the prompt/output is needed.
- Index: `tasks(stage_name, status)`, `stories(epic_id, story_key)`, `task_logs(task_id, sequence)`.

### 4.3 Migration Rules

- Every schema change creates a new migration file. DO NOT modify migrations that have already been run.
- Migration file naming: `NNNN_description.ts`.
- Migrations must be idempotent.

---

## 5. EventBus Rules

### 5.1 Event Naming

Format: `domain:action` (kebab-case)

| Domain | Events |
|---|---|
| `pipeline` | `pipeline:start`, `pipeline:stop` |
| `worker` | `worker:idle`, `worker:busy` |
| `task` | `task:queued`, `task:started`, `task:completed`, `task:failed`, `task:routed`, `task:rejected` |
| `stream` | `stream:text`, `stream:error`, `stream:done`, `stream:raw_trace` (active); `stream:thinking`, `stream:tool_use`, `stream:tool_result` (reserved) |
| `queue` | `queue:updated` |
| `story` | `story:completed`, `story:reset`, `story:cancelled`, `story:done` |
| `epic` | `epic:done` |
| `app` | `app:log` |

> **Removed**: `diagnose:result` event and `DiagnosePollingService`. DiagnosePanel no longer uses event polling.

### 5.2 Event Descriptions

| Event | Payload | Description |
|-------|---------|-------------|
| `app:log` | `LogEvent` | Application log entry — emitted by Logger on each log call |
| `task:completed` | `TaskEvent` | Task done — triggers DiagnosePanel re-scan |
| `task:failed` | `TaskEvent` | Task failed/blocked — triggers DiagnosePanel re-scan |
| `story:completed` | `StoryCompleteEvent` | Story done (last stage) — triggers DiagnosePanel re-scan |
| `story:reset` | `StoryResetEvent` | Story reset to earlier stage by user — traces soft-marked superseded |
| `story:cancelled` | `StoryCancelEvent` | Story cancelled by user — removed from active pipeline |
| `story:done` | `{ storyId, storyKey }` | Story marked done via MarkDoneService |
| `epic:done` | `{ epicId, epicKey }` | Epic marked done — all stories verified done |

### 5.2 Rules

- Event emitters DO NOT await subscribers. Fire-and-forget.
- Subscribers DO NOT throw errors. Each subscriber catches its own errors.
- EventBus.emit MUST have try/catch wrapping each subscriber call.
- EventBus is a singleton. Import from `@core/EventBus`.
- DO NOT create new event types without updating this document.

---

## 6. Logger Rules

Logger is a singleton service (`@core/Logger`), dual-output: file + EventBus.

```typescript
const log = Logger.getLogger('Pipeline');
log.info('Workers started: SM(1), Dev(1), Review(1)');
log.warn('Task #6 rejected, routing to dev (attempt 2/3)');
log.error('Provider crash', { taskId: 5, exitCode: 1 });
log.debug('Polling dev queue, 0 tasks found');
```

- Logger MUST be initialized BEFORE all other modules.
- File path: `_agent_kit/logs/agentkit.log`. Create `logs/` if it does not exist.
- Log level: `INFO` (default), `DEBUG` (when `--verbose`).
- Use `fs.appendFileSync`. NOT async.
- File rotation: 10MB max, keep `.log.1`, `.log.2`, `.log.3`.
- DO NOT log sensitive data: API keys, full prompt content, full task output.

| Level | When to use | Example |
|-------|-------------|-------|
| `DEBUG` | Internal details, polling | `Polling dev queue: 0 tasks` |
| `INFO` | Main activities | `Task #5 completed (80s)` |
| `WARN` | Anomalies | `Task retry (attempt 2/3)` |
| `ERROR` | Errors requiring action | `Provider exited with code 1` |

---

## 7. Layer Dependencies

| Layer | Can Depend On | Cannot Depend On |
|---|---|---|
| cli/ | core/, ui/, providers/ | — |
| ui/ | core/ (via EventBus only) | providers/, cli/ |
| core/ | db/ | ui/, cli/, providers/ (except via interface) |
| providers/ | core/interfaces only | ui/, cli/, db/ |
| workers/ | core/, providers/ | ui/, cli/ |
| db/ | — | anything else |

**Strictly forbidden**: The UI layer MUST NEVER import directly from providers/ or workers/.

---

## 8. Worker Rules

### 8.4 Routing Rules

- Updating task status + routing a new task MUST be within the **SAME TRANSACTION**. Atomic.
- Task done + stage has `next`: create a new task at the `next` stage.
- Task rejected + stage has `reject_to`: create a new task at the `reject_to` stage, `attempt = current attempt + 1`.
- `attempt > max_attempts`: task `status = 'blocked'`. DO NOT create a new task.

### 8.4.1 Reset Rules

- The `reset_to` field in stage config defines the valid stages a story can return to when the user performs a manual reset.
- On reset: create a new task at the target stage with `status = 'queued'`, `attempt = 1` (reset counter).
- Traces (task_logs) of old tasks are NOT deleted. Old tasks are soft-marked `superseded = true`.
- Story status changes to `in_progress` if currently `failed` or `blocked`.
- Cancel: story status = `cancelled`. Tasks with status `queued` are deleted. Tasks with status `running` must wait to complete (or be force killed).

### 8.5 Output Contract Rules

Provider output is collected via a **file** that Claude writes using the Write tool, NOT from stdout.

**3 separate channels:**

| Channel | Purpose | Parse data? |
|---|---|---|
| **File** (`_agent_kit/.outputs/task-{id}.json`) | ONLY source of structured data | `JSON.parse()` |
| **stdout** | Live Activity display | NO — display only |
| **stderr** | Diagnostic log | NO — only `logger.debug()` |

**Rules:**

- Output path: `_agent_kit/.outputs/task-{taskId}.json` — deterministic, 1:1 with task ID.
- StageWorker computes the path BEFORE execute, injects `{{OUTPUT_FILE}}` into the prompt, reads the file AFTER the process exits.
- DO NOT watch folders. DO NOT scan directories. DO NOT parse stdout for data.
- Fallback chain: read file → `parseOutput(collectedText)` → task failed.
- File cleanup: delete after successful read. Keep invalid files for debugging. Clean up stale files on startup.
- stderr on exit code 0: **DO NOT emit error event**. Only log diagnostics.
- Prompt templates MUST have an OUTPUT CONTRACT block requiring Claude to use the Write tool.
- `.outputs/` folder MUST be in `.gitignore`.

---

## 9. UI/Ink Rules

### 9.1 Unified Dashboard Rules

- `agentkit start` MUST clear the terminal (`process.stdout.write('\x1Bc')`) before rendering the dashboard. The clear MUST happen before the `render()` call, NOT inside a component lifecycle.
- `UnifiedApp` is the root component, managing `mode` state: `overview | trace | focus`.
- **NO AlertOverlay** or any popup overlay blocking the dashboard. Task alerts (reject, block) are only written to the Live Activity log.
- Mode switching MUST be smooth — DO NOT unmount/remount the entire app. Only toggle visibility of panels.
- **NO StatusBar/Footer** — Hotkey hints are displayed in the TL panel bottom line.
- When the action wizard closes: emit `stdout.write('\x1b[2J\x1b[H')` once to clear render artifacts.

#### TL Panel — Menu/Submenu Navigation System

CommandMenuPanel uses a **menu stack** instead of a flat action list:

```
Main Menu
├── Load Story                   (action — no submenu)
├── Ship Story                   (action — no submenu)
├── Epic & Story Management  ─►  (submenu)
│   ├── Mark Story Done
│   ├── Reset Story
│   └── Remove Story from Queue
├── Task Management          ─►  (submenu)
│   ├── Task List
│   ├── Trace Task
│   └── Replay Task
├── Diagnose                     (action — no submenu)
├── Config                   ─►  (submenu)
│   ├── View Current Config
│   ├── Change Active Team
│   └── Change Models
├── Ask Agent                    (action — no submenu, opens ChatPanel)
├── Help                         (action — no submenu)
└── Quit
```

**Navigation rules (STRICT):**

| Trigger | Result |
|---------|---------|
| Arrow ↑↓ | Navigate within the current menu |
| Enter / → | Enter submenu OR execute action |
| `Q` while in SUBMENU | Back to MAIN MENU |
| `Q` while in ACTION VIEW | Back to parent SUBMENU |
| `Q` while in MAIN MENU | Quit app (graceful) |
| Action completes | Auto-back to parent SUBMENU (NOT to Main Menu) |

> **Strictly forbidden:** NEVER go back to Dashboard root after an action completes. Always go back to the parent menu.
> **`Esc` is disabled** in the context of menu/submenu navigation — only use `Q` to go back.
> **`R` key currently DOES NOT work** — Run/Stop workers to be implemented later.

**Ask Agent** (`src/ui/chat/ChatPanel.tsx`): Component already exists, spawns Claude CLI with project context, streams response. `onExit` callback = Q pressed → back to Main Menu.

### 9.2 Flicker Prevention Rules (CRITICAL)

- **`wrap="truncate"` is mandatory** for every `<Text>` that renders log lines or any content that could be long within a panel with fixed height. NEVER let text wrap to the next line — Ink does not calculate height correctly → flicker.
- **`overflow="hidden"` is mandatory** on content container boxes. Prevents content from overflowing panel boundaries and causing full re-renders.
- **`DASHBOARD_CHROME_ROWS = 11`** is the number of overhead lines for dashboard chrome (BrandHeader + StatusBar). GridLayout and CompactLayout MUST use `availableRows = terminalRows - DASHBOARD_CHROME_ROWS` when calculating the `height` prop passed to panels.
- **`visibleRows` must be dynamic** — calculated from `height prop - overhead`. DO NOT hardcode the number of displayed log lines.
- **ZERO background timers in UI**: NO `setInterval` or `setTimeout` to trigger renders. Every state update must come from an event (`useEffect` with EventBus subscription) or user interaction.
  - **Removed**: `DiagnosePollingService` (setInterval 30s) — replaced with event-driven re-scan.
  - **Removed**: countdown `setInterval` in `useDiagnosePolling` — replaced with static `nextPollAt` timestamp.
  - **Kept but conditional**: tick interval in `useActiveStories` only fires when a story is in `RUN` state.

### 9.3 DiagnosePanel Architecture

- `DiagnosePanel` receives `diagnoseService?: DiagnoseService` prop directly (not via EventBus).
- On mount: calls `diagnoseService.diagnose()` immediately.
- Event triggers: subscribes to `task:completed`, `task:failed`, `story:completed` → calls `diagnose()` again.
- NO polling. NO `setInterval`. NO `useDiagnosePolling` hook.
- If `diagnoseService` is `undefined` (compact layout has no BR panel): display nothing.

### 9.4 DiagnoseService Task Insertion Rule

- **MUST include `team` field** when inserting a new task in `rerouteGap()` and `rerouteLoopBlocked()`.
- Missing `team`: workers filter by team when dequeuing — the task will stay `queued` forever, never picked up.
- Get it from `this.pipelineConfig.team`.

### 9.5 Loop Detection (Router)

- `detectLoop` only counts **forward-progress tasks**: `status === 'done' || status === 'running'`, `superseded = false`.
- **DO NOT count `rejected` tasks** — they are normal retry artifacts, not indicators of a loop.
- Ratio: `rejected` tasks can be very numerous (4-5 rejection cycles = 8-10 tasks) while the forward chain only has 2-3 tasks. Counting all of them causes false positive LOOP blocking for normal stories.
- `MAX_CHAIN_LENGTH = 10`, `MAX_STAGE_REPEATS = 3` apply to `forwardChain`, not the entire `chain`.

### 9.6 loop_blocked Recovery

- `findLoopBlockedIssues()` populates: `gapNextStage = stageConfig[stageName].next`, `completedOutput = task.output`.
- `suggestedAction = 'reroute'` when there is a `next` stage, `'ignore'` when it is the last stage.
- `rerouteLoopBlocked(issue)`: atomic transaction — insert task at `nextStage` + update story `status = 'queued'`. DO NOT only insert the task (must unblock the story as well).
- DiagnoseWizard: `[O] Route to next` when `issue.type === 'loop_blocked' && issue.gapNextStage != null`.

### 9.7 BrandHeader Layout

- ASCII art 6-line block, center-aligned (`alignItems="center"`).
- Info bar below ASCII art (flexDirection="row", gap=3): project · team · pipeline status · workers · queue stats.
- `DASHBOARD_CHROME_ROWS = 11` accounts for BrandHeader (6 ASCII + 2 paddingY + 1 info + 1 marginTop) + StatusBar (1).

### 9.8 TraceDetailPanel Scroll

- `TraceDetailPanel` receives a `scrollIndex?: number` prop.
- JSON input/output is flattened into lines, sliced by `scrollIndex + scrollableHeight`.
- `scrollableHeight = availableHeight - META_ROWS (11)`.
- `TraceWizard` manages `detailScrollIndex` state, resets to 0 when the task changes.
- When `rightPanelMode === 'details'`: up/down arrow scrolls the detail panel (does not navigate the tree).

### 9.9 stderr Rule (WorkerToggle / Pipeline)

- **NEVER** use `process.stderr.write()` in code where Ink is rendering. Raw bytes written directly to stderr bypass Ink cursor control → screen jitter/corruption.
- Instead: use `logger.error(...)` or `logger.warn(...)`. Logger emits via EventBus → Live Activity displays cleanly.

### 9.10 Color Palette

| Purpose | Color | Ink |
|---|---|---|
| Stage working | green | `<Text color="green">` |
| Stage idle | gray | `<Text color="gray">` |
| NEW item | green | `<Text color="green">` |
| UPDATED item | yellow | `<Text color="yellow">` |
| SKIP item | gray | `<Text color="gray">` |
| Error / Failed | red | `<Text color="red">` |
| Warning | yellow | `<Text color="yellow">` |
| Info / Normal | white | `<Text>` |
| Muted / Secondary | gray | `<Text color="gray">` |
| Highlight / Selected | cyan | `<Text color="cyan">` |
| Box borders | gray | `<Box borderColor="gray">` |
| Focused box border | cyan | `<Box borderColor="cyan">` |

### 9.11 Status Indicators

| Status | Symbol | Example |
|---|---|---|
| Working/Running | `●` | `● RUN` |
| Queued/Waiting | `◷` | `◷ QUEUE` |
| Idle | `○` | `○ idle` |
| Done/Passed | `✓` | `✓ DONE` |
| Failed/Error | `✗` | `✗ FAIL` |
| Blocked | `⊘` | `⊘ BLOCKED` |
| Spinner (animated) | Ink Spinner | loading states |

### 9.12 Live Activity Icons

| Event Type | Icon | Example |
|---|---|---|
| Thinking | `🧠` | `🧠 "Analyzing auth module..."` |
| Read file | `📖` | `📖 Read: src/auth/Service.ts` |
| Edit file | `✏️` | `✏️ Edit: src/auth/Service.ts (L42-58)` |
| Bash command | `⚡` | `⚡ Bash: npm test --filter auth` |
| Grep/Search | `🔍` | `🔍 Grep: "validateToken" in src/` |
| Write file | `📝` | `📝 Write: src/auth/TokenUtil.ts` |
| Text response | `💬` | `💬 "Updated token refresh logic"` |
| Error | `❌` | `❌ Process exited with code 1` |
| Completion | `✅` | `✅ Story 1.1 COMPLETE` |
| Rejected | `🔄` | `🔄 Review rejected → rework` |

### 9.13 Inspect View Layout

```
+-- Task #8 Inspection ----------------------------------------+
|                                                               |
|  METADATA                                                     |
|  ID: 8  Stage: dev  Status: done  Model: opus                |
|  Attempt: 2/3  Duration: 04:12  Tokens: 12,450 in / 3,280 out|
|                                                               |
|  STORY CONTEXT                                                |
|  Epic 1: User Authentication > Story 1.2: Login              |
|                                                               |
|  PARENT CHAIN                                                 |
|  #5 SM [done] -> #6 Dev [done] -> #7 Review [rejected]       |
|    -> #8 Dev/rework [done]                                    |
|       -> #9 Review [running]                                  |
|                                                               |
|  [P]rompt  [I]nput  [O]utput  [L]ogs  [q]uit                |
+---------------------------------------------------------------+
```

- Sections are collapsible: arrow keys navigate, Enter expands/collapses.
- [P], [I], [O] display full content with syntax highlighting in a scrollable pane.
- [L] displays the event log similar to Live Activity.

### 9.14 Trace Browser Layout

```
+-- Trace Browser ──────────────────────────── [/] search ──────+
|                                                                |
|  ▼ Epic 1: User Authentication              3/4 stories done  |
|    ▼ Story 1.1: Registration       [✓ DONE]         07:10    |
|      ├ #1 SM     [✓ done]  opus     00:45    850/1.2k tok    |
|      ├ #2 Dev    [✓ done]  opus     03:22   8.4k/3.1k tok    |
|      ├ #3 Review [✓ done]  sonnet   01:15   2.1k/890 tok     |
|      └ #4 Tester [✓ done]  haiku    01:48   1.5k/620 tok     |
|    ▼ Story 1.2: Login               [● RUN]          06:35    |
|      ├ #5 SM     [✓ done]  opus     00:38    780/1.1k tok    |
|      └ #8 Dev    [● run]   opus     02:15   ...              |
|                                                                |
|  ↑↓ navigate  →← expand/collapse  [i]nspect [l]ogs [r]eplay  |
+----------------------------------------------------------------+
```

- Each task node displays: id, stage, status, model, duration, token usage.
- Rework tasks display the attempt number: `#8 Dev rework #2`.
- Superseded tasks are dimmed (gray) with a `[superseded]` label, toggled via `V`.

### 9.15 ScrollablePanel — Shared Log/Trace Display Component

Used for: Task List, Trace Task, Replay Task, Live Activity, Trace Logs.

**Rules:**

- Layout MUST NEVER exceed terminal height. `height = terminalRows - HEADER_ROWS` (dynamic).
- Only render the visible window — slice `lines[scrollIndex .. scrollIndex + height]`.
- Arrow ↑↓ = scroll line-by-line. PgUp/PgDn = scroll half-page.
- `Q` pressed = call `onExit()` callback (back to parent menu/submenu).
- **DO NOT truncate text** when the user is inside this view — display full lines, wrap = false for performance.
- `overflow="hidden"` on container, `wrap="truncate"` on each line to avoid flicker.

```typescript
interface ScrollablePanelProps {
  lines: string[];          // pre-rendered string lines
  height: number;           // available rows (terminal height - chrome)
  title?: string;           // panel header title
  onExit?: () => void;      // called when Q pressed (back to parent)
  autoScrollToBottom?: boolean;  // default true for live logs
}
```

- `autoScrollToBottom = true` for live streams (Live Activity, Trace Logs).
- `autoScrollToBottom = false` for static views (Task List, Replay).
- When user scrolls up: pause auto-scroll. When scrolled to bottom: resume auto-scroll.

---

## 10. Testing Rules

### 10.1 Test Structure

```
tests/
|-- unit/
|   |-- core/
|   |-- providers/
|   |-- workers/
|   +-- ui/
|       |-- dashboard/
|       +-- ...
+-- integration/
    |-- pipeline-flow.test.ts      # Full flow: ship -> sm -> dev -> review -> tester
    |-- load-and-ship.test.ts      # Load markdown -> compare -> ship
    +-- crash-recovery.test.ts     # Simulate crash -> restart -> recover
```

### 10.2 Test Rules

- Every `core/` module must have unit tests. Minimum coverage: **80%** for `core/`, **60%** for `ui/`.
- Test files are placed in the `tests/` folder, mirroring the `src/` structure.
- Test databases use **in-memory SQLite** (`:memory:`), DO NOT use files.
- ClaudeCliProvider tests use **mock child processes**, DO NOT call Claude for real.
- Test naming: `describe('ClassName')` > `describe('methodName')` > `it('should ...')`.
- DO NOT use `test()`. Use `it()` inside `describe()`.
- Every test must be **isolated** — no dependency on execution order.
- Setup/teardown uses `beforeEach`/`afterEach`, DO NOT use `beforeAll` for state.

### 10.3 Test Patterns

```typescript
// Unit test for Queue
describe('Queue', () => {
  let db: DrizzleDB;
  let queue: Queue;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    queue = new Queue(db);
  });

  describe('dequeue', () => {
    it('should return null when queue is empty', async () => {
      const task = await queue.dequeue('sm');
      expect(task).toBeNull();
    });

    it('should claim task atomically and set status to running', async () => {
      await queue.enqueue({ storyId: 1, stageName: 'sm', ... });
      const task = await queue.dequeue('sm');
      expect(task).not.toBeNull();
      expect(task!.status).toBe('running');
      expect(task!.startedAt).toBeDefined();
    });
  });
});
```

### 10.4 Integration Test Patterns

```typescript
class MockProvider implements BaseProvider {
  name = 'mock';
  type = 'agent' as const;
  responses = new Map<string, string>();  // stageName -> JSON response

  async *execute(prompt: string, config: ProviderConfig): AsyncIterable<StreamEvent> {
    const response = this.responses.get(config.stageName) ?? '{}';
    yield { type: 'text', timestamp: Date.now(), data: { text: response } };
    yield { type: 'done', timestamp: Date.now(), data: {} };
  }
}
```

---

## 11. Code Review Checklist

Reviewers must check all items before approving:

### 11.1 Architecture

- [ ] Code is in the correct layer (core, ui, providers, cli)
- [ ] No circular dependencies between layers
- [ ] UI does not import directly from providers or database
- [ ] Communication between core and UI goes through EventBus

### 11.2 Naming

- [ ] All names follow naming conventions (Section 1)
- [ ] Domain terms are used exactly (Section 1.3)
- [ ] No synonyms used for domain terms

### 11.3 TypeScript

- [ ] No `any` (use `unknown` + type guard)
- [ ] No unguarded `as` assertions
- [ ] Public APIs have explicit type annotations
- [ ] Custom errors inherit from AgentKitError
- [ ] Async/await instead of .then()/.catch()

### 11.4 Database

- [ ] Write operations are within transactions
- [ ] Uses Drizzle query builder, no raw SQL
- [ ] `updated_at` is updated when record changes
- [ ] Version column is not omitted

### 11.5 Error Handling

- [ ] No swallowed errors (catch + ignore)
- [ ] Provider errors wrapped in ProviderError with context
- [ ] Try/catch not used for flow control

### 11.6 Testing

- [ ] Unit tests for every public method in core/
- [ ] Tests use in-memory SQLite
- [ ] Provider tests use mocks, do not call Claude for real
- [ ] Tests are isolated — no dependency on execution order

### 11.7 Task Traceability

- [ ] Every task execution persists stream events to task_logs
- [ ] Task record stores prompt, input_tokens, output_tokens
- [ ] Parent_id chain is not broken
- [ ] Log persistence does not block execution flow

### 11.8 Performance

- [ ] No N+1 queries (use joins or batch queries)
- [ ] EventBus subscribers do not block the emitter
- [ ] UI components do not re-render unnecessarily (React.memo)
- [ ] Task log inserts do not slow down pipeline execution

### 11.9 Security

- [ ] No sensitive data logged (API keys, tokens)
- [ ] Child process spawn uses array args, not shell strings
- [ ] User input (file paths) is sanitized before use

### 11.10 Output Contract

- [ ] Prompt templates have an OUTPUT CONTRACT block with `{{OUTPUT_FILE}}`
- [ ] StageWorker injects `outputPath` into the prompt BEFORE execute
- [ ] `_agent_kit/.outputs/` is in `.gitignore`
- [ ] Fallback chain: file → parseOutput(stdout) → failed

---

## 12. Config Schema Reference

### 12.1 Team Config (`teams/{name}/config.json`)

```typescript
interface TeamConfig {
  team: string;
  displayName: string;
  version: number;

  models: {
    allowed: string[];
    defaults: Record<string, string>;
  };

  stages: StageConfig[];
}

interface StageConfig {
  name: string;
  displayName: string;
  icon: string;
  prompt: string;
  timeout: number;
  workers: number;
  retries: number;
  next?: string;
  reject_to?: string;
  reset_to?: string[];        // valid stages for manual reset (user action from dashboard)
  skipDeps?: boolean;          // skip all dep checks at this stage (default: false)
  skipDepsLevel?: 'epic' | 'story';  // 'epic' = wait for dep epics done, 'story' = wait for dep stories in same epic done (default: 'epic')
}
```
