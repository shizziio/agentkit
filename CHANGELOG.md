# Changelog

All notable changes to `@shizziio/agent-kit` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2026-03-21

### Added

**Multi-Team Pipeline (Epics 30-34)**
- `epics.team` column — assign epics to specific pipeline teams
- `activeTeams[]`, `defaultTeam`, `maxConcurrentSessions` in ProjectConfig
- `FileOwnership` (include/exclude globs) in TeamConfig — prevent cross-team file conflicts
- Pipeline spawns workers for all active teams with config freeze at start
- ShipService resolves team from `epic.team` column per story
- DependencyResolver resolves across all active teams
- ProcessManager session semaphore (global `maxConcurrentSessions`)
- PromptLoader injects file ownership rules + consumed contracts into prompts
- Dashboard: team badges in BrandHeader, Team column in stories, PipelineCrew team switching [T], Live Activity team/stage badge
- Cross-team contract files (`epic-{N}/contracts/*.contract.md`) with verification in review/tester prompts

**Project Setup & Interactive Sessions (Epics 35-36)**
- `ReadinessChecker` — checks project-docs, team-config, epic-plans with dependency ordering
- `InteractiveSession` — reusable utility to spawn provider CLI in interactive mode with workflow content
- `SetupMenu` — guided setup shown on `agentkit start` when steps are missing
- `agentkit setup` — standalone setup command
- `agentkit planning` — launch Architect agent interactively (requires docs + team)
- `agentkit ask` — launch AgentKit Master agent interactively
- Dashboard menu: "Create Planning" [P] and "Ask AgentKit" [W] with worker-running check
- All agents have auto-start sequence (load docs, greet, show menu)
- All workflows have completion message ("Exit this session and run `agentkit start` to continue")

**Agent Kit Master**
- New agent "Atlas" — project Q&A, workflow listing, workflow execution, health check

### Changed

- `agentkit init` simplified — no longer selects team or models (teams created via setup workflow)
- Removed bundled `agentkit` team from `src/resources/teams/` — team creation is now a required setup step
- ConfigLoader allows empty `teams[]` and `activeTeam: ''` for fresh projects
- CLI no-args message shows only primary commands (init, start, setup, planning, ask, help)
- `create-team.md` workflow suggests teams based on project architecture (naming: `{project}-{domain}`)
- Pipeline style choice: Traditional (sm→dev→review→tester) or Test-first TDD (sm→tester→review→dev)
- `spawnSync` instead of async `spawn` for interactive sessions (fixes Ink re-render bug)

---

## [0.0.1] — 2026-03-20

### Added

**Core Pipeline**
- Multi-stage AI pipeline orchestration with config-driven stage routing
- SQLite-backed task queue with atomic dequeue (Drizzle ORM)
- Priority queue — stories further in pipeline processed first
- Story dependencies with DAG validation and auto-queue when deps complete
- Session continuity — resume AI sessions on retry (Claude CLI, Gemini CLI)
- Loop detection (max chain length, max stage repeats)
- Crash recovery — interrupted tasks reset to queued on restart
- Consolidated database schema (single `0000_init.sql` migration)

**Providers**
- Claude CLI provider (`claude`, plain text `--verbose` mode)
- Gemini CLI provider (`gemini`, JSON output mode)
- Codex CLI provider (`codex`, OpenAI)
- Provider CLI availability check during `agentkit init`
- File-based output contract (`_agent_kit/.outputs/task-{id}.json`)
- 3-tier output fallback: file → stdout parse → failed
- Session resume for Claude CLI and Gemini CLI

**Dashboard (TUI)**
- Fullscreen Ink/React TUI with BrandHeader + 2x2 grid layout
- CommandMenuPanel (TL) — hierarchical menu/submenu navigation
- ActiveStoriesPanel (TR) — story progress, stage, status, priority
- LiveActivityPanel (BL) — real-time agent output streaming
- DiagnosePanel + PipelineCrew (BR) — health check + ASCII robots
- Dynamic menu: Run/Drain/Stop Pipeline based on pipeline state
- Trace mode — interactive epic → story → task tree browser
- Focus mode — fullscreen single panel
- Inline action wizards (load, ship, diagnose, config, mark-done, reset, cancel)
- Ask Agent (ChatPanel) — AI chat within dashboard

**Story Lifecycle**
- Load epics/stories from markdown with SHA-256 change detection
- Ship stories with multi-select tree picker
- Reset story to earlier stage (soft-mark superseded, preserve traces)
- Cancel story (remove from pipeline)
- Reopen done/cancelled stories
- Mark story done (manual completion)

**Multi-Team Architecture**
- Global `~/.agentkit/` directory for teams and resources (cross-project)
- `agentkit` default team ships bundled (SM → Dev → Review → Tester)
- Custom teams in `~/.agentkit/teams/` — appear in `agentkit init`
- Runtime team switching with task isolation
- Config v2 schema (`activeTeam` + `teams[]` + models per provider)
- `ensureGlobalDir()` syncs bundled resources on every CLI invocation

**CLI Commands (23 total)**
- `agentkit init` — project setup wizard with provider CLI check
- `agentkit start` — fullscreen TUI dashboard
- `agentkit load` — parse markdown, hash comparison, DB sync
- `agentkit ship` — multi-select stories to pipeline
- `agentkit run` — start workers (dashboard or `--simple` headless)
- `agentkit stop` — stop workers
- `agentkit status` — quick pipeline overview
- `agentkit diagnose` — pipeline health diagnostics
- `agentkit trace` — interactive tree browser
- `agentkit inspect` — task detail view
- `agentkit replay` — task replay with playback
- `agentkit history` — execution history
- `agentkit logs` — log viewer
- `agentkit config` — view/edit configuration
- `agentkit switch-team` — switch active team
- `agentkit cleanup` — reclaim database space
- `agentkit update` — update schema + resources
- `agentkit uninstall` — remove AgentKit from project
- `agentkit help` — help system (topics: teams, providers, prompts, pipeline, docs)

**Agents & Workflows**
- 3 bundled agent definitions: Architect, Analyst, Project Manager
- Planning workflow — epic/story creation guide with templates
- Team setup workflow — create/edit/clone teams
- Create team chatbot workflow — full step-by-step interactive guide

**Observability**
- Application logger (dual output: file + EventBus)
- Task log persistence (batch writer, stream events → DB)
- Auto-migration on startup
- Event-driven dashboard updates (zero polling timers)

**Graceful Shutdown**
- Drain pipeline — finish current tasks, cancel queued, no new routing
- Force stop — terminate all workers immediately
- Signal handlers: SIGINT, SIGTERM, uncaughtException
