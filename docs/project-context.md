---
project_name: '@shizziio/agent-kit'
date: '2026-03-21'
version: '0.0.1'
epic_status:
  epic_1_project_foundation: completed
  epic_2_data_loading: completed
  epic_3_cli_interactive_menu: completed
  epic_4_pipeline_engine: completed
  epic_5_dashboard_ui: completed
  epic_6_management_observability: completed
  epic_7_unified_dashboard_logging: completed
  epic_8_dashboard_command_center: completed
  epic_9_dashboard_ux_overhaul: completed
  epic_10_story_lifecycle_management: completed
  epic_11_command_menu_branding_story_management: completed
  epic_12_multi_team_support: completed
  epic_13_file_based_output_contract: completed
  epic_14_consolidate_bundled_resources: completed
  epic_15_bug_fixes_ux_polish: completed
  epic_16_menu_submenu_navigation: completed
  epic_17_dashboard_bug_fixes: completed
  epic_18_auto_migration_system: completed
  epic_19_session_continuity: completed
  epic_20_story_queue_priority: completed
  epic_21_structured_epic_dependencies: completed
  epic_22_gemini_session_resume: completed
  epic_23_pipeline_crew_visualization: in_progress
  epic_24_graceful_pipeline_drain: in_progress
  epic_25_zustand_foundation_dashboard_reorg: in_progress
  epic_26_data_stores_migration: in_progress
  epic_27_service_injection_appstore: in_progress
  epic_28_ui_component_library: in_progress
  epic_29_stage_level_dep_skip: in_progress
  epic_30_multi_team_data_model: completed
  epic_31_multi_team_config_ownership: completed
  epic_32_multi_team_pipeline_sessions: completed
  epic_33_multi_team_dashboard: completed
  epic_34_contract_verification: completed
  epic_35_setup_readiness: completed
  epic_36_master_agent_planning_ask: completed
  epic_37_custom_rules: completed
  epic_38_agent_team_stage_provider: planned
---

# Project Context — Document Index

> **This file is a lightweight index.** Agents MUST lazy-load specific documents below when needed — do NOT read everything upfront.

---

## Quick Overview

**@shizziio/agent-kit** — npm CLI tool for multi-agent AI pipeline orchestration.

- **Tech:** TypeScript, Node.js (ESM), Commander.js CLI, Ink/React TUI, SQLite + Drizzle ORM
- **Package:** `@shizziio/agent-kit`, bin: `agentkit` → `dist/cli/index.js`
- **Providers:** ClaudeCliProvider (plain text `--verbose`), GeminiCliProvider (JSON output), CodexCliProvider
- **Pipeline flow:** Config-driven stages with routing (next, reject_to, reset_to), loop detection, priority queue, story dependencies
- **Output contract:** File-based output (`_agent_kit/.outputs/task-{id}.json`), 3-tier fallback (file → stdout parse → failed)
- **Multi-team:** Global `~/.agentkit/teams/` stores all teams; only `agentkit` ships bundled. `agentkit init` copies selected team to `_agent_kit/teams/`
- **Dashboard:** Unified fullscreen TUI — BrandHeader + 2x2 grid (CommandMenu, ActiveStories, LiveActivity, DiagnosePanel+PipelineCrew), dynamic menu (Run/Drain/Stop Pipeline), inline wizards, trace/focus modes
- **Story lifecycle:** ship → queue → execute → route → done (with reset, cancel, reopen, mark-done, dependencies, priority)
- **Session continuity:** Resume provider sessions on retry (Claude CLI, Gemini CLI)
- **Graceful drain:** Finish current tasks, cancel queued, no new routing (via menu [R] Drain Pipeline)

---

## Directory Structure

```
project-root/
├── docs/                        # Project documentation (user managed, standard)
│   ├── architecture.md
│   ├── architecture-rules.md
│   ├── prd.md
│   └── project-context.md       # This file
├── _agent_kit/                   # Agentkit runtime
│   ├── agentkit.config.json
│   ├── agentkit.db
│   ├── teams/{team}/             # Selected team (copied from ~/.agentkit/teams/)
│   ├── resources/                # Agents + workflows (copied from ~/.agentkit/resources/)
│   │   ├── agents/
│   │   └── workflows/
│   └── logs/
├── _agentkit-output/             # Agentkit-generated artifacts
│   └── planning/                 # Epic folders (epic-{N}/)
└── ~/.agentkit/                  # Global directory (cross-project)
    ├── teams/                    # All teams (synced from bundled + user custom)
    └── resources/                # Agents + workflows
```

---

## Document Map

### Project Documentation

