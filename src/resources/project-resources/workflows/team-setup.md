# Workflow: Team Setup

> Reference workflow for creating, editing, and cloning teams in agent-kit.
> Full implementation at `src/resources/workflows/create-team.md`.

## Overview

This workflow supports 3 modes:

- **Create** — Build a new team config and prompts from scratch
- **Edit** — Modify an existing team (stages, models, prompts)
- **Clone** — Copy an existing team and customize it

## Phases

### Phase 0: Load Project Context
- Read `docs/prd.md`, `docs/architecture-rules.md`, `docs/project-context.md`
- Read existing team configs at `_agent_kit/teams/*/config.json`
- Summarize understanding before asking the user any questions

### Phase 1: Team Design
- Define domain and pipeline flow
- Define stages (name, displayName, icon, routing)
- Select models per provider (keyed by provider name, e.g. `claude-cli`)
- Set workers, timeout, retries per stage
- Define file ownership (multi-team only): `include`/`exclude` glob patterns

### Phase 2: Prompt Generation
- Create prompt file for each stage
- Inject project context and conventions
- Include OUTPUT CONTRACT block with `{{OUTPUT_FILE}}`
- Include `{{TASK_INPUT}}`, `{{STORY_TITLE}}` placeholders
- For review/tester stages: add contract verification awareness (consumed contracts are injected at runtime)

### Phase 3: Validation
- Validate config.json schema (including `ownership` if set)
- Verify stage routing (next, reject_to) forms a valid pipeline
- Check models are in allowed list per provider
- Verify prompt files exist
- Update `agentkit.config.json`: append to `teams[]` and `activeTeams[]` (if multi-team)

## Output

```
_agent_kit/teams/{team-name}/
├── config.json
└── prompts/
    ├── {stage-1}.md
    ├── {stage-2}.md
    └── ...
```

## Full Implementation

See `src/resources/workflows/create-team.md` for the full chatbot workflow with detailed step-by-step instructions.
