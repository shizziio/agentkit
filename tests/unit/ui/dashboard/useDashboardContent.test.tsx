/**
 * Tests for useDashboardContent hook — Story 27.3 update.
 *
 * After Story 27.3, useDashboardContent no longer receives service/db/config
 * params. Those are now read from appStore internally via useAppStore.getState().
 *
 * Remaining params: actionMode, isActionActive, handleActionClose, focusedPanel,
 * onSelectAction, menuStack, and optional callbacks/display props.
 *
 * Strategy: call useDashboardContent directly (no renderer needed), then
 * inspect the returned JSX element's props to verify correct content selection.
 * The appStore is mocked to provide services for buildActiveContent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock appStore — provides services read by buildActiveContent / wizards
// ---------------------------------------------------------------------------
vi.mock('@ui/stores/appStore.js', () => {
  const mockPipelineConfig = {
    project: { name: 'test-project', id: 'proj-1' },
    team: 'test-team',
    provider: 'claude',
    stages: [{ name: 'sm' }, { name: 'dev' }],
    models: { resolved: { sm: 'claude-3', dev: 'claude-3' } },
  };

  const mockConfigService = {
    loadSettings: () => ({
      projectConfig: {
        version: 2,
        project: { name: 'test-project' },
        teams: ['test-team'],
        provider: 'claude',
        activeTeam: 'test-team',
      },
    }),
    saveModelAssignments: async (_models: Record<string, string>) => {},
    listBundledTeams: () => [] as string[],
  };

  const mockTeamSwitchService = {
    switchTeam: async (_teamName: string) => {},
  };

  return {
    useAppStore: {
      getState: () => ({
        pipelineConfig: mockPipelineConfig,
        configService: mockConfigService,
        teamSwitchService: mockTeamSwitchService,
        projectId: 1,
        db: {},
        eventBus: {},
        resetService: {},
        markDoneService: {},
        loadService: {},
        markdownParser: {},
      }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    },
    useDb: () => ({}),
    useEventBus: () => ({}),
    usePipelineConfig: () => mockPipelineConfig,
    useProjectId: () => 1,
    useConfigService: () => mockConfigService,
    useTeamSwitchService: () => mockTeamSwitchService,
    useResetService: () => ({}),
    useMarkDoneService: () => ({}),
    useLoadService: () => ({}),
    useMarkdownParser: () => ({}),
    useDiagnoseService: () => ({}),
  };
});

// ---------------------------------------------------------------------------
// Mock all heavy child components so we can inspect props without rendering
// ---------------------------------------------------------------------------
vi.mock('@ui/dashboard/command-menu/ActionPanel.js', () => ({
  ActionPanel: (props: Record<string, unknown>) => React.createElement('mock-action-panel', props as React.HTMLAttributes<Element>),
}));
vi.mock('@ui/dashboard/command-menu/CommandMenuPanel.js', () => ({
  CommandMenuPanel: () => null,
}));
vi.mock('@ui/load/LoadWizard.js', () => ({
  LoadWizard: () => null,
}));
vi.mock('@ui/ship/ShipWizard.js', () => ({
  ShipWizard: () => null,
}));
vi.mock('@ui/diagnose/DiagnoseWizard.js', () => ({
  DiagnoseWizard: () => null,
}));
vi.mock('@ui/config/ConfigWizard.js', () => ({
  ConfigWizard: () => null,
}));
vi.mock('@ui/dashboard/modals/HelpModal.js', () => ({
  HelpModal: () => null,
}));
vi.mock('@ui/mark-done/MarkDoneWizard.js', () => ({
  MarkDoneWizard: () => null,
}));
vi.mock('@ui/history/HistoryWizard.js', () => ({
  HistoryWizard: () => null,
}));
vi.mock('@ui/replay/ReplayPicker.js', () => ({
  ReplayPicker: () => null,
}));
vi.mock('@ui/config/SwitchTeamWizard.js', () => ({
  SwitchTeamWizard: () => null,
}));
vi.mock('@ui/config/SwitchProviderWizard.js', () => ({
  SwitchProviderWizard: () => null,
}));
vi.mock('@ui/config/ModelConfigWizard.js', () => ({
  ModelConfigWizard: () => null,
}));
vi.mock('@ui/config/ConfigViewer.js', () => ({
  ConfigViewer: () => null,
}));
vi.mock('@ui/dashboard/modals/ResetStoryWizard.js', () => ({
  ResetStoryWizard: () => null,
}));
vi.mock('@ui/dashboard/modals/CancelStoryWizard.js', () => ({
  CancelStoryWizard: () => null,
}));

import { useDashboardContent } from '@ui/dashboard/hooks/useDashboardContent.js';
import { LoadWizard } from '@ui/load/LoadWizard.js';
import { ShipWizard } from '@ui/ship/ShipWizard.js';
import { DiagnoseWizard } from '@ui/diagnose/DiagnoseWizard.js';
import { ConfigWizard } from '@ui/config/ConfigWizard.js';
import { HelpModal } from '@ui/dashboard/modals/HelpModal.js';
import { MarkDoneWizard } from '@ui/mark-done/MarkDoneWizard.js';
import { HistoryWizard } from '@ui/history/HistoryWizard.js';
import { ReplayPicker } from '@ui/replay/ReplayPicker.js';
import { SwitchTeamWizard } from '@ui/config/SwitchTeamWizard.js';
import { SwitchProviderWizard } from '@ui/config/SwitchProviderWizard.js';
import { ResetStoryWizard } from '@ui/dashboard/modals/ResetStoryWizard.js';
import { CancelStoryWizard } from '@ui/dashboard/modals/CancelStoryWizard.js';
import { CommandMenuPanel } from '@ui/dashboard/command-menu/CommandMenuPanel.js';
import type { ActionMode } from '@ui/dashboard/shared/DashboardTypes.js';
import type { UseMenuStack } from '@ui/dashboard/hooks/useMenuStack.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * makeParams no longer includes any of the 10 removed service/db fields:
 * db, eventBus, projectId, pipelineConfig, configService, teamSwitchService,
 * resetService, markDoneService, loadService, markdownParser.
 * These are now read from appStore internally.
 */