| Document | Path | When to Read |
|----------|------|--------------|
| **Architecture Rules** | `docs/architecture-rules.md` | Naming conventions, project structure, TS rules, DB rules, EventBus, Logger, UI/Ink rules, Testing, Code Review Checklist. **Read FIRST for any implementation task.** |
| **Architecture (system-level)** | `docs/architecture.md` | System diagram, full DB schema, EventMap, Provider/Worker architecture, Config schemas, Dashboard component tree. |
| **PRD** | `docs/prd.md` | Full product requirements, feature set, user flows, development history (24 epics). |

### Agents (in `_agent_kit/resources/agents/`)

| Agent | File | Role |
|-------|------|------|
| **Architect** | `architect.md` | System design, epic/story specification, architecture documentation |
| **Analyst** | `analyst.md` | Requirements gathering, research, codebase analysis, gap analysis |
| **Project Manager** | `project-manager.md` | Sprint planning, progress tracking, scope management, release coordination |

### Workflows (in `_agent_kit/resources/workflows/`)

| Workflow | File | When to Use |
|----------|------|-------------|
| **Planning** | `planning.md` | When creating new epics and story files. Epics stored in `_agentkit-output/planning/epic-{N}/`. |
| **Team Setup** | `team-setup.md` | When creating, editing, or cloning teams. |
| **Create Team** | `create-team.md` | Full chatbot workflow for team creation (detailed step-by-step). |

### Source Code Reference

| Area | Key Paths | When to Read |
|------|-----------|--------------|
| **CLI Commands** | `src/cli/*.ts` (23 files) | When modifying or adding CLI commands |
| **Core Services** | `src/core/*.ts` | Business logic: Queue, StateManager, Logger, ConfigService, LoadService, ShipService, ResetService, MarkDoneService, DiagnoseService, TraceService, DependencyResolver, GlobalSetup, etc. |
| **Workers** | `src/workers/*.ts` | Pipeline, StageWorker, Router, CompletionHandler, SessionManager, PromptLoader, OutputFileManager, OutputResolver, TaskLogWriter |
| **Providers** | `src/providers/**/*.ts` | ClaudeCliProvider, GeminiCliProvider, CodexCliProvider, ProcessManager, GeminiSessionResolver |
| **UI Dashboard** | `src/ui/dashboard/*.tsx` | DashboardApp, GridLayout, CommandMenuPanel, ActiveStoriesPanel, LiveActivityPanel, DiagnosePanel, PipelineCrew, BrandHeader |
| **UI Modules** | `src/ui/{chat,config,diagnose,history,init,inspect,load,logs,mark-done,replay,ship,trace}/*.tsx` | Feature-specific UI components |
| **DB Schema** | `src/core/db/schema.ts` | 4 tables: projects, epics, stories, tasks, task_logs |
| **Type Definitions** | `src/core/{EventTypes,ConfigTypes,PipelineTypes,DiagnoseTypes,QueueTypes}.ts` | Interface contracts |
| **Constants** | `src/config/defaults.ts` | All default values and constants |
| **Shared Utilities** | `src/shared/*.ts` | ChainInputBuilder, FormatTime, Greeting, ResourcePath, GlobalPath |
| **Bundled Team** | `src/resources/teams/agentkit/` | Default team config + prompts (only `agentkit` ships bundled) |
| **Bundled Resources** | `src/resources/project-resources/` | Agents + workflows (copied to ~/.agentkit/resources/ on first run) |
| **Errors** | `src/core/Errors.ts` | AgentKitError hierarchy |
| **Tests** | `tests/**/*.test.ts` | Unit + integration tests |

---

## Epic Status Summary

Epics 1-22, 30-36 completed. Epics 23-29 in progress.

