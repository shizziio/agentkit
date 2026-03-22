/**
 * Story 25.1: Reorganize dashboard/ into feature-based modules
 *
 * These tests verify the structural outcome of the file-move refactor.
 * They FAIL before implementation (files still in flat root) and PASS after.
 *
 * Test categories:
 *   1.  Files exist in new subdirectory locations
 *   2.  Moved files no longer exist in dashboard/ root
 *   3.  Files that STAY in root are still there
 *   4.  dashboard/index.ts re-export paths use new subdirectory locations
 *   5.  External source files (UnifiedApp.tsx, DiagnoseWizard.tsx) use updated paths
 *   6.  Test files in tests/unit/ui/dashboard/ use updated subdirectory import paths
 *   7.  DashboardApp.tsx (root) uses new subdirectory import paths (SM Step 24)
 *   8.  ESM .js extension preserved in dashboard/index.ts
 *   9.  AC2: Moved source files use correct cross-subdirectory relative imports
 *   10. Kebab-case subdirectory names are valid filesystem paths
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const DASHBOARD_SRC = `${ROOT}/src/ui/dashboard`;
const TESTS_DIR = `${ROOT}/tests/unit/ui/dashboard`;

function src(relPath: string): string {
  return resolve(ROOT, 'src', relPath);
}

function dashSrc(relPath: string): string {
  return resolve(DASHBOARD_SRC, relPath);
}

function testFile(name: string): string {
  return resolve(TESTS_DIR, name);
}

function readTestFile(name: string): string {
  return readFileSync(testFile(name), 'utf-8');
}

function readSrcFile(relPath: string): string {
  return readFileSync(src(relPath), 'utf-8');
}

// ---------------------------------------------------------------------------
// 1. Files exist in new subdirectory locations
// ---------------------------------------------------------------------------
describe('Story 25.1: Dashboard Reorganization', () => {
  describe('1. Files exist in new subdirectory locations', () => {
    describe('layouts/', () => {
      it('GridLayout.tsx is in layouts/', () => {
        expect(existsSync(dashSrc('layouts/GridLayout.tsx'))).toBe(true);
      });
      it('CompactLayout.tsx is in layouts/', () => {
        expect(existsSync(dashSrc('layouts/CompactLayout.tsx'))).toBe(true);
      });
      it('TraceModeLayout.tsx is in layouts/', () => {
        expect(existsSync(dashSrc('layouts/TraceModeLayout.tsx'))).toBe(true);
      });
      it('TraceRightPanel.tsx is in layouts/', () => {
        expect(existsSync(dashSrc('layouts/TraceRightPanel.tsx'))).toBe(true);
      });
    });

    describe('active-stories/', () => {
      it('ActiveStoriesPanel.tsx is in active-stories/', () => {
        expect(existsSync(dashSrc('active-stories/ActiveStoriesPanel.tsx'))).toBe(true);
      });
      it('ActiveStoriesTypes.ts is in active-stories/', () => {
        expect(existsSync(dashSrc('active-stories/ActiveStoriesTypes.ts'))).toBe(true);
      });
    });

    describe('live-activity/', () => {
      it('LiveActivityPanel.tsx is in live-activity/', () => {
        expect(existsSync(dashSrc('live-activity/LiveActivityPanel.tsx'))).toBe(true);
      });
      it('LiveActivityFullscreen.tsx is in live-activity/', () => {
        expect(existsSync(dashSrc('live-activity/LiveActivityFullscreen.tsx'))).toBe(true);
      });
      it('LiveActivityTypes.ts is in live-activity/', () => {
        expect(existsSync(dashSrc('live-activity/LiveActivityTypes.ts'))).toBe(true);
      });
      it('CompletionCard.tsx is in live-activity/', () => {
        expect(existsSync(dashSrc('live-activity/CompletionCard.tsx'))).toBe(true);
      });
    });

    describe('pipeline-flow/', () => {
      it('PipelineFlowPanel.tsx is in pipeline-flow/', () => {
        expect(existsSync(dashSrc('pipeline-flow/PipelineFlowPanel.tsx'))).toBe(true);
      });
      it('PipelineFlowTypes.ts is in pipeline-flow/', () => {
        expect(existsSync(dashSrc('pipeline-flow/PipelineFlowTypes.ts'))).toBe(true);
      });
    });

    describe('command-menu/', () => {
      it('CommandMenuPanel.tsx is in command-menu/', () => {
        expect(existsSync(dashSrc('command-menu/CommandMenuPanel.tsx'))).toBe(true);
      });
      it('ActionPanel.tsx is in command-menu/', () => {
        expect(existsSync(dashSrc('command-menu/ActionPanel.tsx'))).toBe(true);
      });
      it('MenuTypes.ts is in command-menu/', () => {
        expect(existsSync(dashSrc('command-menu/MenuTypes.ts'))).toBe(true);
      });
      it('KeyBindings.tsx is in command-menu/', () => {
        expect(existsSync(dashSrc('command-menu/KeyBindings.tsx'))).toBe(true);
      });
    });

    describe('diagnose/', () => {
      it('DiagnosePanel.tsx is in diagnose/', () => {
        expect(existsSync(dashSrc('diagnose/DiagnosePanel.tsx'))).toBe(true);
      });
    });

    describe('crew/', () => {
      it('PipelineCrew.tsx is in crew/', () => {
        expect(existsSync(dashSrc('crew/PipelineCrew.tsx'))).toBe(true);
      });
      it('RobotChar.tsx is in crew/', () => {
        expect(existsSync(dashSrc('crew/RobotChar.tsx'))).toBe(true);
      });
      it('CrewTypes.ts is in crew/', () => {
        expect(existsSync(dashSrc('crew/CrewTypes.ts'))).toBe(true);
      });
    });

    describe('brand/', () => {
      it('BrandHeader.tsx is in brand/', () => {
        expect(existsSync(dashSrc('brand/BrandHeader.tsx'))).toBe(true);
      });
    });

    describe('modals/', () => {
      it('CancelStoryWizard.tsx is in modals/', () => {
        expect(existsSync(dashSrc('modals/CancelStoryWizard.tsx'))).toBe(true);
      });
      it('ResetStoryWizard.tsx is in modals/', () => {
        expect(existsSync(dashSrc('modals/ResetStoryWizard.tsx'))).toBe(true);
      });
      it('DrainConfirmPanel.tsx is in modals/', () => {
        expect(existsSync(dashSrc('modals/DrainConfirmPanel.tsx'))).toBe(true);
      });
      it('QuitConfirmPanel.tsx is in modals/', () => {
        expect(existsSync(dashSrc('modals/QuitConfirmPanel.tsx'))).toBe(true);
      });
      it('TerminateConfirmPanel.tsx is in modals/', () => {
        expect(existsSync(dashSrc('modals/TerminateConfirmPanel.tsx'))).toBe(true);
      });
      it('HelpModal.tsx is in modals/', () => {
        expect(existsSync(dashSrc('modals/HelpModal.tsx'))).toBe(true);
      });
      it('AlertOverlay.tsx is in modals/', () => {
        expect(existsSync(dashSrc('modals/AlertOverlay.tsx'))).toBe(true);
      });
      it('AlertOverlayTypes.ts is in modals/', () => {
        expect(existsSync(dashSrc('modals/AlertOverlayTypes.ts'))).toBe(true);
      });
      it('StoryActionPicker.tsx is in modals/', () => {
        expect(existsSync(dashSrc('modals/StoryActionPicker.tsx'))).toBe(true);
      });
    });

    describe('hooks/', () => {
      it('useActiveStories.ts is in hooks/', () => {
        expect(existsSync(dashSrc('hooks/useActiveStories.ts'))).toBe(true);
      });
      it('useCrewState.ts is in hooks/', () => {
        expect(existsSync(dashSrc('hooks/useCrewState.ts'))).toBe(true);
      });
      it('useDashboardContent.tsx is in hooks/', () => {
        expect(existsSync(dashSrc('hooks/useDashboardContent.tsx'))).toBe(true);
      });
      it('useDiagnosePolling.ts is in hooks/', () => {
        expect(existsSync(dashSrc('hooks/useDiagnosePolling.ts'))).toBe(true);
      });
      it('useFullscreenLiveActivity.ts is in hooks/', () => {
        expect(existsSync(dashSrc('hooks/useFullscreenLiveActivity.ts'))).toBe(true);
      });
      it('useLayout.ts is in hooks/', () => {
        expect(existsSync(dashSrc('hooks/useLayout.ts'))).toBe(true);
      });
      it('useLiveActivity.ts is in hooks/', () => {
        expect(existsSync(dashSrc('hooks/useLiveActivity.ts'))).toBe(true);
      });
      it('useMenuStack.ts is in hooks/', () => {
        expect(existsSync(dashSrc('hooks/useMenuStack.ts'))).toBe(true);
      });
      it('usePipelineFlow.ts is in hooks/', () => {
        expect(existsSync(dashSrc('hooks/usePipelineFlow.ts'))).toBe(true);
      });
    });

    describe('src/ui/stores/ (Epic 26 stores)', () => {
      it('workerStore.ts exists in src/ui/stores/', () => {
        expect(existsSync(src('ui/stores/workerStore.ts'))).toBe(true);
      });
    });

    describe('shared/', () => {
      it('DashboardTypes.ts is in shared/', () => {
        expect(existsSync(dashSrc('shared/DashboardTypes.ts'))).toBe(true);
      });
      it('utils.ts is in shared/', () => {
        expect(existsSync(dashSrc('shared/utils.ts'))).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Moved files no longer exist in dashboard/ root
  // ---------------------------------------------------------------------------
  describe('2. Moved files are gone from dashboard/ root', () => {
    const movedFiles = [
      'ActionPanel.tsx',
      'ActiveStoriesPanel.tsx',
      'ActiveStoriesTypes.ts',
      'AlertOverlay.tsx',
      'AlertOverlayTypes.ts',
      'BrandHeader.tsx',
      'CancelStoryWizard.tsx',
      'CommandMenuPanel.tsx',
      'CompactLayout.tsx',
      'CompletionCard.tsx',
      'CrewTypes.ts',
      'DashboardTypes.ts',
      'DiagnosePanel.tsx',
      'DrainConfirmPanel.tsx',
      'GridLayout.tsx',
      'HelpModal.tsx',
      'KeyBindings.tsx',
      'LiveActivityFullscreen.tsx',
      'LiveActivityPanel.tsx',
      'LiveActivityTypes.ts',
      'MenuTypes.ts',
      'PipelineCrew.tsx',
      'PipelineFlowPanel.tsx',
      'PipelineFlowTypes.ts',
      'QuitConfirmPanel.tsx',
      'ResetStoryWizard.tsx',
      'RobotChar.tsx',
      'StoryActionPicker.tsx',
      'TerminateConfirmPanel.tsx',
      'TraceModeLayout.tsx',
      'TraceRightPanel.tsx',
      'useActiveStories.ts',
      'useCrewState.ts',
      'useDashboardContent.tsx',
      'useDiagnosePolling.ts',
      'useFullscreenLiveActivity.ts',
      'useLayout.ts',
      'useLiveActivity.ts',
      'useMenuStack.ts',
      'usePipelineFlow.ts',
      'utils.ts',
    ];

    for (const filename of movedFiles) {
      it(`${filename} is NOT in dashboard/ root`, () => {
        expect(existsSync(dashSrc(filename))).toBe(false);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Files that STAY in root are still there
  // ---------------------------------------------------------------------------
  describe('3. Files that remain in dashboard/ root are still present', () => {
    it('DashboardApp.tsx stays in root', () => {
      expect(existsSync(dashSrc('DashboardApp.tsx'))).toBe(true);
    });
    it('index.ts stays in root', () => {
      expect(existsSync(dashSrc('index.ts'))).toBe(true);
    });
    it('useDashboardMode.ts deleted in 25.4', () => {
      expect(existsSync(dashSrc('useDashboardMode.ts'))).toBe(false);
    });
    it('usePanelFocus.ts deleted in 25.4', () => {
      expect(existsSync(dashSrc('usePanelFocus.ts'))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. dashboard/index.ts barrel re-export paths use new subdirectory locations
  // ---------------------------------------------------------------------------
  describe('4. dashboard/index.ts barrel re-export paths', () => {
    it('re-exports PipelineFlowPanel from pipeline-flow/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/pipeline-flow\/PipelineFlowPanel\.js['"]/);
    });

    it('re-exports PipelineFlowTypes from pipeline-flow/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/pipeline-flow\/PipelineFlowTypes\.js['"]/);
    });

    it('re-exports usePipelineFlow from hooks/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/hooks\/usePipelineFlow\.js['"]/);
    });

    it('re-exports ActiveStoriesPanel from active-stories/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/active-stories\/ActiveStoriesPanel\.js['"]/);
    });

    it('re-exports useActiveStories from hooks/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/hooks\/useActiveStories\.js['"]/);
    });

    it('re-exports ActiveStoriesTypes from active-stories/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/active-stories\/ActiveStoriesTypes\.js['"]/);
    });

    it('re-exports LiveActivityPanel from live-activity/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/live-activity\/LiveActivityPanel\.js['"]/);
    });

    it('re-exports useLiveActivity from hooks/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/hooks\/useLiveActivity\.js['"]/);
    });

    it('re-exports LiveActivityFullscreen from live-activity/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/live-activity\/LiveActivityFullscreen\.js['"]/);
    });

    it('re-exports useFullscreenLiveActivity from hooks/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/hooks\/useFullscreenLiveActivity\.js['"]/);
    });

    it('re-exports LiveActivityTypes from live-activity/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/live-activity\/LiveActivityTypes\.js['"]/);
    });

    it('re-exports AlertOverlay from modals/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/modals\/AlertOverlay\.js['"]/);
    });

    it('re-exports AlertOverlayTypes from modals/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/modals\/AlertOverlayTypes\.js['"]/);
    });

    it('re-exports CompletionCard from live-activity/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/live-activity\/CompletionCard\.js['"]/);
    });

    it('re-exports RobotChar from crew/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/crew\/RobotChar\.js['"]/);
    });

    it('re-exports CrewTypes from crew/ subdirectory', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      expect(content).toMatch(/from ['"]\.\/crew\/CrewTypes\.js['"]/);
    });

    it('does NOT have any flat-root re-export paths for moved files', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      // None of these should appear as direct flat root exports anymore
      const movedFlatExports = [
        /from ['"]\.\/PipelineFlowPanel\.js['"]/,
        /from ['"]\.\/PipelineFlowTypes\.js['"]/,
        /from ['"]\.\/ActiveStoriesPanel\.js['"]/,
        /from ['"]\.\/ActiveStoriesTypes\.js['"]/,
        /from ['"]\.\/useActiveStories\.js['"]/,
        /from ['"]\.\/LiveActivityPanel\.js['"]/,
        /from ['"]\.\/LiveActivityTypes\.js['"]/,
        /from ['"]\.\/useLiveActivity\.js['"]/,
        /from ['"]\.\/LiveActivityFullscreen\.js['"]/,
        /from ['"]\.\/useFullscreenLiveActivity\.js['"]/,
        /from ['"]\.\/AlertOverlay\.js['"]/,
        /from ['"]\.\/AlertOverlayTypes\.js['"]/,
        /from ['"]\.\/useAlertOverlay\.js['"]/,
        /from ['"]\.\/CompletionCard\.js['"]/,
        /from ['"]\.\/RobotChar\.js['"]/,
        /from ['"]\.\/CrewTypes\.js['"]/,
      ];
      for (const pattern of movedFlatExports) {
        expect(content).not.toMatch(pattern);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. External source files use updated import paths
  // ---------------------------------------------------------------------------
  describe('5. External source files use updated import paths', () => {
    describe('src/ui/UnifiedApp.tsx', () => {
      it('imports DashboardTypes from @ui/dashboard/shared/DashboardTypes.js', () => {
        const content = readSrcFile('ui/UnifiedApp.tsx');
        expect(content).toMatch(
          /from ['"]@ui\/dashboard\/shared\/DashboardTypes\.js['"]/
        );
      });

      it('does NOT import DashboardTypes from old flat path @ui/dashboard/DashboardTypes.js', () => {
        const content = readSrcFile('ui/UnifiedApp.tsx');
        expect(content).not.toMatch(
          /from ['"]@ui\/dashboard\/DashboardTypes\.js['"]/
        );
      });

      it('imports TraceModeLayout from dashboard/layouts/TraceModeLayout.js', () => {
        const content = readSrcFile('ui/UnifiedApp.tsx');
        expect(content).toMatch(
          /from ['"]\.\/dashboard\/layouts\/TraceModeLayout\.js['"]/
        );
      });

      it('does NOT import TraceModeLayout from old flat path ./dashboard/TraceModeLayout.js', () => {
        const content = readSrcFile('ui/UnifiedApp.tsx');
        expect(content).not.toMatch(
          /from ['"]\.\/dashboard\/TraceModeLayout\.js['"]/
        );
      });
    });

    describe('src/ui/diagnose/DiagnoseWizard.tsx', () => {
      it('imports utils from @ui/dashboard/shared/utils.js', () => {
        const content = readSrcFile('ui/diagnose/DiagnoseWizard.tsx');
        expect(content).toMatch(
          /from ['"]@ui\/dashboard\/shared\/utils\.js['"]/
        );
      });

      it('does NOT import utils from old path @ui/dashboard/utils.js', () => {
        const content = readSrcFile('ui/diagnose/DiagnoseWizard.tsx');
        expect(content).not.toMatch(
          /from ['"]@ui\/dashboard\/utils\.js['"]/
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Test files use updated subdirectory import paths
  // ---------------------------------------------------------------------------
  describe('6. Test file import paths use new subdirectory paths', () => {
    describe('command-menu/ test files', () => {
      it('ActionPanel.test.tsx imports from @ui/dashboard/command-menu/ActionPanel', () => {
        const content = readTestFile('ActionPanel.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/command-menu\/ActionPanel/);
      });
      it('ActionPanel.test.tsx does NOT import from flat @ui/dashboard/ActionPanel', () => {
        const content = readTestFile('ActionPanel.test.tsx');
        expect(content).not.toMatch(/@ui\/dashboard\/ActionPanel(?!.*\/)/);
      });

      it('CommandMenuPanel.test.tsx imports from @ui/dashboard/command-menu/', () => {
        const content = readTestFile('CommandMenuPanel.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/command-menu\//);
      });

      it('KeyBindings.drain.test.tsx imports from @ui/dashboard/command-menu/', () => {
        const content = readTestFile('KeyBindings.drain.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/command-menu\//);
      });

      it('KeyBindings.hotkeys.test.ts imports from @ui/dashboard/command-menu/', () => {
        const content = readTestFile('KeyBindings.hotkeys.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/command-menu\//);
      });

      it('KeyBindingsModal.test.ts imports from @ui/dashboard/command-menu/', () => {
        const content = readTestFile('KeyBindingsModal.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/command-menu\//);
      });
    });

    describe('active-stories/ test files', () => {
      it('ActiveStoriesPanel.test.ts imports from @ui/dashboard/active-stories/', () => {
        const content = readTestFile('ActiveStoriesPanel.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/active-stories\//);
      });
      it('ActiveStoriesPanel.test.ts does NOT use flat @ui/dashboard/ActiveStoriesPanel', () => {
        const content = readTestFile('ActiveStoriesPanel.test.ts');
        expect(content).not.toMatch(/@ui\/dashboard\/ActiveStoriesPanel(?![/])/);
      });

      it('ActiveStoriesPanel.deps.test.ts imports from @ui/dashboard/active-stories/', () => {
        const content = readTestFile('ActiveStoriesPanel.deps.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/active-stories\//);
      });

      it('ActiveStoriesPanel.memo.test.tsx imports from @ui/dashboard/active-stories/', () => {
        const content = readTestFile('ActiveStoriesPanel.memo.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/active-stories\//);
      });

      it('ActiveStoriesPanel.priority.test.ts imports from @ui/dashboard/active-stories/', () => {
        const content = readTestFile('ActiveStoriesPanel.priority.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/active-stories\//);
      });

      it('ActiveStoriesPanel.waiting.test.ts imports from @ui/dashboard/active-stories/', () => {
        const content = readTestFile('ActiveStoriesPanel.waiting.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/active-stories\//);
      });
    });

    describe('live-activity/ test files', () => {
      it('LiveActivityPanel.test.ts imports from @ui/dashboard/live-activity/', () => {
        const content = readTestFile('LiveActivityPanel.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/live-activity\//);
      });

      it('LiveActivityPanel.memo.test.tsx imports from @ui/dashboard/live-activity/', () => {
        const content = readTestFile('LiveActivityPanel.memo.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/live-activity\//);
      });

      it('LiveActivityFullscreen.test.tsx imports from @ui/dashboard/live-activity/', () => {
        const content = readTestFile('LiveActivityFullscreen.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/live-activity\//);
      });

      it('CompletionCard.test.ts imports from @ui/dashboard/live-activity/', () => {
        const content = readTestFile('CompletionCard.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/live-activity\//);
      });
    });

    describe('pipeline-flow/ test files', () => {
      it('PipelineFlowPanel.test.ts imports from @ui/dashboard/pipeline-flow/', () => {
        const content = readTestFile('PipelineFlowPanel.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/pipeline-flow\//);
      });
    });

    describe('diagnose/ test files', () => {
      it('DiagnosePanel.test.tsx imports from @ui/dashboard/diagnose/', () => {
        const content = readTestFile('DiagnosePanel.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/diagnose\//);
      });

      it('DiagnosePanel.memo.test.tsx imports from @ui/dashboard/diagnose/', () => {
        const content = readTestFile('DiagnosePanel.memo.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/diagnose\//);
      });
    });

    describe('crew/ test files', () => {
      it('PipelineCrew.test.tsx imports from @ui/dashboard/crew/', () => {
        const content = readTestFile('PipelineCrew.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/crew\//);
      });

      it('RobotChar.test.tsx imports from @ui/dashboard/crew/', () => {
        const content = readTestFile('RobotChar.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/crew\//);
      });
    });

    describe('brand/ test files', () => {
      it('BrandHeader.test.tsx imports from @ui/dashboard/brand/', () => {
        const content = readTestFile('BrandHeader.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/brand\//);
      });

      it('BrandHeader.drain.test.tsx imports from @ui/dashboard/brand/', () => {
        const content = readTestFile('BrandHeader.drain.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/brand\//);
      });
    });

    describe('modals/ test files', () => {
      it('AlertOverlay.test.ts imports from @ui/dashboard/modals/', () => {
        const content = readTestFile('AlertOverlay.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/modals\//);
      });

      it('DrainConfirmPanel.test.tsx imports from @ui/dashboard/modals/', () => {
        const content = readTestFile('DrainConfirmPanel.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/modals\//);
      });

      it('HelpModal.test.tsx imports from @ui/dashboard/modals/', () => {
        const content = readTestFile('HelpModal.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/modals\//);
      });

      it('QuitConfirmPanel.test.tsx imports from @ui/dashboard/modals/', () => {
        const content = readTestFile('QuitConfirmPanel.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/modals\//);
      });

      it('ResetStoryWizard.test.tsx imports from @ui/dashboard/modals/', () => {
        const content = readTestFile('ResetStoryWizard.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/modals\//);
      });

      it('StoryActionPicker.test.tsx imports from @ui/dashboard/modals/', () => {
        const content = readTestFile('StoryActionPicker.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/modals\//);
      });

      it('TerminateConfirmPanel.test.tsx imports from @ui/dashboard/modals/', () => {
        const content = readTestFile('TerminateConfirmPanel.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/modals\//);
      });
    });

    describe('hooks/ test files', () => {
      it('useActiveStories.test.ts imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('useActiveStories.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/hooks\/useActiveStories/);
      });

      it('useActiveStories.priority.test.ts imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('useActiveStories.priority.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/hooks\//);
      });

      it('useCrewState.test.ts imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('useCrewState.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/hooks\//);
      });

      it('useDashboardContent.test.tsx imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('useDashboardContent.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/hooks\//);
      });

      it('useDiagnosePolling.test.ts imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('useDiagnosePolling.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/hooks\//);
      });

      it('useFullscreenLiveActivity.test.ts imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('useFullscreenLiveActivity.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/hooks\//);
      });

      it('useLayout.test.ts imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('useLayout.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/hooks\//);
      });

      it('useLiveActivity.test.ts imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('useLiveActivity.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/hooks\//);
      });

      it('useMenuStack.test.tsx imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('useMenuStack.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/hooks\//);
      });

      it('usePipelineFlow.test.ts imports from @ui/dashboard/hooks/', () => {
        const content = readTestFile('usePipelineFlow.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/hooks\//);
      });
    });

    describe('layouts/ test files', () => {
      it('GridLayout.test.tsx imports from @ui/dashboard/layouts/', () => {
        const content = readTestFile('GridLayout.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/layouts\//);
      });
      it('GridLayout.test.tsx does NOT import from flat @ui/dashboard/GridLayout', () => {
        const content = readTestFile('GridLayout.test.tsx');
        expect(content).not.toMatch(/@ui\/dashboard\/GridLayout(?![/])/);
      });

      it('TraceModeLayout.test.tsx imports from @ui/dashboard/layouts/', () => {
        const content = readTestFile('TraceModeLayout.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/layouts\//);
      });

      it('TraceRightPanel.test.tsx imports from @ui/dashboard/layouts/', () => {
        const content = readTestFile('TraceRightPanel.test.tsx');
        expect(content).toMatch(/@ui\/dashboard\/layouts\//);
      });
    });

    describe('shared/ test files', () => {
      it('utils.test.ts imports from @ui/dashboard/shared/utils', () => {
        const content = readTestFile('utils.test.ts');
        expect(content).toMatch(/@ui\/dashboard\/shared\/utils/);
      });
      it('utils.test.ts does NOT import from flat @ui/dashboard/utils', () => {
        const content = readTestFile('utils.test.ts');
        expect(content).not.toMatch(/@ui\/dashboard\/utils(?![/])/);
      });
    });

    describe('root-level hook test files (deleted in 25.4)', () => {
      it('useDashboardMode.test.ts deleted in 25.4 (hook was removed)', () => {
        expect(existsSync(testFile('useDashboardMode.test.ts'))).toBe(false);
      });

      it('usePanelFocus.test.ts deleted in 25.4 (hook was removed)', () => {
        expect(existsSync(testFile('usePanelFocus.test.ts'))).toBe(false);
      });
    });

    describe('vi.mock paths in test files also use new subdirectory paths', () => {
      it('ActiveStoriesPanel.test.ts vi.mock for useActiveStories uses hooks/ path', () => {
        const content = readTestFile('ActiveStoriesPanel.test.ts');
        // Any vi.mock targeting useActiveStories must use hooks/ path
        const mockPattern = /vi\.mock\(['"]@ui\/dashboard\/hooks\/useActiveStories/;
        // If the file mocks useActiveStories at all, it must use the hooks/ path
        if (content.includes("vi.mock") && content.includes("useActiveStories")) {
          expect(content).toMatch(mockPattern);
        }
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 7. DashboardApp.tsx (root) uses new subdirectory import paths (SM Step 24)
  // ---------------------------------------------------------------------------
  describe('7. DashboardApp.tsx uses new subdirectory import paths', () => {
    it('imports DashboardTypes from ./shared/DashboardTypes.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).toMatch(/from ['"]\.\/shared\/DashboardTypes\.js['"]/);
    });
    it('does NOT import DashboardTypes from flat ./DashboardTypes.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/DashboardTypes\.js['"]/);
    });

    it('imports useMenuStack from ./hooks/useMenuStack.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).toMatch(/from ['"]\.\/hooks\/useMenuStack\.js['"]/);
    });
    it('does NOT import useMenuStack from flat ./useMenuStack.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/useMenuStack\.js['"]/);
    });

    it('imports useDashboardContent from ./hooks/useDashboardContent.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).toMatch(/from ['"]\.\/hooks\/useDashboardContent\.js['"]/);
    });
    it('does NOT import useDashboardContent from flat ./useDashboardContent.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/useDashboardContent\.js['"]/);
    });

    it('imports useLayout from ./hooks/useLayout.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).toMatch(/from ['"]\.\/hooks\/useLayout\.js['"]/);
    });
    it('does NOT import useLayout from flat ./useLayout.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/useLayout\.js['"]/);
    });

    it('does NOT import useWorkerStatus (migrated to workerStore in 26.2)', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/useWorkerStatus/);
    });
    it('imports useWorkerStore from @ui/stores/index.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).toMatch(/useWorkerStore/);
    });

    it('imports KeyBindings from ./command-menu/KeyBindings.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).toMatch(/from ['"]\.\/command-menu\/KeyBindings\.js['"]/);
    });
    it('does NOT import KeyBindings from flat ./KeyBindings.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/KeyBindings\.js['"]/);
    });

    it('imports CompactLayout from ./layouts/CompactLayout.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).toMatch(/from ['"]\.\/layouts\/CompactLayout\.js['"]/);
    });
    it('does NOT import CompactLayout from flat ./CompactLayout.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/CompactLayout\.js['"]/);
    });

    it('imports GridLayout from ./layouts/GridLayout.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).toMatch(/from ['"]\.\/layouts\/GridLayout\.js['"]/);
    });
    it('does NOT import GridLayout from flat ./GridLayout.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/GridLayout\.js['"]/);
    });

    it('imports BrandHeader from ./brand/BrandHeader.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).toMatch(/from ['"]\.\/brand\/BrandHeader\.js['"]/);
    });
    it('does NOT import BrandHeader from flat ./BrandHeader.js', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/BrandHeader\.js['"]/);
    });

    it('no longer imports useDashboardMode (deleted in 25.4)', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/useDashboardMode\.js['"]/);
    });

    it('no longer imports usePanelFocus (deleted in 25.4)', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      expect(content).not.toMatch(/from ['"]\.\/usePanelFocus\.js['"]/);
    });

    it('all local (./...) imports use .js extension', () => {
      const content = readSrcFile('ui/dashboard/DashboardApp.tsx');
      const fromLines = content.split('\n').filter(
        line => (line.includes("from '") || line.includes('from "')) && line.includes('./')
      );
      for (const line of fromLines) {
        expect(line).toMatch(/\.js['"]/);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 8 (was 7). ESM .js extension preserved in dashboard/index.ts
  // ---------------------------------------------------------------------------
  describe('8. ESM .js extension preserved in dashboard/index.ts', () => {
    it('dashboard/index.ts uses .js extensions for all re-exports', () => {
      const content = readSrcFile('ui/dashboard/index.ts');
      const fromLines = content.split('\n').filter(line => line.includes("from '") || line.includes('from "'));
      for (const line of fromLines) {
        if (line.includes('./')) {
          expect(line).toMatch(/\.js['"]/);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 9. AC2 — Moved source files update their own internal cross-subdirectory imports
  // ---------------------------------------------------------------------------
  describe('9. AC2: Moved source files use correct cross-subdirectory relative imports', () => {
    describe('active-stories/ActiveStoriesPanel.tsx', () => {
      it('imports useActiveStories from ../hooks/useActiveStories.js', () => {
        const content = readSrcFile('ui/dashboard/active-stories/ActiveStoriesPanel.tsx');
        expect(content).toMatch(/from ['"]\.\.\/hooks\/useActiveStories\.js['"]/);
      });
      it('does NOT use flat ./useActiveStories.js import', () => {
        const content = readSrcFile('ui/dashboard/active-stories/ActiveStoriesPanel.tsx');
        expect(content).not.toMatch(/from ['"]\.\/useActiveStories\.js['"]/);
      });
      it('imports utils from ../shared/utils.js', () => {
        const content = readSrcFile('ui/dashboard/active-stories/ActiveStoriesPanel.tsx');
        expect(content).toMatch(/from ['"]\.\.\/shared\/utils\.js['"]/);
      });
      it('does NOT use flat ./utils.js import', () => {
        const content = readSrcFile('ui/dashboard/active-stories/ActiveStoriesPanel.tsx');
        expect(content).not.toMatch(/from ['"]\.\/utils\.js['"]/);
      });
      it('imports ActiveStoriesTypes from same-dir ./ActiveStoriesTypes.js', () => {
        const content = readSrcFile('ui/dashboard/active-stories/ActiveStoriesPanel.tsx');
        expect(content).toMatch(/from ['"]\.\/ActiveStoriesTypes\.js['"]/);
      });
    });

    describe('layouts/GridLayout.tsx', () => {
      it('does NOT import PipelineFlowPanel (tlPanelNode is always provided as prop)', () => {
        const content = readSrcFile('ui/dashboard/layouts/GridLayout.tsx');
        expect(content).not.toMatch(/PipelineFlowPanel/);
      });
      it('imports ActiveStoriesPanel from ../active-stories/ActiveStoriesPanel.js', () => {
        const content = readSrcFile('ui/dashboard/layouts/GridLayout.tsx');
        expect(content).toMatch(/from ['"]\.\.\/active-stories\/ActiveStoriesPanel\.js['"]/);
      });
      it('imports LiveActivityPanel from ../live-activity/LiveActivityPanel.js', () => {
        const content = readSrcFile('ui/dashboard/layouts/GridLayout.tsx');
        expect(content).toMatch(/from ['"]\.\.\/live-activity\/LiveActivityPanel\.js['"]/);
      });
      it('imports LiveActivityFullscreen from ../live-activity/LiveActivityFullscreen.js', () => {
        const content = readSrcFile('ui/dashboard/layouts/GridLayout.tsx');
        expect(content).toMatch(/from ['"]\.\.\/live-activity\/LiveActivityFullscreen\.js['"]/);
      });
      it('imports DiagnosePanel from ../diagnose/DiagnosePanel.js', () => {
        const content = readSrcFile('ui/dashboard/layouts/GridLayout.tsx');
        expect(content).toMatch(/from ['"]\.\.\/diagnose\/DiagnosePanel\.js['"]/);
      });
    });

    describe('layouts/CompactLayout.tsx', () => {
      it('imports ActiveStoriesPanel from ../active-stories/ActiveStoriesPanel.js', () => {
        const content = readSrcFile('ui/dashboard/layouts/CompactLayout.tsx');
        expect(content).toMatch(/from ['"]\.\.\/active-stories\/ActiveStoriesPanel\.js['"]/);
      });
      it('imports LiveActivityPanel from ../live-activity/LiveActivityPanel.js', () => {
        const content = readSrcFile('ui/dashboard/layouts/CompactLayout.tsx');
        expect(content).toMatch(/from ['"]\.\.\/live-activity\/LiveActivityPanel\.js['"]/);
      });
      it('imports LiveActivityFullscreen from ../live-activity/LiveActivityFullscreen.js', () => {
        const content = readSrcFile('ui/dashboard/layouts/CompactLayout.tsx');
        expect(content).toMatch(/from ['"]\.\.\/live-activity\/LiveActivityFullscreen\.js['"]/);
      });
      it('does NOT use flat ./ActiveStoriesPanel.js import', () => {
        const content = readSrcFile('ui/dashboard/layouts/CompactLayout.tsx');
        expect(content).not.toMatch(/from ['"]\.\/ActiveStoriesPanel\.js['"]/);
      });
    });

    describe('command-menu/CommandMenuPanel.tsx', () => {
      it('imports QueueStats from @ui/stores/workerStore.js (migrated from hook in 26.2)', () => {
        const content = readSrcFile('ui/dashboard/command-menu/CommandMenuPanel.tsx');
        expect(content).toMatch(/@ui\/stores\/workerStore\.js/);
      });
      it('imports useMenuStack from ../hooks/useMenuStack.js', () => {
        const content = readSrcFile('ui/dashboard/command-menu/CommandMenuPanel.tsx');
        expect(content).toMatch(/from ['"]\.\.\/hooks\/useMenuStack\.js['"]/);
      });
      it('imports DashboardTypes from ../shared/DashboardTypes.js', () => {
        const content = readSrcFile('ui/dashboard/command-menu/CommandMenuPanel.tsx');
        expect(content).toMatch(/from ['"]\.\.\/shared\/DashboardTypes\.js['"]/);
      });
      it('imports MenuTypes from same-dir ./MenuTypes.js', () => {
        const content = readSrcFile('ui/dashboard/command-menu/CommandMenuPanel.tsx');
        expect(content).toMatch(/from ['"]\.\/MenuTypes\.js['"]/);
      });
      it('does NOT import from hooks/useWorkerStatus.js (migrated to store in 26.2)', () => {
        const content = readSrcFile('ui/dashboard/command-menu/CommandMenuPanel.tsx');
        expect(content).not.toMatch(/hooks\/useWorkerStatus/);
      });
    });

    describe('command-menu/ActionPanel.tsx', () => {
      it('imports DashboardTypes from ../shared/DashboardTypes.js', () => {
        const content = readSrcFile('ui/dashboard/command-menu/ActionPanel.tsx');
        expect(content).toMatch(/from ['"]\.\.\/shared\/DashboardTypes\.js['"]/);
      });
      it('does NOT use flat ./DashboardTypes.js import', () => {
        const content = readSrcFile('ui/dashboard/command-menu/ActionPanel.tsx');
        expect(content).not.toMatch(/from ['"]\.\/DashboardTypes\.js['"]/);
      });
    });

    describe('live-activity/LiveActivityPanel.tsx', () => {
      it('imports useLiveActivity from ../hooks/useLiveActivity.js', () => {
        const content = readSrcFile('ui/dashboard/live-activity/LiveActivityPanel.tsx');
        expect(content).toMatch(/from ['"]\.\.\/hooks\/useLiveActivity\.js['"]/);
      });
      it('does NOT use flat ./useLiveActivity.js import', () => {
        const content = readSrcFile('ui/dashboard/live-activity/LiveActivityPanel.tsx');
        expect(content).not.toMatch(/from ['"]\.\/useLiveActivity\.js['"]/);
      });
      it('imports CompletionCard from same-dir ./CompletionCard.js', () => {
        const content = readSrcFile('ui/dashboard/live-activity/LiveActivityPanel.tsx');
        expect(content).toMatch(/from ['"]\.\/CompletionCard\.js['"]/);
      });
    });

    describe('hooks/useDashboardContent.tsx', () => {
      it('imports ResetStoryWizard from ../modals/ResetStoryWizard.js', () => {
        const content = readSrcFile('ui/dashboard/hooks/useDashboardContent.tsx');
        expect(content).toMatch(/from ['"]\.\.\/modals\/ResetStoryWizard\.js['"]/);
      });
      it('imports CancelStoryWizard from ../modals/CancelStoryWizard.js', () => {
        const content = readSrcFile('ui/dashboard/hooks/useDashboardContent.tsx');
        expect(content).toMatch(/from ['"]\.\.\/modals\/CancelStoryWizard\.js['"]/);
      });
      it('imports DashboardTypes from ../shared/DashboardTypes.js', () => {
        const content = readSrcFile('ui/dashboard/hooks/useDashboardContent.tsx');
        expect(content).toMatch(/from ['"]\.\.\/shared\/DashboardTypes\.js['"]/);
      });
      it('imports ActionPanel from ../command-menu/ActionPanel.js', () => {
        const content = readSrcFile('ui/dashboard/hooks/useDashboardContent.tsx');
        expect(content).toMatch(/from ['"]\.\.\/command-menu\/ActionPanel\.js['"]/);
      });
      it('imports HelpModal from ../modals/HelpModal.js', () => {
        const content = readSrcFile('ui/dashboard/hooks/useDashboardContent.tsx');
        expect(content).toMatch(/from ['"]\.\.\/modals\/HelpModal\.js['"]/);
      });
      it('imports CommandMenuPanel from ../command-menu/CommandMenuPanel.js', () => {
        const content = readSrcFile('ui/dashboard/hooks/useDashboardContent.tsx');
        expect(content).toMatch(/from ['"]\.\.\/command-menu\/CommandMenuPanel\.js['"]/);
      });
      it('does NOT use flat ./ResetStoryWizard.js import', () => {
        const content = readSrcFile('ui/dashboard/hooks/useDashboardContent.tsx');
        expect(content).not.toMatch(/from ['"]\.\/ResetStoryWizard\.js['"]/);
      });
      it('does NOT use flat ./DashboardTypes.js import', () => {
        const content = readSrcFile('ui/dashboard/hooks/useDashboardContent.tsx');
        expect(content).not.toMatch(/from ['"]\.\/DashboardTypes\.js['"]/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Subdirectory names with hyphens are valid filesystem paths
  // ---------------------------------------------------------------------------
  describe('10. Kebab-case subdirectory names are valid filesystem paths', () => {
    it('active-stories/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('active-stories'))).toBe(true);
    });
    it('live-activity/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('live-activity'))).toBe(true);
    });
    it('pipeline-flow/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('pipeline-flow'))).toBe(true);
    });
    it('command-menu/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('command-menu'))).toBe(true);
    });
    it('layouts/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('layouts'))).toBe(true);
    });
    it('hooks/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('hooks'))).toBe(true);
    });
    it('shared/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('shared'))).toBe(true);
    });
    it('modals/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('modals'))).toBe(true);
    });
    it('crew/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('crew'))).toBe(true);
    });
    it('brand/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('brand'))).toBe(true);
    });
    it('diagnose/ subdirectory exists as a directory', () => {
      expect(existsSync(dashSrc('diagnose'))).toBe(true);
    });
  });
});
