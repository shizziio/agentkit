# Dashboard Rendering Architecture Rewrite

## Problem Statement

Ink (React for CLI) renders by overwriting previous terminal output via ANSI escape codes. When components re-render too frequently or output height changes between renders, Ink appends new output below instead of overwriting — causing stacked/overlapping output (BrandHeader appearing 6+ times).

Current architecture has `DashboardApp` as a god component that subscribes to multiple stores, creates new JSX references every render, and passes 15+ inline callbacks to children. Any store change cascades through the entire tree.

---

## Design Principles

1. **Static shell, dynamic leaves** — parent components render once and never re-render for store changes
2. **Every dynamic element subscribes to its own store slice** — no parent-to-child data drilling
3. **Stable component tree** — no conditional JSX that changes tree structure; use `display: flex/none` toggle
4. **No JSX-as-props** — components render their own content based on store state
5. **All callbacks via store actions** — no inline callbacks passed as props
6. **Fixed height** — every container has explicit height + `overflow="hidden"`

---

## New Component Tree

```
StoreInitGate (renders empty Box until stores init, then mounts DashboardApp once)
└── DashboardApp (static shell — ZERO store subscriptions, renders once)
    ├── BrandHeader (static shell, height=DASHBOARD_CHROME_ROWS)
    │   ├── BrandInfoMemo (subscribes: appStore.pipelineConfig)
    │   ├── WorkerStatusBarMemo (subscribes: workerStore.workerStatuses)
    │   ├── QueueStatsBarMemo (subscribes: workerStore.queueStats + pipelineState)
    │   ├── MetaInfoMemo (subscribes: appStore.pipelineConfig + projectConfig)
    │   ├── PipelineStatusDotMemo (subscribes: workerStore.pipelineState)
    │   └── HintLineMemo (subscribes: dashboardStore.actionMode)
    ├── ContentArea (static shell, height=rows-CHROME)
    │   ├── OverviewMode (subscribes: dashboardStore.dashboardMode → display toggle)
    │   │   └── GridLayout / CompactLayout (static shell)
    │   │       ├── PanelSlot[0] (subscribes: dashboardStore.focusModePanel → visibility)
    │   │       │   └── TLPanel
    │   │       │       ├── CommandMenuPanel (display when idle, subscribes: menuStore + workerStore)
    │   │       │       └── ActionRouter (display when action active, subscribes: dashboardStore.actionMode)
    │   │       ├── PanelSlot[1]
    │   │       │   └── ActiveStoriesPanel (subscribes: storiesStore, local duration tick)
    │   │       ├── PanelSlot[2]
    │   │       │   └── LiveActivityPanel (subscribes: activityStore)
    │   │       └── PanelSlot[3]
    │   │           └── DiagnosePanel (subscribes: appStore.diagnoseService + eventBus)
    │   └── TraceMode (subscribes: dashboardStore.dashboardMode → display toggle)
    │       └── TraceWizard
    └── KeyBindings (ZERO props — reads all state from stores via getState())
```

### Key Differences from Current

| Aspect | Current | New |
|---|---|---|
| DashboardApp subscriptions | dashboardStore + appStore | Zero |
| TL panel content | JSX created in hook, passed as prop | ActionRouter component renders inline |
| KeyBindings | 15+ callback props | Zero props, reads stores directly |
| Menu stack | useState hook in DashboardApp | Zustand menuStore |
| Focus mode | useState in DashboardApp | dashboardStore state |
| Trace/Overview toggle | Conditional JSX (different trees) | Both always mounted, display toggle |
| GridLayout store reads | dashboardStore + appStore | Zero (all via props or child subscription) |

---

## Store Changes

### dashboardStore — Add Fields

```typescript
// New fields to add:
focusModePanel: number | null;       // moved from DashboardApp useState
enterFocusMode: () => void;          // sets focusModePanel = focusedPanel
exitFocusMode: () => void;           // sets focusModePanel = null
```

