import type { Command } from 'commander';
import { AGENTKIT_DIR } from '@config/defaults.js';

const getTopics = (): Record<'teams' | 'providers' | 'prompts' | 'pipeline' | 'docs', string> => ({
  teams: `
Teams — pipeline team templates
================================

agentkit uses team configs to define pipeline stages, models, and prompts.
Each team is a self-contained folder with config.json and prompt files.

Bundled teams:
  agent-kit    AgentKit Development (default)
  google-veo3  Google Veo3 Pipeline
  janitor      Cleanup/Maintenance
  ldj-cms      LDJ CMS Workflow

Team config location:
  Bundled:  src/resources/teams/<team>/config.json
  Project:  ${AGENTKIT_DIR}/teams/<team>/config.json

Team config defines:
  - stages:   Pipeline flow (name, next, reject_to, reset_to, workers, timeout)
  - models:   Allowed and default models per provider
  - prompts:  Markdown prompt files per stage

Override team at runtime:
  agentkit --team <team-name> <command>

Switch active team:
  agentkit switch-team <team-name>

Create a custom team:
  Use the chatbot workflow: src/resources/workflows/create-team.md
  Or copy an existing team folder and edit config.json + prompts.
`,

  providers: `
Providers — AI provider configuration
======================================

Supported providers:
  claude-cli   (default) Delegates to the local 'claude' CLI binary.
               Requires Claude CLI installed and authenticated.
               Models: opus, sonnet, haiku
               Session support: yes (-n/-r flags)

  gemini-cli   Delegates to the local 'gemini' CLI binary.
               Requires Gemini CLI installed and authenticated.
               Models: gemini-2.5-pro, gemini-3-flash, gemini-3.1-pro-preview
               Session support: yes (--list-sessions, -r UUID)

  codex-cli    Delegates to the OpenAI 'codex' CLI binary.
               Requires Codex CLI installed and authenticated.
               Models: o4-mini, o3, gpt-4.1
               Session support: no

Provider selection order:
  1. --provider flag passed on the CLI
  2. "provider" field in ${AGENTKIT_DIR}/agentkit.config.json
  3. Built-in default: claude-cli

Override at runtime:
  agentkit --provider <name> run

Switch provider in config:
  Use Config submenu in dashboard, or edit agentkit.config.json directly.

Per-provider environment variables:
  Set in agentkit.config.json under "env":
  {
    "env": {
      "claude-cli": { "ANTHROPIC_API_KEY": "..." },
      "gemini-cli": { "GEMINI_API_KEY": "..." }
    }
  }
`,

  prompts: `
Prompts — per-stage prompt files
==================================

Each stage in the pipeline is driven by a Markdown prompt file located under:
  ${AGENTKIT_DIR}/teams/<team>/prompts/<stage>.md

Prompt variables (injected at runtime):
  {{TASK_INPUT}}    Previous stage output (JSON)
  {{TASK_ID}}       Current task ID
  {{STORY_TITLE}}   Story title
  {{OUTPUT_FILE}}   Output file path (_agent_kit/.outputs/task-{id}.json)

Output contract:
  Every prompt MUST include an OUTPUT CONTRACT block instructing the AI
  to write structured JSON output to {{OUTPUT_FILE}} using the Write tool.
  stdout is for display only — not parsed for data.

How to customize:
  1. Open the relevant .md file in any editor
  2. Edit the instructions, context, or constraints
  3. Save — next pipeline run picks up changes immediately
  4. No rebuild or restart required

Session resume:
  When a task is retried, the prompt is modified to include feedback from
  the previous attempt. If the provider supports sessions, the existing
  session is resumed instead of starting fresh.
`,

  pipeline: `
Pipeline — execution flow
==========================

Typical workflow:
  1. agentkit init             Set up project
  2. agentkit load epics.md    Load epics/stories from markdown
  3. agentkit ship             Select stories to queue
  4. agentkit start            Open dashboard + start workers

Pipeline stages (configurable per team):
  SM -> Dev -> Review -> Tester (default agentkit team)

Task routing:
  - Stage has 'next': task routes forward automatically
  - Stage has 'reject_to': failed review routes back for rework
  - Stage has 'reset_to': user can manually reset to earlier stage
  - Loop detection: max 10 tasks in chain, max 3 repeats per stage

Queue priority:
  Stories further along in the pipeline are processed first.
  Priority auto-increments when tasks route to next stage.

Story dependencies:
  Stories can depend on other stories (depends_on field).
  Dependent stories wait in 'waiting' status until all deps complete.

Graceful drain:
  Running workers finish current task, queued tasks are cancelled,
  no new tasks are routed. Use 'D' key in dashboard.

Output contract (3-tier fallback):
  1. Read file at _agent_kit/.outputs/task-{id}.json
  2. Parse JSON from stdout (code block or balanced braces)
  3. Task failed: OUTPUT_MISSING
`,

  docs: `
Docs — project documentation
==============================

Documentation lives in ${AGENTKIT_DIR}/docs/ with this structure:

  ${AGENTKIT_DIR}/docs/
  ├── project/                    Project-specific documentation
  │   ├── project-context.md      Document index (read this first)
  │   ├── architecture.md         System design, DB schema, events, config
  │   ├── architecture-rules.md   Coding conventions and rules
  │   └── prd.md                  Product requirements document
  ├── agents/                     Agent definitions (generic, any project)
  │   ├── architect.md            System design, epic/story specs
  │   ├── analyst.md              Research, requirements, gap analysis
  │   └── project-manager.md      Planning, tracking, release management
  └── workflows/
      ├── planning/               Planning workflow + epic folders
      │   ├── README.md           Workflow guide & templates
      │   └── epic-{N}/           Epic specification folders
      └── team-setup.md           Team creation/edit/clone guide

Key commands:
  architect agent DP  Scan codebase and generate architecture docs
  planning workflow   Create new epic with stories and dependency graph
`,
});

