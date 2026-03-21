# Workflow: Planning — Create Epic and Story Files

This document guides the creation of structured documentation for a new Epic.

## 1. Directory Structure

```
project-root/
├── docs/                           # Project documentation (user managed)
│   ├── architecture.md
│   ├── architecture-rules.md
│   ├── prd.md
│   └── project-context.md
├── _agent_kit/
│   └── resources/                  # Agentkit resources (copied on init)
│       ├── agents/
│       └── workflows/
│           └── planning.md         # This file
└── _agentkit-output/
    └── planning/                   # Epic folders live here
        ├── epic-{N}/
        │   ├── epic.json           # Structured metadata + dependency graph
        │   ├── epic.md             # Human-readable summary
        │   ├── architect.md        # Architecture design for this Epic
        │   └── stories/
        │       ├── story-{N.1}.md
        │       └── story-{N.2}.md
        └── epic-{N+1}/
```

## 2. Template: `epic.json` (Structured Metadata)

`epic.json` is the source of truth for the story list and dependency graph. The pipeline uses this file to parse stories and enforce execution order.

```json
{
  "$schema": "agentkit-epic-v1",
  "key": "{N}",
  "title": "{Epic Title}",
  "team": "{team-name}",
  "dependsOn": ["{M}"],
  "stories": [
    {
      "key": "{N}.1",
      "title": "{Story Title}",
      "file": "stories/story-{N}.1.md",
      "dependsOn": []
    },
    {
      "key": "{N}.2",
      "title": "{Story Title}",
      "file": "stories/story-{N}.2.md",
      "dependsOn": ["{N}.1"]
    }
  ]
}
```