### New: menuStore

Extract `useMenuStack` hook into a Zustand store:

```typescript
interface MenuStore {
  stack: MenuLevel[];
  currentLevel: MenuLevel;
  push: (level: MenuLevel) => void;
  pop: () => void;
  handleQ: () => void;   // reads dashboardStore.actionMode internally
  reset: () => void;
}
```

`handleQ` logic:
1. If `actionMode !== 'none'` → `closeAction()` + `storiesStore.refresh()`
2. Else if stack.length > 1 → `pop()`
3. Else → `openAction('quit-confirm')`

### New: menuActions.ts

Extract `handleMenuAction` callback into a standalone function:

```typescript
export function handleMenuAction(action: string): void {
  const isPipelineRunning = useWorkerStore.getState().pipelineState === 'running';
  const { openAction, toggleTrace } = useDashboardStore.getState();
  const { onToggleWorkers, onEnterTrace, pipelineConfig } = useAppStore.getState();

  switch (action) {
    case 'run-pipeline':
      if (isPipelineRunning) openAction('drain-confirm');
      else onToggleWorkers?.();
      break;
    case 'trace':
      toggleTrace();
      onEnterTrace?.();
      break;
    // ... etc
  }
}
```

Called directly by `CommandMenuPanel` and `KeyBindings` — no prop needed.

### appStore — Add Callback Storage

Store `onToggleWorkers`, `onDrain`, `onComplete`, `onEnterTrace` etc. in appStore during init so they're accessible from any store action via `getState()`.

---

## Key Component Designs

### StoreInitGate

```typescript
function StoreInitGate(props: DashboardProps): JSX.Element {
  const [ready, setReady] = useState(false);
  const initRef = useRef(false);

  useLayoutEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    // Init all stores synchronously
    useAppStore.getState().init(props);
    useAlertStore.getState().init(eventBus);
    useWorkerStore.getState().init(eventBus);
    useActivityStore.getState().init(eventBus);
    useStoriesStore.getState().init(eventBus, db, team);
    setReady(true);
    return () => { /* cleanup all stores */ };
  }, []);

  if (!ready) return <Box height={rows} width={columns} />;
  return <DashboardApp {...props} />;
}
```

DashboardApp mounts exactly once — all stores already initialized.

### KeyBindings (Zero Props)

```typescript
export function KeyBindings(): null {
  const lastKeyTimeRef = useRef(0);

  useInput((input, key) => {
    if (Date.now() - lastKeyTimeRef.current < 150) return;
    lastKeyTimeRef.current = Date.now();

    // Read everything from stores at keypress time — no subscriptions
    const ds = useDashboardStore.getState();
    const ws = useWorkerStore.getState();
    const app = useAppStore.getState();
    const menu = useMenuStore.getState();
    const isActionActive = ds.actionMode !== 'none';

    if (input === 'q' || input === 'Q') { menu.handleQ(); return; }
    if (input === 'l' || input === 'L') { if (!isActionActive) ds.openAction('load'); return; }
    if (input === 'r' || input === 'R') {
      if (ws.pipelineState === 'running') ds.openAction('terminate-confirm');
      else app.onToggleWorkers?.();
      return;
    }
    // ... etc
  }, { isActive: true });

  return null;
}
```

Renders once. Never re-renders. `useInput` callback reads fresh state on each keypress.

### TLPanel (replaces useDashboardContent)

```typescript
function TLPanel({ width, height }): JSX.Element {
  const isIdle = useDashboardStore(s => s.actionMode === 'none' || s.actionMode === 'ask-agent');
  return (
    <>
      <Box display={isIdle ? 'flex' : 'none'} height={height} overflow="hidden">
        <CommandMenuPanel width={width} height={height} />
      </Box>
      <Box display={isIdle ? 'none' : 'flex'} height={height} overflow="hidden">
        <ActionRouter width={width} height={height} />
      </Box>
    </>
  );
}
```

