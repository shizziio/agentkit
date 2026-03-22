# Team Workflow — Create, Edit & Clone

> **For AI/Chatbot Use Only** — This file guides the chatbot through creating a new team, editing an existing team, or cloning a team.
> Do NOT execute this file as code. Read it and follow each step conversationally with the user.

---

## Overview

This workflow supports three modes:

- **Create** — Build a new team config and prompts from scratch
- **Edit** — Modify an existing team (stages, models, prompts)
- **Clone** — Copy an existing team and customise it

All modes share Phase 0 (Load Context) and Phase 3 (Validation). Edit and Clone have dedicated flows.

---

## Phase 0: Load Project Documents

> **Start here before asking any team questions.**

### 0.1 — Auto-discover documents

Scan for the following files and read all that exist:

| Priority | Path | Purpose |
|----------|------|---------|
| High | `docs/prd.md` | Product requirements |
| High | `docs/architecture-rules.md` | Tech conventions & constraints |
| Medium | `docs/project-context.md` | Project overview for AI |
| Medium | `CLAUDE.md` | Project overview (alternate) |
| Low | `_agent_kit/teams/*/config.json` | Existing team configs (as reference) |
| Low | `_agent_kit/teams/*/prompts/*.md` | Existing prompts (as reference) |
| Low | `_agent_kit/agentkit.config.json` | Current active team & project info |

### 0.2 — Fallback if documents not found

If no documents are found at any standard path:
- Tell the user: "I couldn't find standard project documents at the expected paths."
- Ask: "Please either (a) provide file paths manually, or (b) describe your project context here (domain, tech stack, conventions)."
- Accept whatever the user provides and continue with Phase 1.
- If the user declines to provide context (says "skip", "proceed anyway", or similar): continue to Phase 1 without blocking. Generate generic prompt stubs in Phase 2 with `<!-- TODO: Customize with project-specific context -->` comments. Do NOT ask again — the user's choice to skip is final for this session.

### 0.3 — Context Summary

After loading documents, summarize your understanding **before asking any team questions**:

```
I've loaded the following project documents: [list files found]

Here's what I understood:
- Domain: [e.g., "Novel writing tool", "SaaS analytics platform", "Mobile game backend"]
- Tech stack: [e.g., "TypeScript, Bun, SQLite/Drizzle ORM, React"]
- Key conventions: [e.g., "Kebab-case files, functional components, no classes"]
- Existing teams: [list team names found in _agent_kit/teams/]
- Active team: [from agentkit.config.json activeTeam field]
- Active teams (multi-team): [from agentkit.config.json activeTeams[] if set]
- Multi-team mode: [Yes if activeTeams has >1 entry, No otherwise]

Does this look correct? Any corrections before we design your new team?
```

Wait for user confirmation or corrections. Update your context understanding accordingly.

---

## Phase 1: Collect Team Information

### 1.1 — Choose Team Template

AgentKit ships with 2 built-in team templates. Present them first:

```
Choose a team template:

  (a) Software Developer — Traditional
      Pipeline: SM → Dev → Review → Tester
      Plan first, implement, review code, then test.

  (b) Software Developer — Test-Driven (TDD)
      Pipeline: SM → Tester → Review → Dev
      Plan first, write tests, review tests, then implement.

  (c) Reuse existing teams from ~/.agentkit/teams/
  (d) Create a custom team from scratch
  (e) Edit an existing project team
```

**Built-in templates** are located at `_agent_kit/resources/teams/software-dev/` and `_agent_kit/resources/teams/software-dev-tdd/`. Read their `config.json` for the stage configuration.

---

**If user picks (a) or (b) — built-in template:**

The user can create **multiple teams** at once from the same template. After choosing a template:

