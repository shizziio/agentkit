/**
 * Tests for the OUTPUT CONTRACT section added to bundled prompt templates.
 * Validates that each stage prompt (sm, dev, review, tester) has the correct
 * output contract structure, {{OUTPUT_FILE}} placeholder, BLOCKED fallback,
 * and stage-specific JSON schema fields.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectInput } from '@workers/PromptLoader';

const __dirname_current = dirname(fileURLToPath(import.meta.url));
// From tests/unit/workers/ → project root → src/resources/teams/
const teamsDir = resolve(__dirname_current, '..', '..', '..', 'src', 'resources', 'teams');

function readTemplate(stage: string): string {
  return readFileSync(join(teamsDir, 'agentkit', 'prompts', `${stage}.md`), 'utf-8');
}

// --- Common contract checks for all stages ---

describe('Bundled prompt templates — common OUTPUT CONTRACT requirements', () => {
  const stages = ['sm', 'dev', 'review', 'tester'];

  for (const stage of stages) {
    describe(`${stage}.md`, () => {
      it('contains ## OUTPUT CONTRACT heading', () => {
        expect(readTemplate(stage)).toContain('## OUTPUT CONTRACT');
      });

      it('contains {{OUTPUT_FILE}} placeholder', () => {
        expect(readTemplate(stage)).toContain('{{OUTPUT_FILE}}');
      });

      it('contains {{TASK_INPUT}} placeholder', () => {
        expect(readTemplate(stage)).toContain('{{TASK_INPUT}}');
      });

      it('instructs to use Write tool and not print to console', () => {
        const t = readTemplate(stage);
        expect(t).toMatch(/Write tool/i);
        expect(t).toMatch(/Do NOT print JSON to console/i);
      });

      it('instructs to write file BEFORE final response', () => {
        expect(readTemplate(stage)).toMatch(/Write the file BEFORE/i);
      });

      it('has a BLOCKED fallback instruction', () => {
        expect(readTemplate(stage)).toMatch(/BLOCKED/);
      });

      it('has a ```json schema block with task_id field', () => {
        const t = readTemplate(stage);
        expect(t).toContain('```json');
        expect(t).toContain('"task_id"');
      });

      it('notes that output file path is provided at runtime', () => {
        expect(readTemplate(stage)).toMatch(/provided by the pipeline at runtime/i);
      });
    });
  }
});

// --- Stage-specific schema field checks ---

describe('sm.md — stage-specific JSON schema', () => {
  it('has SM planning fields', () => {
    const t = readTemplate('sm');
    expect(t).toContain('"title"');
    expect(t).toContain('"description"');
    expect(t).toContain('"implementation_steps"');
    expect(t).toContain('"files_to_modify"');
    expect(t).toContain('"files_to_create"');
    expect(t).toContain('"acceptance_criteria"');
    expect(t).toContain('"edge_cases"');
  });

  it('BLOCKED fallback uses description field for error info', () => {
    const t = readTemplate('sm');
    expect(t).toMatch(/description.*field/i);
    expect(t).toMatch(/status.*BLOCKED|BLOCKED.*status/i);
  });
});

describe('dev.md — stage-specific JSON schema', () => {
  it('has dev implementation fields', () => {
    const t = readTemplate('dev');
    expect(t).toContain('"status"');
    expect(t).toContain('"DONE | BLOCKED"');
    expect(t).toContain('"files_changed"');
    expect(t).toContain('"implementation_summary"');
    expect(t).toContain('"tests_written"');
    expect(t).toContain('"blockers"');
  });

  it('BLOCKED fallback references blockers field', () => {
    expect(readTemplate('dev')).toMatch(/blockers/i);
  });
});

describe('review.md — stage-specific JSON schema', () => {
  it('has review verdict fields', () => {
    const t = readTemplate('review');
    expect(t).toContain('"verdict"');
    expect(t).toContain('"APPROVED | CHANGES_REQUESTED"');
    expect(t).toContain('"issues"');
    expect(t).toContain('"review_summary"');
  });

  it('CHANGES_REQUESTED verdict triggers reject_to routing', () => {
    expect(readTemplate('review')).toMatch(/CHANGES_REQUESTED/);
    expect(readTemplate('review')).toMatch(/reject_to/i);
  });

  it('APPROVED verdict progresses to next stage', () => {
    expect(readTemplate('review')).toMatch(/APPROVED/);
    expect(readTemplate('review')).toMatch(/next stage|progression/i);
  });

  it('BLOCKED fallback uses CHANGES_REQUESTED verdict', () => {
    const t = readTemplate('review');
    expect(t).toMatch(/CHANGES_REQUESTED.*blocked|BLOCKED.*CHANGES_REQUESTED/i);
  });
});

describe('tester.md — stage-specific JSON schema', () => {
  it('has tester verdict fields', () => {
    const t = readTemplate('tester');
    expect(t).toContain('"verdict"');
    expect(t).toContain('"PASSED | FAILED"');
    expect(t).toContain('"test_results"');
    expect(t).toContain('"issues"');
    expect(t).toContain('"test_summary"');
  });

  it('FAILED verdict triggers reject_to routing back to dev', () => {
    const t = readTemplate('tester');
    expect(t).toMatch(/FAILED.*reject_to|reject_to.*FAILED/i);
    expect(t).toMatch(/dev stage/i);
  });

  it('PASSED verdict means stage is complete', () => {
    expect(readTemplate('tester')).toMatch(/PASSED.*complete|stage is complete/i);
  });

  it('BLOCKED fallback uses FAILED verdict', () => {
    const t = readTemplate('tester');
    expect(t).toMatch(/FAILED.*blocked|BLOCKED.*FAILED/i);
  });
});

// --- Integration: injectInput with OUTPUT CONTRACT templates ---

describe('injectInput — integration with OUTPUT CONTRACT template format', () => {
  it('replaces {{TASK_INPUT}} and {{OUTPUT_FILE}} in SM template', () => {
    const template = readTemplate('sm');
    const result = injectInput(template, {
      input: 'Plan story 5.1',
      taskId: 42,
      outputFile: '/proj/_agent_kit/.outputs/task-42.json',
    });
    expect(result).toContain('Plan story 5.1');
    expect(result).toContain('/proj/_agent_kit/.outputs/task-42.json');
    expect(result).not.toContain('{{TASK_INPUT}}');
    expect(result).not.toContain('{{OUTPUT_FILE}}');
  });

  it('preserves OUTPUT CONTRACT text after substitution', () => {
    const template = readTemplate('dev');
    const result = injectInput(template, {
      input: 'implement feature',
      outputFile: '/out/result.json',
    });
    expect(result).toContain('## OUTPUT CONTRACT');
    expect(result).toContain('Do NOT print JSON to console');
    expect(result).toContain('/out/result.json');
  });

  it('leaves {{OUTPUT_FILE}} unreplaced when outputFile not provided', () => {
    const template = readTemplate('review');
    const result = injectInput(template, { input: 'review this code' });
    expect(result).toContain('{{OUTPUT_FILE}}');
    expect(result).not.toContain('{{TASK_INPUT}}');
  });

  it('replaces all {{OUTPUT_FILE}} occurrences (template may have multiple)', () => {
    // SM template has {{OUTPUT_FILE}} in both the path line and the NOTE line
    const template = readTemplate('sm');
    const outputPath = '/test/output-99.json';
    const result = injectInput(template, { input: 'test', outputFile: outputPath });
    expect(result).not.toContain('{{OUTPUT_FILE}}');
    expect(result).toContain(outputPath);
  });

  it('handles all 4 stage templates end-to-end with taskId injection', () => {
    const stages = ['sm', 'dev', 'review', 'tester'];
    const outputPath = '/pipeline/.outputs/task-99.json';

    for (const stage of stages) {
      const template = readTemplate(stage);
      const result = injectInput(template, {
        input: `Do ${stage} work`,
        taskId: 99,
        outputFile: outputPath,
      });
      expect(result, `${stage}: no {{TASK_INPUT}} remaining`).not.toContain('{{TASK_INPUT}}');
      expect(result, `${stage}: no {{OUTPUT_FILE}} remaining`).not.toContain('{{OUTPUT_FILE}}');
      expect(result, `${stage}: input injected`).toContain(`Do ${stage} work`);
      expect(result, `${stage}: outputFile injected`).toContain(outputPath);
      expect(result, `${stage}: OUTPUT CONTRACT preserved`).toContain('## OUTPUT CONTRACT');
    }
  });

  it('tester template: injected output file path appears in RULES section', () => {
    const template = readTemplate('tester');
    const outputPath = '/pipeline/.outputs/tester-task-7.json';
    const result = injectInput(template, { input: 'run tests', outputFile: outputPath });
    // Output path should replace the {{OUTPUT_FILE}} that was right after "this exact path:"
    expect(result).toContain(`this exact path:\n${outputPath}`);
  });
});