function makeParams(overrides: Partial<{
  actionMode: ActionMode;
  isActionActive: boolean;
  handleActionClose: () => void;
}> = {}) {
  return {
    actionMode: 'none' as ActionMode,
    isActionActive: false,
    handleActionClose: vi.fn(),
    menuStack: {
      stack: ['main'] as const,
      currentLevel: 'main' as const,
      push: vi.fn(),
      pop: vi.fn(),
      handleQ: vi.fn(),
    } as unknown as UseMenuStack,
    focusedPanel: 0,
    onSelectAction: vi.fn(),
    ...overrides,
  };
}

/** Get the ActionPanel props from the returned tlPanelNode element. */
function getActionPanelProps(tlPanelNode: React.JSX.Element) {
  return tlPanelNode.props as {
    actionMode: string;
    idleContent: React.ReactNode;
    activeContent: React.ReactNode | null;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useDashboardContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Params interface — verify removed service fields are NOT present
  // -------------------------------------------------------------------------
  describe('UseDashboardContentParams interface (Story 27.3 acceptance criteria)', () => {
    it('accepts params without db field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('db');
    });

    it('accepts params without eventBus field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('eventBus');
    });

    it('accepts params without projectId field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('projectId');
    });

    it('accepts params without pipelineConfig field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('pipelineConfig');
    });

    it('accepts params without configService field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('configService');
    });

    it('accepts params without teamSwitchService field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('teamSwitchService');
    });

    it('accepts params without resetService field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('resetService');
    });

    it('accepts params without markDoneService field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('markDoneService');
    });

    it('accepts params without loadService field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('loadService');
    });

    it('accepts params without markdownParser field', () => {
      const params = makeParams();
      expect(params).not.toHaveProperty('markdownParser');
    });

    it('still calls useDashboardContent without throwing when service fields are absent', () => {
      expect(() => useDashboardContent(makeParams())).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Basic output
  // -------------------------------------------------------------------------
  it('returns an object with tlPanelNode', () => {
    const result = useDashboardContent(makeParams());
    expect(result).toHaveProperty('tlPanelNode');
    expect(React.isValidElement(result.tlPanelNode)).toBe(true);
  });

  describe('idle state (actionMode=none)', () => {
    it('passes actionMode=none to ActionPanel', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'none' }));
      const props = getActionPanelProps(tlPanelNode);
      expect(props.actionMode).toBe('none');
    });

    it('passes non-null idleContent', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'none' }));
      const props = getActionPanelProps(tlPanelNode);
      expect(props.idleContent).not.toBeNull();
      expect(React.isValidElement(props.idleContent)).toBe(true);
    });

    it('passes null activeContent when isActionActive=false', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'none', isActionActive: false }));
      const props = getActionPanelProps(tlPanelNode);
      expect(props.activeContent).toBeNull();
    });
  });

  describe('active wizard states', () => {
    it('renders non-null activeContent when actionMode=load and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: true }));
      const props = getActionPanelProps(tlPanelNode);
      expect(props.actionMode).toBe('load');
      expect(props.activeContent).not.toBeNull();
      expect(React.isValidElement(props.activeContent)).toBe(true);
    });

    it('renders non-null activeContent when actionMode=ship and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'ship', isActionActive: true }));
      expect(getActionPanelProps(tlPanelNode).activeContent).not.toBeNull();
    });

    it('renders non-null activeContent when actionMode=diagnose and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'diagnose', isActionActive: true }));
      expect(getActionPanelProps(tlPanelNode).activeContent).not.toBeNull();
    });

    it('renders non-null activeContent when actionMode=help and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'help', isActionActive: true }));
      const props = getActionPanelProps(tlPanelNode);
      expect(props.activeContent).not.toBeNull();
      expect(React.isValidElement(props.activeContent)).toBe(true);
    });
  });

  describe('isActionActive=false with non-none mode', () => {
    it('returns null activeContent when isActionActive=false and mode=load', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: false }));
      expect(getActionPanelProps(tlPanelNode).activeContent).toBeNull();
    });

    it('returns null activeContent when isActionActive=false and mode=help', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'help', isActionActive: false }));
      expect(getActionPanelProps(tlPanelNode).activeContent).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // LoadWizard props — AC: only onComplete, onCancel, compact (+ filePath?, isSimple)
  // -------------------------------------------------------------------------
  describe('LoadWizard props', () => {
    it('renders LoadWizard element type when actionMode=load', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.type).toBe(LoadWizard);
    });

    it('passes compact=true to LoadWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes handleActionClose as onComplete and onCancel to LoadWizard', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onComplete).toBe(handleActionClose);
      expect(activeContent.props.onCancel).toBe(handleActionClose);
    });

    it('does NOT pass projectId as prop to LoadWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('projectId');
    });

    it('does NOT pass loadService as prop to LoadWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('loadService');
    });

    it('does NOT pass markdownParser as prop to LoadWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('markdownParser');
    });

    it('passes isSimple={false} to LoadWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.isSimple).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ShipWizard props — AC: only onComplete, onCancel, compact?, height?
  // -------------------------------------------------------------------------
  describe('ShipWizard props', () => {
    it('renders ShipWizard element type when actionMode=ship', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'ship', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.type).toBe(ShipWizard);
    });

    it('passes compact=true to ShipWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'ship', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes handleActionClose as onComplete and onCancel to ShipWizard', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'ship', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onComplete).toBe(handleActionClose);
      expect(activeContent.props.onCancel).toBe(handleActionClose);
    });

    it('does NOT pass projectId as prop to ShipWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'ship', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('projectId');
    });

    it('does NOT pass db as prop to ShipWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'ship', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('db');
    });

    it('does NOT pass firstStageName as prop to ShipWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'ship', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('firstStageName');
    });

    it('does NOT pass activeTeam as prop to ShipWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'ship', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('activeTeam');
    });
  });

  // -------------------------------------------------------------------------
  // DiagnoseWizard props — AC: only onComplete, onCancel, compact?
  // -------------------------------------------------------------------------
  describe('DiagnoseWizard props', () => {
    it('renders DiagnoseWizard element type when actionMode=diagnose', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'diagnose', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.type).toBe(DiagnoseWizard);
    });

    it('passes compact=true to DiagnoseWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'diagnose', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes handleActionClose as onComplete and onCancel to DiagnoseWizard', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'diagnose', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onComplete).toBe(handleActionClose);
      expect(activeContent.props.onCancel).toBe(handleActionClose);
    });

    it('does NOT pass db as prop to DiagnoseWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'diagnose', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('db');
    });

    it('does NOT pass pipelineConfig as prop to DiagnoseWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'diagnose', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('pipelineConfig');
    });
  });

  // -------------------------------------------------------------------------
  // CommandMenuPanel as idle content
  // -------------------------------------------------------------------------
  describe('CommandMenuPanel as idle content', () => {
    it('idleContent element type is CommandMenuPanel', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'none' }));
      const props = getActionPanelProps(tlPanelNode);
      expect(React.isValidElement(props.idleContent)).toBe(true);
      expect((props.idleContent as React.JSX.Element).type).toBe(CommandMenuPanel);
    });

    it('idleContent receives onSelectAction prop', () => {
      const onSelectAction = vi.fn();
      const { tlPanelNode } = useDashboardContent({ ...makeParams({ actionMode: 'none' }), onSelectAction });
      const props = getActionPanelProps(tlPanelNode);
      const idleEl = props.idleContent as React.JSX.Element;
      expect(idleEl.props).toHaveProperty('onSelectAction', onSelectAction);
    });

    it('idleContent is still CommandMenuPanel even when action is active', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'load', isActionActive: true }));
      const props = getActionPanelProps(tlPanelNode);
      expect((props.idleContent as React.JSX.Element).type).toBe(CommandMenuPanel);
    });

    it('idleContent passes isActionActive=true to CommandMenuPanel when action is active', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ isActionActive: true }));
      const idleEl = getActionPanelProps(tlPanelNode).idleContent as React.JSX.Element;
      expect(idleEl.props).toHaveProperty('isActionActive', true);
    });
  });

  // -------------------------------------------------------------------------
  // HelpModal props
  // -------------------------------------------------------------------------
  describe('HelpModal props', () => {
    it('renders HelpModal element when actionMode=help', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'help', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.type).toBe(HelpModal);
    });

    it('passes compact=true to HelpModal', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'help', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes handleActionClose as onClose to HelpModal', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'help', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onClose).toBe(handleActionClose);
    });
  });

  // -------------------------------------------------------------------------
  // MarkDoneWizard props — AC: only onComplete, onCancel, compact
  // -------------------------------------------------------------------------
  describe('MarkDoneWizard props (Story 27.3)', () => {
    it('renders MarkDoneWizard element when actionMode=mark-done', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'mark-done', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.type).toBe(MarkDoneWizard);
    });

    it('passes compact=true to MarkDoneWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'mark-done', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes handleActionClose as onComplete and onCancel to MarkDoneWizard', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'mark-done', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onComplete).toBe(handleActionClose);
      expect(activeContent.props.onCancel).toBe(handleActionClose);
    });

    it('does NOT pass projectId as prop to MarkDoneWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'mark-done', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('projectId');
    });

    it('does NOT pass db as prop to MarkDoneWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'mark-done', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('db');
    });

    it('does NOT pass eventBus as prop to MarkDoneWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'mark-done', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('eventBus');
    });

    it('does NOT pass markDoneService as prop to MarkDoneWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'mark-done', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('markDoneService');
    });
  });

  // -------------------------------------------------------------------------
  // HistoryWizard props — AC: only filter, onExit, compact
  // -------------------------------------------------------------------------
  describe('HistoryWizard props (Story 27.3)', () => {
    it('renders HistoryWizard when actionMode=history and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'history', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent).not.toBeNull();
      expect(activeContent.type).toBe(HistoryWizard);
    });

    it('passes compact=true to HistoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'history', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes handleActionClose as onExit to HistoryWizard', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'history', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onExit).toBe(handleActionClose);
    });

    it('does NOT pass projectId as prop to HistoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'history', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('projectId');
    });

    it('does NOT pass db as prop to HistoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'history', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('db');
    });

    it('does NOT pass pipelineConfig as prop to HistoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'history', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('pipelineConfig');
    });

    it('does NOT pass eventBus as prop to HistoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'history', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('eventBus');
    });
  });

  // -------------------------------------------------------------------------
  // ReplayPicker props — AC: only onQuit
  // -------------------------------------------------------------------------
  describe('ReplayPicker props (Story 27.3)', () => {
    it('renders ReplayPicker when actionMode=replay and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'replay', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent).not.toBeNull();
      expect(activeContent.type).toBe(ReplayPicker);
    });

    it('passes handleActionClose as onQuit to ReplayPicker', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'replay', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onQuit).toBe(handleActionClose);
    });

    it('does NOT pass db as prop to ReplayPicker', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'replay', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('db');
    });

    it('does NOT pass projectId as prop to ReplayPicker', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'replay', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('projectId');
    });
  });

  // -------------------------------------------------------------------------
  // ResetStoryWizard props — AC: only onComplete, onCancel, compact
  // -------------------------------------------------------------------------
  describe('ResetStoryWizard props (Story 27.3)', () => {
    it('renders ResetStoryWizard when actionMode=reset-story and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'reset-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent).not.toBeNull();
      expect(activeContent.type).toBe(ResetStoryWizard);
    });

    it('passes compact=true to ResetStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'reset-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes handleActionClose as onComplete and onCancel to ResetStoryWizard', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'reset-story', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onComplete).toBe(handleActionClose);
      expect(activeContent.props.onCancel).toBe(handleActionClose);
    });

    it('does NOT pass db as prop to ResetStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'reset-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('db');
    });

    it('does NOT pass projectId as prop to ResetStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'reset-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('projectId');
    });

    it('does NOT pass pipelineConfig as prop to ResetStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'reset-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('pipelineConfig');
    });

    it('does NOT pass eventBus as prop to ResetStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'reset-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('eventBus');
    });

    it('does NOT pass resetService as prop to ResetStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'reset-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('resetService');
    });
  });

  // -------------------------------------------------------------------------
  // CancelStoryWizard props — AC: only onComplete, onCancel, compact
  // -------------------------------------------------------------------------
  describe('CancelStoryWizard props (Story 27.3)', () => {
    it('renders CancelStoryWizard when actionMode=cancel-story and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'cancel-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent).not.toBeNull();
      expect(activeContent.type).toBe(CancelStoryWizard);
    });

    it('passes compact=true to CancelStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'cancel-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes handleActionClose as onComplete and onCancel to CancelStoryWizard', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'cancel-story', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onComplete).toBe(handleActionClose);
      expect(activeContent.props.onCancel).toBe(handleActionClose);
    });

    it('does NOT pass db as prop to CancelStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'cancel-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('db');
    });

    it('does NOT pass projectId as prop to CancelStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'cancel-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('projectId');
    });

    it('does NOT pass pipelineConfig as prop to CancelStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'cancel-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('pipelineConfig');
    });

    it('does NOT pass eventBus as prop to CancelStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'cancel-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('eventBus');
    });

    it('does NOT pass resetService as prop to CancelStoryWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'cancel-story', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('resetService');
    });
  });

  // -------------------------------------------------------------------------
  // SwitchTeamWizard (unchanged — still receives processed data as props)
  // -------------------------------------------------------------------------
  describe('SwitchTeamWizard', () => {
    it('renders SwitchTeamWizard when actionMode=switch-team and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'switch-team', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent).not.toBeNull();
      expect(activeContent.type).toBe(SwitchTeamWizard);
    });

    it('passes compact=true to SwitchTeamWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'switch-team', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes handleActionClose as onComplete and onCancel to SwitchTeamWizard', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'switch-team', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onComplete).toBe(handleActionClose);
      expect(activeContent.props.onCancel).toBe(handleActionClose);
    });

    it('returns null activeContent for switch-team when isActionActive=false', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'switch-team', isActionActive: false }));
      expect(getActionPanelProps(tlPanelNode).activeContent).toBeNull();
    });

    it('passes mergedTeams array as prop to SwitchTeamWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'switch-team', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).toHaveProperty('mergedTeams');
      expect(Array.isArray(activeContent.props.mergedTeams)).toBe(true);
    });

    it('passes projectTeams array as prop to SwitchTeamWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'switch-team', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).toHaveProperty('projectTeams');
      expect(Array.isArray(activeContent.props.projectTeams)).toBe(true);
    });

    it('passes activeTeam string as prop to SwitchTeamWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'switch-team', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).toHaveProperty('activeTeam');
    });

    it('passes loadError (null or string) as prop to SwitchTeamWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'switch-team', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).toHaveProperty('loadError');
    });

    it('passes onSwitch function as prop to SwitchTeamWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'switch-team', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).toHaveProperty('onSwitch');
      expect(typeof activeContent.props.onSwitch).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // SwitchProviderWizard — AC: configService is NOT passed as prop
  // -------------------------------------------------------------------------
  describe('SwitchProviderWizard props (Story 27.3)', () => {
    it('renders SwitchProviderWizard when actionMode=change-provider and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'change-provider', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent).not.toBeNull();
      expect(activeContent.type).toBe(SwitchProviderWizard);
    });

    it('passes compact=true to SwitchProviderWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'change-provider', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.compact).toBe(true);
    });

    it('passes activeProvider prop to SwitchProviderWizard (derived from appStore pipelineConfig)', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'change-provider', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).toHaveProperty('activeProvider');
    });

    it('does NOT pass configService as prop to SwitchProviderWizard', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'change-provider', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('configService');
    });

    it('passes handleActionClose as onComplete and onCancel to SwitchProviderWizard', () => {
      const handleActionClose = vi.fn();
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'change-provider', isActionActive: true, handleActionClose }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props.onComplete).toBe(handleActionClose);
      expect(activeContent.props.onCancel).toBe(handleActionClose);
    });

    it('returns null activeContent for change-provider when isActionActive=false', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'change-provider', isActionActive: false }));
      expect(getActionPanelProps(tlPanelNode).activeContent).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Config view modes
  // -------------------------------------------------------------------------
  describe('config view modes', () => {
    it('renders ConfigViewer when actionMode=view-config and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'view-config', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent).not.toBeNull();
      expect(activeContent.props).toHaveProperty('onBack');
    });

    it('ConfigViewer does NOT receive pipeline as prop (reads from appStore internally)', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'view-config', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('pipeline');
    });

    it('renders ModelConfigWizard when actionMode=change-models and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'change-models', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent).not.toBeNull();
      expect(activeContent.props).toHaveProperty('onSave');
    });

    it('ModelConfigWizard does NOT receive pipeline as prop (reads from appStore)', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'change-models', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent.props).not.toHaveProperty('pipeline');
    });

    it('renders ConfigWizard when actionMode=config and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'config', isActionActive: true }));
      const activeContent = getActionPanelProps(tlPanelNode).activeContent as React.JSX.Element;
      expect(activeContent).not.toBeNull();
      expect(activeContent.type).toBe(ConfigWizard);
    });
  });

  // -------------------------------------------------------------------------
  // Additional placeholder modes
  // -------------------------------------------------------------------------
  describe('placeholder action modes', () => {
    it('renders non-null activeContent when actionMode=mark-done and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'mark-done', isActionActive: true }));
      const props = getActionPanelProps(tlPanelNode);
      expect(props.activeContent).not.toBeNull();
      expect(React.isValidElement(props.activeContent)).toBe(true);
    });

    it('renders non-null activeContent when actionMode=history and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'history', isActionActive: true }));
      expect(getActionPanelProps(tlPanelNode).activeContent).not.toBeNull();
    });

    it('renders non-null activeContent when actionMode=replay and isActionActive=true', () => {
      const { tlPanelNode } = useDashboardContent(makeParams({ actionMode: 'replay', isActionActive: true }));
      expect(getActionPanelProps(tlPanelNode).activeContent).not.toBeNull();
    });

    it('idleContent passes onSelectAction to CommandMenuPanel', () => {
      const onSelectAction = vi.fn();
      const { tlPanelNode } = useDashboardContent({ ...makeParams(), onSelectAction });
      const props = getActionPanelProps(tlPanelNode);
      const idleEl = props.idleContent as React.JSX.Element;
      expect(idleEl.props).toHaveProperty('onSelectAction', onSelectAction);
    });
  });
});