**Step 1:** Scan the project (same as 1.2) and suggest domains:
```
Template: Software Developer (Traditional)

Based on your project, I suggest these teams:

  [x] {project}-frontend   Ownership: src/ui/**, src/components/**
  [x] {project}-backend    Ownership: src/api/**, src/services/**, src/core/**
  [ ] {project}-mobile     Ownership: src/mobile/**

[Space] toggle  [Enter] confirm  [N] add custom domain
```

- User toggles which domains to create (default: all suggested)
- User can add custom domains via [N]
- Each domain becomes a team with the chosen template's stage config
- All teams share the same pipeline style (Traditional or TDD)

**Step 2:** For each selected domain, confirm details:
```
Creating 2 teams from "Software Developer" template:

  1. {project}-frontend  "Frontend Development"
     Ownership: ["src/ui/**", "src/components/**"]

  2. {project}-backend  "Backend Development"
     Ownership: ["src/api/**", "src/services/**", "src/core/**"]

Modify any team before creating? [Y/N]
```

**Step 3:** Create all teams sequentially:
- For each team: copy template config → set team name, displayName, ownership → regenerate prompts with project context (Phase 2) → update `agentkit.config.json`
- After ALL teams are created, show summary

---

**If user picks (c) — reuse existing:**

Scan `~/.agentkit/teams/` for previously created teams. User can select **multiple**:

```
Existing teams in ~/.agentkit/teams/:

  [ ] janitor-frontend  (sm → dev → review → tester)
  [ ] janitor-backend   (sm → dev → review → tester)
  [ ] google-veo3       (sm → dev → review → tester)

[Space] toggle  [Enter] confirm
```

For each selected team:
1. Copy the `config.json` to `_agent_kit/teams/{team-name}/`
2. Ask if user wants to rename for this project (e.g., `janitor-frontend` → `myapp-frontend`)
3. **Do NOT copy prompt files** — regenerate them for THIS project (Phase 2)
4. After ALL teams processed, update `agentkit.config.json` with all new teams

---

**If user picks (d):** continue with 1.2 (single custom team).
**If user picks (e):** jump to **Edit Flow**.

### 1.2 — Team Suggestions (Auto-Analyze)

Before asking the user to define a team manually, you MUST analyze the project and suggest teams.

**Step 1: Scan the project structure**

Read these in order:
1. `docs/project-context.md` — project name, tech stack, directory structure
2. `docs/architecture.md` — system layers, component boundaries
3. Source directory listing — `ls src/` (or equivalent) to identify functional areas

**Step 2: Identify major architecture domains**

Teams should map to **high-level architecture domains**, NOT individual subdirectories. Think in terms of:
- **Frontend** — all UI/client code (may span multiple dirs: components, pages, hooks, styles)
- **Backend** — all server/API code (may span: api, services, db, workers)
- **Mobile** — mobile app code (if separate from web frontend)
- **Infrastructure** — CI/CD, deployment, infra-as-code (if applicable)
- **Shared/Core** — shared libraries used across domains (usually NOT a separate team — shared code goes to the team that owns the contract)

**IMPORTANT:** Do NOT create a team per subdirectory. A team owns an entire domain with multiple directories.

Examples of GOOD team boundaries:
- `janitor-frontend` owns: `src/ui/**`, `src/components/**`, `src/hooks/**`, `src/styles/**`
- `janitor-backend` owns: `src/api/**`, `src/services/**`, `src/core/**`, `src/workers/**`
- `janitor-mobile` owns: `src/mobile/**`, `src/native/**`

Examples of BAD team boundaries (too granular):
- ❌ `app-content` for just `src/content/`
- ❌ `app-background` for just `src/background/`
- ❌ `app-sidepanel` for just `src/sidepanel/`
→ These should be ONE team: `app-frontend` owning all of `src/content/**`, `src/background/**`, `src/sidepanel/**`

**Step 3: Generate team suggestions**

**Naming convention:** `{project-short-name}-{domain}` in kebab-case.
- Use a short project name (e.g., "janitor" not "janitor-cleaning-app")
- Domain is one of: `frontend`, `backend`, `mobile`, `infra`, `core`, or a domain-specific name