**Rules:**
- `$schema` must always be `"agentkit-epic-v1"`
- `key` must match the folder name `epic-{N}`
- `team` assigns the epic to a pipeline team. Optional in single-team projects (defaults to the project's `defaultTeam`). Required in multi-team projects. Must match a team name from the project's team registry.
- `file` is a relative path from the epic folder
- Epic-level `dependsOn` is an array of epic keys (cross-epic). All stories of dep epics must be done before this epic's stories can ship. Omit or use `[]` for no epic dependencies.
- Story-level `dependsOn` is an array of story keys within the same epic (intra-epic only)
- Stories with no dependencies use `"dependsOn": []`
- Both epic and story dependency graphs must be DAGs (no cycles)

## 3. Template: `epic.md` (Human-Readable Summary)

```markdown
# Epic {N}: {Title}

{1-2 sentence description of the goal}

**FRs covered:** FRx, FRy

## Stories

| Key | Title | Status |
| :--- | :--- | :--- |
| {N}.1 | {Story Title} | Todo |

---
_See architecture details at [architect.md](architect.md)_
```

## 4. Template: `architect.md` (Epic Specific)

```markdown
# Epic {N}: Architecture — {Title}

## 1. Data Components
{Describe tables, schema, or state changes}

## 2. New Services/Logic
{Describe new classes, interfaces}

## 3. Cross-Team Contracts (if multi-team project)
{Only include this section when the epic touches boundaries shared with other teams.}
{Contracts live INSIDE the epic folder — they are part of the epic's architecture, not external docs.}

### Contracts this epic PRODUCES:
- **{ContractName}** — `contracts/{contract-name}.contract.md` (relative to epic folder)
  - Interface/API: {TypeScript types, endpoints, data schemas}
  - Consumers: {which teams/epics depend on this}

### Contracts this epic CONSUMES:
- **{ContractName}** — from `epic-{M}/contracts/{name}.contract.md`
  - Must be stable before this epic's dev stage begins

### Contract files go in:
```
_agentkit-output/planning/epic-{N}/
├── epic.json
├── epic.md
├── architect.md
├── contracts/                    # ← Contracts live here
│   ├── auth-api.contract.md
│   └── user-types.contract.md
└── stories/
```

### Contract File Format:
```markdown
# Contract: {Name}

**Owner:** team-{name} (epic {N})
**Status:** draft | stable | deprecated
**Consumers:** team-{x} (epic {M}), team-{y} (epic {K})

## Interface
{TypeScript types, API endpoints, or data schemas — the actual contract}

## Rules
- {Breaking change policy}
- {Versioning approach}
```

The pipeline injects contract content into story prompts via `architect.md` references, so agents implementing stories have full contract visibility.

---
_See general rules at [architecture-rules.md](../../../docs/architecture-rules.md)_
```

## 5. Template: Story File (Self-Contained)

```markdown
# Story {N.M}: {Title}

## Epic Context
Epic {N}: {Title} — {1 sentence summary}

_See architecture at [architect.md](../architect.md) · General rules at [architecture-rules.md](../../../../docs/architecture-rules.md)_

## Architecture Notes
- {Key architecture notes from architect.md}
- {Only include what this story needs}

## Story Content
As a {role}, I want {action}, So that {benefit}.

**Acceptance Criteria:**
**Given** ... **When** ... **Then** ...
```

## 6. Decision Table: Where to Put What

| Type of Information | Where to Place It |
|---|---|
| Naming conventions, logging, error handling, Ink TUI rules | `architecture-rules.md` |
| Navigation rules, global patterns that apply everywhere | `architecture-rules.md` |
| DB schema, state machine, new service/interface for the Epic | `epic-{N}/architect.md` |
| Component tree, file change table, data flow for the Epic | `epic-{N}/architect.md` |
| System-level diagrams (pipeline flow, worker lifecycle) | `architecture.md` |
| TypeScript interface contracts (StreamEvent, StageConfig, ...) | `architecture.md` |
| Provider/Worker/Config type definitions system-wide | `architecture.md` |
| New top-level EventBus event payload types | `architecture.md` Section 3 |
| Cross-team API/interface contracts | `epic-{N}/contracts/{name}.contract.md` |
| Cross-team data schemas or shared types | `epic-{N}/contracts/{name}.contract.md` |

---

## 7. Post-Creation Updates (Mandatory after creating Epic & Stories)

After writing all stories, the agent **MUST** review and update documentation:

### 7.1 — Review `epic-{N}/architect.md`

- [ ] Are there new patterns or rules that apply **system-wide**? → Move to `architecture-rules.md`
- [ ] Are there **new TypeScript interfaces** or **event payload shape changes**? → Update `architecture.md`
- [ ] Have any **system-level diagrams** changed? → Update `architecture.md` Section 1

### 7.2 — Review `architecture-rules.md`

- [ ] Are there old rules that are **replaced** or **conflict** with the new design? → Update/remove old rules
- [ ] Are there new rules from this Epic that should be added? → Add to appropriate section

### 7.3 — Review `architecture.md`

- [ ] Are there **new or changed TypeScript interfaces**? → Update interface blocks
- [ ] Are there **new EventBus event types**? → Add to Section 3
- [ ] Are there **system-level Provider/Worker/Config changes**? → Update corresponding Section

### 7.4 — Update `project-context.md`

Add the new Epic to the **Epic Status Summary** table in `docs/project-context.md`. Epic folders are stored in `_agentkit-output/planning/epic-{N}/`.

### 7.5 — Review Cross-Team Contracts (if multi-team project)

- [ ] Does this epic **produce** interfaces/APIs used by other teams? → Create `epic-{N}/contracts/{name}.contract.md`
- [ ] Does this epic **consume** contracts from other epics? → Verify source contract files exist and are stable
- [ ] Are there **breaking changes** to existing contracts? → Update contract status to `deprecated`, create new version
- [ ] Is each contract file **complete**? (owner, status, consumers, interface definition, rules)

### 7.6 — Completion Checklist

- [ ] `epic-{N}/epic.json` — All stories present, dependency graph is a DAG, `file` paths correct, `team` field set
- [ ] `epic-{N}/epic.md` — All stories listed, FRs covered, matches epic.json
- [ ] `epic-{N}/architect.md` — Has state/data model, file change table, cross-team contracts section (if applicable)
- [ ] `epic-{N}/stories/story-{N.x}.md` — Each story has Epic Context, Architecture Notes, testable ACs
- [ ] `architecture-rules.md` — No conflicts with new Epic design
- [ ] `architecture.md` — Interfaces and type contracts updated if changed
- [ ] `epic-{N}/contracts/` — Contract files created if this epic produces/consumes cross-team interfaces
- [ ] `docs/project-context.md` — Epic Status Summary table updated

## 8. Completion

When all epic files, story files, and documentation updates are done, you MUST end with this exact message:

```
✅ Planning complete. Exit this session and run `agentkit start` to continue.

Next step: In the AgentKit dashboard, use "Load Story" to load your new epic files, then "Ship Story" to queue them for the pipeline.
```

This tells the user the workflow is done and they should return to the AgentKit dashboard.