const TOPICS = getTopics();

export function buildGeneralHelpText(program: Command): string {
  const lines: string[] = [];

  lines.push(`agentkit — AI Pipeline Orchestrator`);
  lines.push(``);
  lines.push(`USAGE`);
  lines.push(`  agentkit [global options] <command> [command options]`);
  lines.push(``);

  lines.push(`COMMANDS`);
  const cmdWidth = 14;
  for (const cmd of program.commands) {
    const name = cmd.name().padEnd(cmdWidth);
    lines.push(`  ${name}${cmd.description()}`);
  }
  lines.push(``);

  lines.push(`GLOBAL OPTIONS`);
  lines.push(`  --verbose             Enable verbose logging`);
  lines.push(`  --team <team>         Override the team template`);
  lines.push(`  --provider <provider> Override the AI provider`);
  lines.push(`  --model <model>       Override model for all stages`);
  lines.push(`  -V, --version         Print version and exit`);
  lines.push(`  -h, --help            Print this help and exit`);
  lines.push(``);

  lines.push(`HELP TOPICS`);
  lines.push(`  agentkit help teams      Team templates, stages, model configuration`);
  lines.push(`  agentkit help providers  Supported AI providers (claude, gemini, codex)`);
  lines.push(`  agentkit help prompts    Per-stage prompt files and customization`);
  lines.push(`  agentkit help pipeline   Pipeline execution flow, routing, priority`);
  lines.push(`  agentkit help docs       Project documentation structure`);
  lines.push(``);

  lines.push(`EXAMPLES`);
  lines.push(``);
  lines.push(`  First-time setup:`);
  lines.push(`    agentkit init`);
  lines.push(``);
  lines.push(`  Typical workflow:`);
  lines.push(`    agentkit load epics.md`);
  lines.push(`    agentkit ship --all`);
  lines.push(`    agentkit start`);
  lines.push(``);
  lines.push(`  Non-interactive (CI/CD):`);
  lines.push(`    agentkit load epics.md --simple && agentkit ship --all && agentkit run --simple`);
  lines.push(``);
  lines.push(`  Management:`);
  lines.push(`    agentkit status            Quick pipeline overview`);
  lines.push(`    agentkit diagnose          Check for issues`);
  lines.push(`    agentkit trace             Browse epic/story/task tree`);
  lines.push(`    agentkit inspect <task-id> View full task context`);
  lines.push(``);

  return lines.join('\n');
}

export function printGeneralHelp(program: Command): never {
  console.log(buildGeneralHelpText(program));
  process.exit(0);
}

function isHelpTopic(value: string): value is keyof typeof TOPICS {
  return value in TOPICS;
}

export function registerHelpCommand(program: Command): void {
  program
    .command('help')
    .description('Show help for agentkit or a specific topic (teams, providers, prompts, pipeline, docs)')
    .argument('[topic]', 'Topic or command name to show help for')
    .action((topic: string | undefined) => {
      if (!topic) {
        printGeneralHelp(program);
      } else if (isHelpTopic(topic)) {
        console.log(TOPICS[topic]);
        process.exit(0);
      } else {
        const cmd = program.commands.find((c) => c.name() === topic);
        if (cmd) {
          cmd.help();
        } else {
          process.stderr.write(`Unknown topic: '${topic}'. Showing general help.\n`);
          printGeneralHelp(program);
        }
      }
    });
}