**Step 4: Ask pipeline style**

Before presenting team suggestions, ask the user which pipeline style they prefer:

```
Which pipeline style do you prefer?

  (a) Traditional: sm → dev → review → tester
      Plan first, implement, then review and test.

  (b) Test-first (TDD): sm → tester → review → dev
      Plan first, write tests, review test cases, then implement.

  (c) Custom — I'll define my own stage order
```

Use the selected style for all suggested teams. If user picks (c), skip suggestions and go to Stage Design (1.4).

**Step 5: Present suggestions with full detail**

```
Based on your project architecture, I suggest these teams:

  Pipeline style: {Traditional | Test-first (TDD)}

  1. {project}-frontend  "Frontend Development"
     Scope: All client-side code
     Stages: {stages based on chosen style}
     Ownership: include: ["src/ui/**", "src/components/**", "src/hooks/**"]

  2. {project}-backend  "Backend Development"
     Scope: All server-side code
     Stages: {stages based on chosen style}
     Ownership: include: ["src/api/**", "src/services/**", "src/core/**"]

Already configured: [list or "none"]

Options:
  (a) Create suggested team #N
  (b) Create all suggested teams one by one
  (c) Create a custom team from scratch
```

**Step 5: On selection**

When user picks a suggestion:
- Pre-fill: `team` name, `displayName`, `ownership.include` patterns, stages
- Walk through model selection and confirmation
- Allow modifications to any pre-filled value

If user picks "create all":
- Walk through each team creation sequentially
- After each team is created, update `agentkit.config.json` before proceeding to the next

If the project has no docs or source structure is flat (single directory), skip suggestions and go to 1.3 directly.

### 1.3 — Team Identity

Ask the following questions (one at a time or as a group — your judgment):

**Team name** (required)
- Must be kebab-case (e.g., `content-team`, `qa-team`, `marketing`)
- Must not already exist in `_agent_kit/teams/`
- Must not already be listed in `agentkit.config.json` `teams[]` array
- Suggest a name based on context if the user describes a purpose

**Display name** (required)
- Human-readable, any case (e.g., "Content Creation Pipeline")

### 1.4 — Stage Design

This is the most important step. Use loaded project context to suggest stages.

**Make domain-aware suggestions:**

| Domain type | Suggested stages |
|-------------|-----------------|
| Software development | sm → dev → review → tester |
| Novel / creative writing | outliner → writer → editor → proofreader |
| Content marketing | researcher → writer → editor → publisher |
| Data pipeline | extractor → transformer → validator → loader |
| Game design | designer → scripter → playtester → balancer |
| Generic / unknown | planner → executor → reviewer |

Present your suggestion, explain the rationale based on what you read, then ask:
> "Here are suggested stages based on your project context: [list]. Want to use these, modify them, or define your own?"

**For each stage, collect:**

| Field | Requirement | Suggestion logic |
|-------|-------------|-----------------|
| `name` | kebab-case, unique within team | Lowercase of display name |
| `displayName` | Human-readable | Based on role |
| `icon` | Single emoji | Match role personality |
| `timeout` | Seconds, integer > 0 | Creative/complex: 600, mechanical: 300, review: 300 |
| `workers` | Integer ≥ 1 | Usually 1; parallel-safe stages can use 2+ |
| `retries` | Integer ≥ 0 | Final-stage workers: 2-3; others: 0 |
| `next` | Name of next stage, or omit for terminal | Follow the linear flow |
| `reject_to` | Name of stage to send failed work, or omit | Typically the stage before |
| `reset_to` | Array of stage names user can reset to | All stages up to and including this one |

**Model assignments:**
- Ask which model to use per stage: `opus`, `sonnet`, or `haiku`
- Suggest based on complexity:
  - High-creativity or complex reasoning stages → `opus` or `sonnet`
  - Mechanical, repetitive, or fast-turnaround stages → `haiku`