Both branches always mounted. Display toggles. No tree structure change.

### ActionRouter (replaces buildActiveContent)

```typescript
function ActionRouter({ width, height }): JSX.Element | null {
  const actionMode = useDashboardStore(s => s.actionMode);
  if (actionMode === 'none' || actionMode === 'ask-agent') return null;
  const close = useDashboardStore.getState().closeAction;

  switch (actionMode) {
    case 'load': return <LoadWizard onComplete={close} onCancel={close} compact />;
    case 'ship': return <ShipWizard onComplete={close} onCancel={close} compact />;
    // ... etc
  }
}
```

`close` is a stable reference from `getState()`. Only ActionRouter re-renders when action changes.

### PanelSlot

```typescript
function PanelSlot({ index, width, height, children }): JSX.Element {
  const visible = useDashboardStore(s => s.focusModePanel === null || s.focusModePanel === index);
  return (
    <Box display={visible ? 'flex' : 'none'} width={width} height={height} overflow="hidden">
      {children}
    </Box>
  );
}
```

Children are static (rendered once by parent). Only re-renders when focus mode changes.

---

## Migration Phases

### Phase 1: Store Extraction (low risk)
1. Add `focusModePanel`, `enterFocusMode`, `exitFocusMode` to dashboardStore
2. Create `menuStore.ts`
3. Create `menuActions.ts`

### Phase 2: KeyBindings Rewrite (medium risk)
4. Rewrite KeyBindings to zero-prop architecture
5. Remove all callback props from interface

### Phase 3: TLPanel / ActionRouter (medium risk)
6. Create `TLPanel` component
7. Create `ActionRouter` component
8. Delete `useDashboardContent.tsx` hook
9. Delete `ActionPanel.tsx`

### Phase 4: Layout Stabilization (high impact)
10. Create `PanelSlot` component
11. Rewrite GridLayout — remove `tlPanelNode` prop, pure static shell
12. Rewrite CompactLayout — same pattern
13. Panels read `isFocused` from dashboardStore directly

### Phase 5: DashboardApp Static Shell (final)
14. Create `StoreInitGate` wrapper
15. Strip all subscriptions from DashboardApp
16. Render both OverviewMode and TraceMode always (display toggle)
17. Delete `useMenuStack` hook

### Phase 6: Cleanup
18. Update tests
19. Remove dead code

---

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| `display: 'none'` still occupies space in Ink | Test first; fallback to `height={0}` |
| Wizards assume unmount on close | Use `actionMode` as React key → remount on change |
| Terminal resize re-renders DashboardApp | Acceptable — only trigger for re-render |
| Multiple `useInput` hooks conflict | Use `isActive` flag per component |
| Store init order dependency | Single `useLayoutEffect` inits all stores in order |

---

## Re-render Map (After Rewrite)

| Trigger | Components that re-render |
|---|---|
| workerStore.workerStatuses change | WorkerStatusBarMemo only |
| workerStore.queueStats change | QueueStatsBarMemo, CommandMenuPanel only |
| workerStore.pipelineState change | PipelineStatusDotMemo, QueueStatsBarMemo, CommandMenuPanel only |
| activityStore.events change | LiveActivityPanel only |
| storiesStore.entries change | ActiveStoriesPanel only |
| dashboardStore.actionMode change | HintLineMemo, TLPanel (display toggle), ActionRouter only |
| dashboardStore.focusedPanel change | PanelSlot[n] where isFocused changes (2 slots max) |
| dashboardStore.focusModePanel change | PanelSlot[n] visibility toggle |
| dashboardStore.dashboardMode change | OverviewMode + TraceMode display toggle |
| menuStore.currentLevel change | CommandMenuPanel only |
| Terminal resize | DashboardApp (full re-render — acceptable) |

**DashboardApp never re-renders except on terminal resize.**
