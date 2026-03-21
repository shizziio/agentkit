import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_PATH = join(
  process.cwd(),
  'src/resources/workflows/create-team.md',
);

function loadWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf-8');
}

describe('create-team workflow document', () => {
  it('file exists at expected path', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  describe('top-of-file disclaimer', () => {
    it('contains AI/chatbot-only disclaimer', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/For AI\/Chatbot Use Only/i);
    });

    it('instructs not to execute as code', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/Do NOT execute this file as code/i);
    });
  });

  describe('Phase 0: document paths', () => {
    it('includes all required document scan paths', () => {
      const content = loadWorkflow();
      expect(content).toContain('_bmad-output/planning-artifacts/prd.md');
      expect(content).toContain('_bmad-output/planning-artifacts/architecture-rules.md');
      expect(content).toContain('docs/prd.md');
      expect(content).toContain('docs/project-context.md');
      expect(content).toContain('CLAUDE.md');
      expect(content).toContain('_agent_kit/agentkit.config.json');
    });

    it('includes fallback for missing documents (Phase 0.2)', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/Fallback if documents not found/i);
    });

    it('handles user skipping verbal context — proceed without blocking', () => {
      const content = loadWorkflow();
      // Must instruct to proceed without blocking when user skips
      expect(content).toMatch(/skip.*proceed anyway|proceed anyway.*skip/i);
      expect(content).toMatch(/do NOT (ask again|block)/i);
    });

    it('uses generic stubs with TODO comments when user skips context', () => {
      const content = loadWorkflow();
      expect(content).toContain('<!-- TODO: Customize');
    });

    it('includes context summary with confirmation gate (Phase 0.3)', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/Context Summary/i);
      expect(content).toMatch(/Does this look correct/i);
    });
  });

  describe('Phase 1: team name validation', () => {
    it('requires kebab-case team names', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/kebab-case/i);
      expect(content).toContain('/^[a-z][a-z0-9-]*$/');
    });

    it('rejects uppercase letters and spaces with kebab-case suggestion', () => {
      const content = loadWorkflow();
      // Must reject uppercase/spaces
      expect(content).toMatch(/uppercase|spaces/i);
      // Must suggest kebab-case equivalent
      expect(content).toMatch(/Did you mean/i);
    });

    it('contains exact error message format for invalid team name', () => {
      const content = loadWorkflow();
      expect(content).toContain("Invalid team name '");
      expect(content).toMatch(/Team names must be lowercase letters, digits, and hyphens only/i);
    });

    it('checks _agent_kit/teams/ directory first for uniqueness', () => {
      const content = loadWorkflow();
      expect(content).toContain('_agent_kit/teams/');
      expect(content).toMatch(/directory is checked first|directory.*checked first/i);
    });

    it('rejects team name in agentkit.config.json even if directory missing', () => {
      const content = loadWorkflow();
      // config is source of truth
      expect(content).toMatch(/source of truth/i);
      expect(content).toMatch(/reject even if directory doesn'?t exist/i);
    });
  });

  describe('Phase 1.4: stage validation', () => {
    it('requires at least one terminal stage (no next field)', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/terminal stage/i);
      expect(content).toMatch(/no `?next`? field|omit.*`?next`?/i);
    });

    it('flags error when all stages have next (no terminal)', () => {
      const content = loadWorkflow();
      expect(content).toContain('Your pipeline has no terminal stage');
      expect(content).toMatch(/At least one stage must omit the `next` field/i);
    });

    it('checks that next references existing stage names', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/`next`.*references an existing stage|references an existing stage name/i);
    });

    it('validates all 10 StageConfig fields', () => {
      const content = loadWorkflow();
      const fields = ['name', 'displayName', 'icon', 'timeout', 'workers', 'retries', 'next', 'reject_to', 'reset_to', 'prompt'];
      for (const field of fields) {
        expect(content).toContain(field);
      }
    });
  });

  describe('Phase 2: config generation', () => {
    it('includes JSON template with all required fields', () => {
      const content = loadWorkflow();
      expect(content).toContain('"team"');
      expect(content).toContain('"displayName"');
      expect(content).toContain('"version"');
      expect(content).toContain('"models"');
      expect(content).toContain('"stages"');
    });

    it('prompt field uses relative path format', () => {
      const content = loadWorkflow();
      expect(content).toContain('./prompts/{stageName}.md');
    });

    it('instructs to end each prompt with {{TASK_INPUT}}', () => {
      const content = loadWorkflow();
      expect(content).toContain('{{TASK_INPUT}}');
    });

    it('Phase 2.4 handles missing agentkit.config.json', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/file (is missing|does not exist)/i);
      expect(content).toMatch(/confirm you want me to create it from scratch/i);
    });

    it('Phase 2.4 handles malformed agentkit.config.json', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/invalid JSON/i);
      expect(content).toMatch(/paste its correct contents/i);
    });

    it('Phase 2.4 warns user and waits for confirmation before proceeding', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/Wait for user confirmation/i);
    });

    it('does NOT change activeTeam on config update', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/Do \*{0,2}NOT\*{0,2} change `activeTeam`/i);
      expect(content).toMatch(/agentkit switch-team/);
    });
  });

  describe('Phase 3: success message', () => {
    it('contains required Vietnamese success string', () => {
      const content = loadWorkflow();
      expect(content).toContain("đã được tạo thành công");
      expect(content).toContain("Dùng `agentkit switch-team");
      expect(content).toContain("để chuyển sang team mới");
    });

    it('success message template includes teamName placeholder', () => {
      const content = loadWorkflow();
      expect(content).toContain("Team '{teamName}'");
    });

    it('lists created files in success output', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/Files created/i);
      expect(content).toContain('_agent_kit/teams/{teamName}/config.json');
    });

    it('includes flow diagram in success output', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/Flow diagram/i);
    });
  });

  describe('Clone Flow', () => {
    it('includes all 4 clone flow steps (C.1–C.4)', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/C\.1/);
      expect(content).toMatch(/C\.2/);
      expect(content).toMatch(/C\.3/);
      expect(content).toMatch(/C\.4/);
    });

    it('does not copy generic stubs as-is in clone flow', () => {
      const content = loadWorkflow();
      // Must instruct to generate fresh content rather than copying stubs
      expect(content).toMatch(/do NOT copy the stub as-is/i);
      expect(content).toMatch(/generate a fresh project-specific prompt/i);
    });

    it('clone flow rejoins main flow at Phase 2.4 and Phase 3', () => {
      const content = loadWorkflow();
      expect(content).toMatch(/return to.*Phase 2\.4.*Phase 3|Phase 2\.4.*Phase 3/i);
    });
  });

  describe('TeamConfig / StageConfig interface reference', () => {
    it('documents TeamConfig TypeScript interface', () => {
      const content = loadWorkflow();
      expect(content).toContain('interface TeamConfig');
    });

    it('documents StageConfig TypeScript interface with reset_to', () => {
      const content = loadWorkflow();
      expect(content).toContain('interface StageConfig');
      expect(content).toContain('reset_to');
    });
  });
});