| Epic | Title | Status | Key Additions |
|------|-------|--------|---------------|
| 1 | Project Foundation | ✅ | Scaffolding, DB schema, ConfigLoader, Init wizard |
| 2 | Data Loading | ✅ | MarkdownParser, LoadService, hash-based change detection |
| 3 | CLI Interactive Menu | ✅ | CLI commands, InitWizard, ShipWizard |
| 4 | Pipeline Engine | ✅ | EventBus, Queue, ClaudeCliProvider, StageWorker, Router, TaskLogs, Crash Recovery |
| 5 | Dashboard UI | ✅ | Ink panels, TraceModeLayout, SimpleLogger |
| 6 | Management Observability | ✅ | DiagnoseService, HistoryWizard, Inspect, Replay, Trace, Cleanup, Uninstall |
| 7 | Unified Dashboard & Logging | ✅ | Logger, UnifiedApp, hotkey nav, trace/focus modes |
| 8 | Dashboard Command Center | ✅ | GridLayout 2x2, inline actions, DiagnosePanel, plain text provider |
| 9 | Dashboard UX Overhaul | ✅ | CommandMenu, state isolation, Ship tree picker |
| 10 | Story Lifecycle Management | ✅ | ResetService, reset_to config, superseded handling |
| 11 | Command Menu, Branding & Story Mgmt | ✅ | Arrow nav, MarkDone, BrandHeader ASCII logo, History/Replay inline |
| 12 | Multi-Team Support | ✅ | Config v2, task team isolation, switch team |
| 13 | File-Based Output Contract | ✅ | OutputFileManager, OutputResolver, 3-channel, {{OUTPUT_FILE}} |
| 14 | Consolidate Bundled Resources | ✅ | src/resources/ centralization |
| 15 | Bug Fixes & UX Polish | ✅ | 13 bug fixes and polish items |
| 16 | Menu/Submenu Navigation | ✅ | Menu stack, submenus, ScrollablePanel, ChatPanel, _agent_kit rename |
| 17 | Dashboard Bug Fixes | ✅ | 7 fixes: config, trace, layout |
| 18 | Auto-Migration & Update | ✅ | Auto-migrate on startup, agentkit update CLI |
| 19 | Session Continuity | ✅ | Session names, resume prompts, provider sessionSupport |
| 20 | Story Queue Priority | ✅ | stories.priority, dequeue ordering, auto-increment |
| 21 | Story Dependencies | ✅ | depends_on, waiting status, DependencyResolver, DAG validation |
| 22 | Gemini Session Resume | ✅ | GeminiSessionResolver, session ID mapping |
| 23 | Pipeline Crew Visualization | 🔶 | ASCII robot characters, animation (in progress) |
| 24 | Graceful Pipeline Drain | 🔶 | DrainSignal, cancelAllQueued, drain UI (in progress) |
| 25 | Zustand Foundation + Dashboard Reorg | 🔶 | Feature-based dashboard/ modules, Zustand stores, EventBus bridge, dashboardStore |
| 26 | Data Stores Migration | 🔶 | alertStore, workerStore, crewStore, activityStore, storiesStore — EventBus hooks → Zustand |
| 27 | Service Injection via appStore | 🔶 | appStore for services/db/eventBus/config, props drilling cleanup |
| 28 | UI Component Library | 🔶 | Table component, WizardShell, shared format utilities |
| 29 | Stage-Level Dep Skip Config | 🔶 | skipDeps/skipDepsLevel per stage, waiting_stage column, Router dep check |
| 30 | Multi-Team Data Model + Contracts | ✅ | epics.team column, ParsedEpic.team, epic.json team field, contracts/ discovery |
| 31 | Multi-Team Config + File Ownership | ✅ | activeTeams[], defaultTeam, maxConcurrentSessions, ownership in TeamConfig, ConfigLoader.loadAll(), multi-team Init wizard |
| 32 | Multi-Team Pipeline + Session Control | ✅ | Pipeline spawns workers per team, config freeze, ShipService per-epic team, DependencyResolver multi-team, ProcessManager semaphore, PromptLoader ownership/contracts injection |
| 33 | Multi-Team Dashboard | ✅ | BrandHeader team badges + session count, ActiveStories team column, PipelineCrew team switching [T], LiveActivity team/stage badge |
| 34 | Contract Verification in Pipeline | ✅ | parseConsumedContracts from architect.md, buildConsumedContractsSection for review/tester prompts, architect agent CC capability + contract creation instructions |
| 35 | Project Setup Readiness | ✅ | ReadinessChecker (docs/team/epics), InteractiveSession utility (reusable provider spawn), SetupMenu UI, `agentkit setup` command, readiness gate in `agentkit start`, team auto-suggestion in create-team workflow |
| 36 | Master Agent + Planning & Ask Menus | ✅ | agent-kit-master agent (Atlas), `agentkit planning` + `agentkit ask` CLI commands, dashboard Create Planning + Ask AgentKit menu items with worker-running check |
| 37 | Custom Rules | ✅ | RulesService (scan/load/toggle), rule files in `_agentkit-output/rules/*.md`, enabled state in config, prompt injection via buildRulesSection, dashboard Custom Rules [U] toggle panel |
| 38 | Agent Team Stage Provider | 📋 | AgentTeamConfig on StageConfig, buildTeamLeadSection prompt, ProcessManager slot reservation, env injection, dashboard team badges, timeout multiplier |

---

_Lightweight document index — agents should read specific files listed above, not load everything._