- Example: "For a proofreader stage that just checks grammar, I'd suggest `haiku`. For a creative writer stage, I'd suggest `sonnet` or `opus`. Does that work?"

### 1.5 — File Ownership (Multi-Team Only)

If the project uses multiple teams, ask about file ownership:

> "In multi-team projects, each team can declare which files/directories it owns. This prevents cross-team file conflicts. Do you want to define file ownership for this team?"

If yes, collect:
- **include** (required): glob patterns of files this team owns (e.g., `["src/api/**", "src/services/**"]`)
- **exclude** (optional): glob patterns to exclude from ownership (e.g., `["src/api/shared/**"]`)

File ownership rules are injected into every stage prompt by the pipeline. Agents are instructed to only modify files matching the include patterns.

If the project is single-team, skip this step — ownership is optional and has no effect.

### 1.6 — Validation Rules

Before moving to Phase 2, validate all collected info:

**Team-level checks:**
- [ ] `team` field is kebab-case: matches `/^[a-z][a-z0-9-]*$/`
  - If the user provides a name with uppercase letters or spaces, **reject it** and suggest the kebab-case equivalent. Example: user types "Content Team" → respond: "Team names must be kebab-case. Did you mean `content-team`?"
  - Error message: "Invalid team name '{input}'. Team names must be lowercase letters, digits, and hyphens only (e.g., `{suggested-kebab}`). Please try again."
