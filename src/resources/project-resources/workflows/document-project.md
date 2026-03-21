# Workflow: Document Project

> Generate project documentation by scanning the codebase. Use with the **Tech Writer** agent (`agents/tech-writer.md`).

## Overview

This workflow produces up to 4 documents in `docs/` at the project root:

| Document | Required | Purpose |
|----------|----------|---------|
| `docs/architecture.md` | Yes | System design, DB schema, type contracts, data flow |
| `docs/architecture-rules.md` | Yes | Coding conventions extracted from codebase |
| `docs/project-context.md` | Yes | Lightweight index for agents and humans |
| `docs/prd.md` | Optional | Product requirements (user interview) |

## Prerequisites

- Project has source code to scan
- `agentkit init` has been run (for AgentKit projects)
- No existing docs required — this workflow creates them from scratch

## How to Use

1. Load the Tech Writer agent as context for your AI assistant:
   ```
   _agent_kit/resources/agents/tech-writer.md
   ```

2. Tell the agent: **"DP"** (Document Project)

3. The agent will:
   - Scan your project metadata (package.json, configs, git history)
   - Map your source directory structure
   - Deep-read core files (schema, types, business logic, API, UI, config)
   - Extract naming conventions, patterns, and layer rules
   - Generate 3 documents (+ optional PRD)
   - Present results for review

4. Review and save to `docs/`

## Output Location

All documents are written to `docs/` at the project root:

```
my-project/
├── docs/
│   ├── architecture.md          # System design reference
│   ├── architecture-rules.md    # Coding conventions
│   ├── project-context.md       # Document index
│   └── prd.md                   # Product requirements (optional)
├── _agent_kit/                   # AgentKit runtime
└── src/                          # Source code (scanned)
```

## When to Run

| Situation | Action |
|-----------|--------|
| New project, no docs | Run full DP workflow |
| Major refactor completed | Run full DP to regenerate |
| Small feature added | Use UD (Update Docs) instead |
| Docs feel stale | Use AD (Audit Docs) to check accuracy first |

## Tips

- Run DP early — having architecture docs helps the pipeline agents write better code
- Re-run after major milestones to keep docs current
- The PRD step is optional — skip it if you already have requirements elsewhere
- project-context.md is the entry point for all agents — keep it concise

## Completion

When all documents have been generated and saved, you MUST end with this exact message:

```
✅ Documentation complete. Exit this session and run `agentkit start` to continue.
```

This tells the user the workflow is done and they should return to the AgentKit dashboard.
