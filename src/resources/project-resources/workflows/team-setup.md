# Workflow: Team Setup

> Reference workflow for creating, editing, and cloning teams in agent-kit.
> Full implementation at `src/resources/workflows/create-team.md`.

## Overview

This workflow supports 4 modes:

- **Reuse** — Copy an existing team from `~/.agentkit/teams/` and customize prompts for this project
- **Create** — Build a new team config and prompts from scratch
- **Edit** — Modify an existing team (stages, models, prompts)
- **Clone** — Copy an existing project team and customize it

## Phases

### Phase 0: Load Project Context
- Read `docs/prd.md`, `docs/architecture-rules.md`, `docs/project-context.md`
- Read existing team configs at `_agent_kit/teams/*/config.json`
- **Scan `~/.agentkit/teams/` for previously created teams** — offer to reuse
- Summarize understanding before asking the user any questions

### Phase 1: Team Design
- **Check existing global teams** — if found, ask user if they want to reuse one
- If reusing: copy team config, regenerate prompts using THIS project's context
- If creating new: suggest teams based on project architecture domains (frontend/backend/mobile)
- Ask pipeline style: Traditional (sm→dev→review→tester) or Test-first (sm→tester→review→dev)
- Define file ownership (multi-team only): `include`/`exclude` glob patterns

### Phase 2: Prompt Generation
- Create prompt file for each stage **using project context** (not generic stubs)
- SM prompt: understand this project's tech stack, conventions, and architecture to plan implementations
- Dev prompt: know the project's coding patterns, file structure, test framework
- Review prompt: check against this project's architecture rules and conventions
- Tester prompt: know the project's test framework, coverage expectations, build commands
- Include OUTPUT CONTRACT block with `{{OUTPUT_FILE}}`
- Include `{{TASK_INPUT}}`, `{{STORY_TITLE}}` placeholders

### Phase 3: Validation
- Validate config.json schema (including `ownership` if set)
- Verify stage routing (next, reject_to) forms a valid pipeline
- Check models are in allowed list per provider
- Verify prompt files exist and contain project-specific context
- Update `agentkit.config.json`: append to `teams[]` and `activeTeams[]` (if multi-team)

## Output

```
_agent_kit/teams/{team-name}/
├── config.json
└── prompts/
    ├── sm.md          # Project-aware implementation planner
    ├── dev.md         # Project-aware developer
    ├── review.md      # Project-aware code reviewer
    └── tester.md      # Project-aware QA tester
```

## Full Implementation

See `src/resources/workflows/create-team.md` for the full chatbot workflow with detailed step-by-step instructions.
