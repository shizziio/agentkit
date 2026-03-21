# Contributing to @shizziio/agent-kit

Thanks for your interest in contributing!

---

## Development Setup

```bash
git clone https://github.com/shizziio1999/agentkit.git
cd agentkit
npm install
npm run reinstall    # build + install globally as 'agentkit' command
```

### Prerequisites

- Node.js >= 18
- At least one AI CLI: `claude`, `gemini`, or `codex`

---

## Running Locally

```bash
npm run build        # Full build: tsc + tsc-alias + copy resources
npm run dev -- <cmd> # Dev mode with tsx (no build needed)
npm run reinstall    # Build + install globally
```

---

## Running Tests

```bash
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode
```

Tests use Vitest with in-memory SQLite (`:memory:`). No real AI calls — providers are mocked.

---

## Project Structure

```
src/
├── cli/            # CLI command handlers (Commander.js)
├── core/           # Business logic (no UI dependencies)
│   └── db/         # SQLite schema + migrations (Drizzle ORM)
├── workers/        # Pipeline workers, router, session management
├── providers/      # AI provider adapters (Claude, Gemini, Codex)
├── ui/             # Ink/React TUI components
│   └── dashboard/  # Main dashboard (4-panel grid + hooks)
├── shared/         # Neutral utilities (GlobalPath, ResourcePath, FormatTime)
├── config/         # Constants and defaults
└── resources/
    ├── teams/      # Bundled team (agentkit only)
    └── project-resources/  # Agents + workflows (copied to ~/.agentkit/)
```

### Layer Rules

| Layer | Can Import | Cannot Import |
|-------|-----------|---------------|
| cli/ | core/, ui/, providers/ | — |
| ui/ | core/ (via EventBus only) | providers/, cli/ |
| core/ | db/ | ui/, cli/, providers/ |
| providers/ | core/interfaces only | ui/, cli/, db/ |
| workers/ | core/, providers/ | ui/, cli/ |
| shared/ | nothing | any layer |

---

## Code Conventions

Read `docs/architecture-rules.md` for the full set. Key rules:

### Naming
- **Files:** PascalCase.ts (source), PascalCase.test.ts (tests)
- **Classes/Interfaces:** PascalCase (no `I` prefix)
- **Functions/Variables:** camelCase
- **Constants:** UPPER_SNAKE_CASE
- **DB columns:** snake_case
- **Events:** `domain:action` (e.g., `task:completed`)

### TypeScript
- `strict: true` — no `any`, no unguarded `as` assertions
- `async/await` — no `.then()/.catch()`
- Custom errors extend `AgentKitError`
- ESM: all relative imports use `.js` extension

### Database
- All writes in transactions (`db.transaction()`)
- Use Drizzle query builder (no raw SQL)
- Tests use in-memory SQLite

### Testing
- `describe('ClassName')` > `describe('methodName')` > `it('should ...')`
- Use `it()` inside `describe()` (not `test()`)
- Each test must be isolated — no shared state
- Provider tests use mocks, never real AI calls

---

## How to Contribute

### Adding a New Provider

1. Create `src/providers/agent/MyProvider.ts` implementing `BaseProvider`
2. Add to provider selection in `src/cli/Run.ts` and `src/ui/init/InitWizard.tsx`
3. Add CLI check in `InitWizard.tsx` `PROVIDER_CLI_MAP`
4. Add models to team configs

### Adding a New Team

Create in `~/.agentkit/teams/my-team/` (personal) or `src/resources/teams/` (bundled):
- `config.json` — stages, models, routing
- `prompts/*.md` — one per stage, must include `{{OUTPUT_FILE}}` contract

### Adding a CLI Command

1. Create `src/cli/MyCommand.ts` with `registerMyCommand(program)`
2. Register in `src/cli/index.ts`
3. Add help in `src/cli/Help.ts` if needed

---

## Pull Request Guidelines

1. Keep PRs focused — one feature or fix per PR
2. Write tests for new functionality
3. Run `npm test` before submitting
4. Follow existing code patterns (read neighboring files first)
5. Update docs if behavior changes

---

## Reporting Issues

Open an issue at [github.com/shizziio1999/agentkit/issues](https://github.com/shizziio1999/agentkit/issues) with:

1. What you expected
2. What actually happened
3. Steps to reproduce
4. Environment: Node.js version, OS, AI CLI tool + version