- [ ] `team` name does not already exist in `_agent_kit/teams/` directory (even if not in agentkit.config.json — directory is checked first)
- [ ] `team` name not already in `agentkit.config.json` `teams[]` array (config is the source of truth — reject even if directory doesn't exist)
- [ ] At least one stage defined

**Stage-level checks (for each stage):**
- [ ] `name` is kebab-case: matches `/^[a-z][a-z0-9-]*$/`
- [ ] `name` is unique within the team (no duplicate stage names)
- [ ] `timeout` is a positive integer
- [ ] `workers` is a positive integer (≥ 1)
- [ ] `retries` is a non-negative integer (≥ 0)
- [ ] `next` (if set) references an existing stage name within this team
- [ ] `reject_to` (if set) references an existing stage name within this team
- [ ] `reset_to` (if set) contains only valid stage names within this team
- [ ] No orphan stages: every stage is reachable via `next` from the first stage, or is the first stage
- [ ] At least one stage must be a **terminal stage** (has no `next` field) — if every stage has a `next`, flag as error: "Your pipeline has no terminal stage. At least one stage must omit the `next` field to signal the end of the flow."

**Model checks:**
- [ ] All model values are one of: `opus`, `sonnet`, `haiku`
- [ ] Every stage has a model assigned in `defaults`

If any check fails, tell the user which check failed and what to fix. Re-ask only the affected fields.

---

## Phase 2: Generate Config & Prompts

### 2.1 — Create directory structure

Create the following directories (if they don't exist):
```
_agent_kit/teams/{teamName}/
_agent_kit/teams/{teamName}/prompts/
```

### 2.2 — Generate config.json

Write `_agent_kit/teams/{teamName}/config.json` using this exact structure (TeamConfig interface):

```json
{
  "team": "{teamName}",
  "displayName": "{displayName}",
  "version": 1,
  "models": {
    "claude-cli": {
      "allowed": ["opus", "sonnet", "haiku"],
      "defaults": {
        "{stageName1}": "{model1}",
        "{stageName2}": "{model2}"
      }
    }
  },
  "stages": [
    {
      "name": "{stageName}",
      "displayName": "{stageDisplayName}",
      "icon": "{icon}",
      "prompt": "./prompts/{stageName}.md",
      "timeout": 300,
      "workers": 1,
      "retries": 0,
      "next": "{nextStageName}",
      "reject_to": "{rejectStageName}",
      "reset_to": ["{stageName1}", "{stageName2}"]
    }
  ],
  "ownership": {
    "include": ["src/api/**", "src/services/**"],
    "exclude": []
  }
}
```

**Notes:**
- Omit `next` from the final (terminal) stage
- Omit `reject_to` if the stage has no rejection path
- The `prompt` field is always `"./prompts/{stageName}.md"` (relative path)
- `version` is always `1` for new teams
- `models` is keyed by provider name (e.g., `claude-cli`, `gemini-cli`)
- `ownership` is optional — only include in multi-team projects

### 2.3 — Generate prompt files

Write `_agent_kit/teams/{teamName}/prompts/{stageName}.md` for **each** stage.

**CRITICAL:** Every prompt MUST be **project-specific**. Use the project docs loaded in Phase 0 to inject real project context — NOT generic placeholders.

**What to extract from project docs for each prompt:**
- From `docs/project-context.md`: project name, domain, tech stack, directory structure
- From `docs/architecture.md`: layer rules, DB schema, key interfaces, component patterns
- From `docs/architecture-rules.md`: naming conventions, import rules, error handling patterns, test patterns

---

#### SM (Scrum Master / Implementation Planner) prompt — `prompts/sm.md`

The SM must understand THIS project to create good implementation plans.

**Include in the prompt:**
- Project name and what it does (from project-context)
- Tech stack: language, runtime, framework, database, UI framework
- Directory structure: where source files live, where tests go
- Naming conventions: file naming, variable naming, class naming
- Key architecture patterns: EventBus? Provider pattern? Layer rules?
- What a good implementation plan looks like for THIS project

**SM skills for THIS project:**
- Know which directories to suggest for new files
- Know which existing patterns to follow (e.g., "follow the Service pattern in src/core/")
- Know the test framework and where tests go (e.g., "tests/unit/{module}.test.ts")
- Reference actual architecture rules from docs

---

#### Dev (Developer) prompt — `prompts/dev.md`

The Dev must know how to write code that fits THIS project.

**Include in the prompt:**
- All tech stack details (language version, strict mode, ESM vs CJS)
- Coding patterns: functional vs OOP, class conventions, error handling
- Import conventions: path aliases, import ordering
- Database patterns: ORM usage, migration rules, transaction patterns
- UI patterns: component structure, state management, styling approach
- Test requirements: framework, coverage expectations, mock patterns
- Build/type-check command (e.g., `npx tsc -p tsconfig.src.json --noEmit`)
- What NOT to do (e.g., "NEVER run npm run build", "NEVER use any type")

**Dev skills for THIS project:**
- Write code that matches existing file patterns
- Use the project's error handling approach
- Follow the project's layer dependency rules
- Know which commands to run for validation

---

#### Review (Code Reviewer) prompt — `prompts/review.md`

The Reviewer must check code against THIS project's standards.

**Include in the prompt:**
- Architecture rules: layer boundaries, forbidden imports, dependency direction
- Naming conventions: exact patterns from architecture-rules.md
- Error handling standards: custom error classes, no swallowed catches
- Test standards: what tests are expected, coverage requirements
- Security checklist items specific to this project
- Performance concerns specific to this domain

**Reviewer skills for THIS project:**
- Check imports follow the project's path alias conventions
- Verify new modules are in the correct directory per architecture
- Check DB queries follow the project's transaction patterns
- Verify error types match the project's error hierarchy

---

#### Tester (QA Engineer) prompt — `prompts/tester.md`

The Tester must know how to verify code in THIS project.

**Include in the prompt:**
- Test framework: vitest, jest, mocha, etc.
- Test file location: where tests live, naming convention
- How to run tests: exact command (e.g., `npm test`, `npx vitest run`)
- Type-check command: exact command
- What to check: acceptance criteria verification approach
- Build constraints: what NOT to run (e.g., "NEVER run npm run build")

**Tester skills for THIS project:**
- Run the correct test commands
- Write tests matching the project's test patterns
- Know what assertions to use
- Know how to mock dependencies in this project's style

---

#### Prompt template structure

Each prompt file must follow this structure:

```markdown
# {StageDisplayName} — {Short Role Description}

{Role description referencing THIS project specifically}

## Project Context

{Project name}: {what it does}
Tech: {language}, {runtime}, {framework}, {database}
Source: {directory layout summary}

## Tech Stack & Conventions

{Actual conventions extracted from docs — NOT generic ones}

## Your Responsibilities

{Stage-specific duties using project-specific language}

## Quality Standards

{What good output looks like, referencing project standards}

## Story Context

**Story:** {{STORY_TITLE}}

{{STORY_CONTENT}}

## Instructions

{{TASK_INPUT}}

## OUTPUT CONTRACT

You MUST save your result using the Write tool to this exact path:
{{OUTPUT_FILE}}

The file must contain ONLY valid JSON matching this schema:
{stage-specific JSON schema}

IMPORTANT:
- Do NOT output anything other than the Write tool call
- Do NOT wrap the JSON in markdown code blocks inside the file
- The JSON must be valid and parseable
```

**Required placeholders (both MUST be present):**
- `{{TASK_INPUT}}` — runtime injection of task input
- `{{OUTPUT_FILE}}` — runtime injection of output file path

**OUTPUT CONTRACT JSON schemas per stage:**
- **SM**: `{ task_id, title, description, implementation_steps[], files_to_modify[], files_to_create[], acceptance_criteria[], edge_cases[], risks[] }`
- **Dev**: `{ task_id, status: "DONE|BLOCKED", files_changed[], implementation_summary, tests_written[], tests_passing, blockers[] }`
- **Review**: `{ task_id, verdict: "APPROVED|CHANGES_REQUESTED", issues[], acceptance_criteria_met[], review_summary }`
- **Tester**: `{ task_id, verdict: "PASSED|FAILED", test_results: {total,passed,failed,skipped}, acceptance_criteria_verified[], new_tests_written[], failures[], summary }`

### 2.4 — Update project config

Read `_agent_kit/agentkit.config.json` and add the new team to the `teams[]` array.

**Before modifying:** verify the file exists and is valid JSON. If the file is missing or malformed:
- Warn the user: "I found an issue with `_agent_kit/agentkit.config.json`: {file not found | invalid JSON}."
- If missing: "The config file does not exist. Please confirm you want me to create it from scratch, or provide the correct path."
- If malformed: "The config file contains invalid JSON. Please paste its correct contents so I can update it safely."
- Wait for user confirmation before proceeding.

```json
{
  "version": 2,
  "project": { "name": "...", "owner": "..." },
  "activeTeam": "{existing-active-team}",
  "activeTeams": ["{existing-teams}", "{newTeamName}"],
  "defaultTeam": "{existing-default-team}",
  "teams": ["{existing-teams}", "{newTeamName}"],
  "provider": "claude-cli",
  "models": { ... },
  "maxConcurrentSessions": 4
}
```

**Critical rules:**
- Do **NOT** change `activeTeam` or `defaultTeam` — the user must explicitly switch with `agentkit switch-team {teamName}`
- Only append to the `teams[]` array, do not remove or reorder existing entries
- If `activeTeams` exists, also append the new team to it (so it runs concurrently)
- If `activeTeams` does not exist (single-team mode), do NOT create it — only update `teams[]`
- Preserve all other fields exactly as they were (including `maxConcurrentSessions` if set)

---

## Phase 3: Validation & Confirmation

### 3.1 — Validate generated files

After writing all files, validate:

1. **Config file exists** at `_agent_kit/teams/{teamName}/config.json`
2. **Config is valid JSON** — parse it mentally or by reading it back
3. **All prompt files exist**: one per stage at `_agent_kit/teams/{teamName}/prompts/{stageName}.md`
4. **All prompt files contain** `{{TASK_INPUT}}` — runtime injection point for task input
5. **All prompt files contain** `{{OUTPUT_FILE}}` — runtime injection point for file-based output path (required by agentkit's Output Contract architecture)
6. **All prompt files contain** an OUTPUT CONTRACT section with a JSON schema definition
7. **agentkit.config.json** contains `{teamName}` in the `teams[]` array
8. **agentkit.config.json `activeTeam`** is unchanged

### 3.2 — Success message

If all validations pass:

```
✅ Team '{teamName}' đã được tạo thành công. Dùng `agentkit switch-team {teamName}` để chuyển sang team mới.

📁 Files created:
  _agent_kit/teams/{teamName}/config.json
  _agent_kit/teams/{teamName}/prompts/{stageName1}.md
  _agent_kit/teams/{teamName}/prompts/{stageName2}.md
  ... (one per stage)

📊 Team summary:
  Stages created: {N}
  Models: {stageName1}={model}, {stageName2}={model}, ...

🔁 Flow diagram:
  {icon1} {stageName1} → {icon2} {stageName2} → {icon3} {stageName3}
                                      ↓ reject
                               {icon2} {stageName2}

The active team remains '{currentActiveTeam}' until you switch.

✅ Team setup complete. Exit this session and run `agentkit start` to continue.
```

### 3.3 — Failure message

If any validation fails:

```
❌ Validation failed: {specific error}

To fix: {clear instruction on what to correct}
```

Offer to re-run the generation step after the user provides corrected input.

---

## Clone Flow (Optional Path)

> Entered when user answers "clone" in Step 1.1.

### C.1 — Select source team

Ask: "Which existing team do you want to clone from?"
- List available teams from `_agent_kit/teams/` directory
- Read the selected team's `config.json` and all its prompt files

### C.2 — Define new team identity

Ask for:
- New `teamName` (kebab-case, unique — same validation as Step 1.2)
- New `displayName`
- Purpose: "What is this team for? How is it different from the source team?"

### C.3 — Copy and adapt

1. Copy the source team's `config.json` structure
2. Replace `team` and `displayName` with the new values
3. Keep all stage names, timeouts, workers, retries, flow (`next`/`reject_to`/`reset_to`) the same unless user says otherwise
4. Ask: "Do you want to keep the same stages, or modify any of them?"
   - If yes to modifications: walk through only the changed stages
5. Re-apply project context to each prompt:
   - Read each source prompt file
   - If a source prompt file is a generic stub (contains only or mostly `{{TASK_INPUT}}` with no project-specific content, or contains `<!-- TODO: Customize ... -->`): **do NOT copy the stub as-is**. Instead, generate a fresh project-specific prompt using the context loaded in Phase 0, tailored to the new team's purpose.
   - Update the "Role" and "Project Context" sections to reflect the new team's purpose
   - Keep the `{{TASK_INPUT}}` placeholder in the Instructions section
   - Ensure the OUTPUT CONTRACT section exists with `{{OUTPUT_FILE}}` and a stage-appropriate JSON schema. If the source prompt lacks an OUTPUT CONTRACT (older prompts), **generate one** following the schema patterns in Phase 2.3 rules.
   - Ask the user if they want to review/modify each generated prompt before writing

### C.4 — Rejoin main flow

After C.1–C.3, return to **Phase 2.4** (update project config) and then **Phase 3** (validation).

---

## Edit Flow

> Entered when user answers "edit" in Step 1.1.

### E.1 — Select team to edit

List all teams found in `_agent_kit/teams/` and ask: "Which team do you want to edit?"
- Read the selected team's `config.json` and all its prompt files.
- Display a summary:
  ```
  Team: {teamName} ({displayName})
  Stages: {stageName1} → {stageName2} → ... (terminal: {lastStage})
  Models: {stageName}={model}, ...
  ```

### E.2 — What to change?

Ask: "What would you like to change?"

Present options (user can pick one or multiple):

1. **Team identity** — Rename `displayName` (cannot rename `team` identifier — it is the folder name)
2. **Stage config** — Modify timeout, workers, retries, next, reject_to, reset_to for existing stages
3. **Stage flow** — Add a new stage or remove an existing stage
4. **Model assignments** — Change the default model for one or more stages
5. **Edit a prompt** — Modify the prompt content for one or more stages
6. **All of the above** — Walk through everything

### E.3 — Collect changes

For each selected change type, collect the new values. Apply validation rules from Phase 1:
- [ ] Stage names still kebab-case
- [ ] `next`/`reject_to`/`reset_to` reference valid stage names within the team after the edit
- [ ] At least one terminal stage (no `next`) still exists after changes
- [ ] All model values are in `allowed` list

**Adding a new stage:**
- Collect: name, displayName, icon, timeout, workers, retries, next, reject_to, reset_to, model
- Ask where in the flow to insert it (after which stage?)
- Update the preceding stage's `next` field to point to the new stage
- Generate a new prompt file using Phase 2.3 guidelines (project-specific, with OUTPUT CONTRACT)

**Removing a stage:**
- Warn: "Removing stage '{stageName}' will also remove its prompt file and break any stage that points `next` or `reject_to` to it."
- Ask for confirmation
- Update the preceding stage's `next` to skip the removed stage (or ask what the new routing should be)
- Delete the prompt file

**Editing a prompt:**
- Read the current prompt and display it to the user
- Ask: "What do you want to change in this prompt? (describe the change or paste the new content)"
- Apply the change while preserving `{{TASK_INPUT}}`, `{{OUTPUT_FILE}}`, and OUTPUT CONTRACT block

### E.4 — Write changes

- Update `_agent_kit/teams/{teamName}/config.json` with all config changes
- Write/overwrite affected `prompts/{stageName}.md` files
- DO NOT touch prompt files for stages that were not changed
- DO NOT modify `agentkit.config.json` (no structural changes needed for edits)

### E.5 — Rejoin main flow

After E.1–E.4, run **Phase 3 validation** (adapted: check only the files that were changed).

Success message:
```
✅ Team '{teamName}' updated successfully.

Changed:
  {list of changed files}

No pipeline restart is needed if workers are not currently running.
If workers are running, stop and restart with: agentkit stop && agentkit start
```

---

## Reference: TeamConfig Interface

```typescript
interface TeamConfig {
  team: string;          // kebab-case, unique across _agent_kit/teams/
  displayName: string;   // Human-readable name
  version: number;       // Always 1 for new teams

  models: Record<string, ProviderModelsConfig>;
  // Keyed by provider name: { "claude-cli": { allowed: [...], defaults: {...} } }

  stages: StageConfig[];

  ownership?: FileOwnership;  // Optional: file ownership rules (multi-team only)
}

interface ProviderModelsConfig {
  allowed: string[];                // e.g. ["opus", "sonnet", "haiku"]
  defaults: Record<string, string>; // stageName → model
}

interface FileOwnership {
  include: string[];    // Glob patterns of files this team owns
  exclude?: string[];   // Glob patterns to exclude from ownership
}

interface StageConfig {
  name: string;          // kebab-case, unique within team
  displayName: string;   // Human-readable
  icon: string;          // Single emoji
  prompt: string;        // "./prompts/{name}.md" (always relative)
  timeout: number;       // Seconds, positive integer
  workers: number;       // Parallel workers, ≥ 1
  retries: number;       // Retry count, ≥ 0
  next?: string;         // Next stage name; omit for terminal stage
  reject_to?: string;    // Stage to send rejected work; omit if none
  reset_to?: string[];   // Stages user can manually reset to
}
```

---

## Quick Reference: Standard Document Paths

```
docs/prd.md
docs/architecture-rules.md
docs/project-context.md
CLAUDE.md
_agent_kit/agentkit.config.json
_agent_kit/teams/*/config.json
_agent_kit/teams/*/prompts/*.md
```

---

*End of team workflow. This file is instructions for the chatbot — not executable code.*
