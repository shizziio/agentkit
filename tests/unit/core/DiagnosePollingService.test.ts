import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiagnosePollingService } from '@core/DiagnosePollingService';
import type { DiagnoseService } from '@core/DiagnoseService';
import type { EventBus } from '@core/EventBus';
import type { LoggerInstance } from '@core/Logger';
import type { DiagnoseResult } from '@core/DiagnoseTypes';

const makeResult = (): DiagnoseResult => ({
  issues: [],
  summary: { stuckCount: 0, orphanedCount: 0, queueGapCount: 0, loopBlockedCount: 0 },
});

function makeMocks(): {
  diagnoseService: DiagnoseService;
  eventBus: EventBus;
  logger: LoggerInstance;
} {
  const diagnoseService = {
    diagnose: vi.fn(() => makeResult()),
  } as unknown as DiagnoseService;

  const eventBus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as EventBus;

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as LoggerInstance;

  return { diagnoseService, eventBus, logger };
}

describe('DiagnosePollingService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('calls diagnose() immediately on start()', () => {
    const { diagnoseService, eventBus, logger } = makeMocks();
    const service = new DiagnosePollingService(diagnoseService, eventBus, logger);

    service.start();

    expect(diagnoseService.diagnose).toHaveBeenCalledTimes(1);

    service.stop();
  });

  it('emits diagnose:result with correct payload after immediate poll', () => {
    const { diagnoseService, eventBus, logger } = makeMocks();
    const service = new DiagnosePollingService(diagnoseService, eventBus, logger);

    service.start();

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const [event, payload] = vi.mocked(eventBus.emit).mock.calls[0] as [string, { result: DiagnoseResult; timestamp: string }];
    expect(event).toBe('diagnose:result');
    expect(payload.result).toEqual(makeResult());
    expect(typeof payload.timestamp).toBe('string');

    service.stop();
  });

  it('calls diagnose() again after 30 seconds', () => {
    const { diagnoseService, eventBus, logger } = makeMocks();
    const service = new DiagnosePollingService(diagnoseService, eventBus, logger);

    service.start();
    expect(diagnoseService.diagnose).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(diagnoseService.diagnose).toHaveBeenCalledTimes(2);

    service.stop();
  });

  it('stop() prevents further polling after interval', () => {
    const { diagnoseService, eventBus, logger } = makeMocks();
    const service = new DiagnosePollingService(diagnoseService, eventBus, logger);

    service.start();
    expect(diagnoseService.diagnose).toHaveBeenCalledTimes(1);

    service.stop();

    vi.advanceTimersByTime(60_000);
    expect(diagnoseService.diagnose).toHaveBeenCalledTimes(1);
  });

  it('logs error and emits diagnose:result with error field when diagnose() throws', () => {
    const { diagnoseService, eventBus, logger } = makeMocks();
    const err = new Error('DB locked');
    vi.mocked(diagnoseService.diagnose).mockImplementation(() => { throw err; });

    const service = new DiagnosePollingService(diagnoseService, eventBus, logger);
    service.start();

    expect(logger.error).toHaveBeenCalledWith('Poll failed', { error: String(err) });
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const [event, payload] = vi.mocked(eventBus.emit).mock.calls[0] as [string, { result: DiagnoseResult; error?: string }];
    expect(event).toBe('diagnose:result');
    expect(payload.error).toBe(String(err));
    expect(payload.result.issues).toEqual([]);

    service.stop();
  });

  it('double start() does not create two intervals', () => {
    const { diagnoseService, eventBus, logger } = makeMocks();
    const service = new DiagnosePollingService(diagnoseService, eventBus, logger);

    service.start();
    service.start(); // second call — no-op

    expect(diagnoseService.diagnose).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    // Only one interval running — diagnose called once more (not twice more)
    expect(diagnoseService.diagnose).toHaveBeenCalledTimes(2);

    service.stop();
  });

  it('stop() when never started is a no-op (no throw)', () => {
    const { diagnoseService, eventBus, logger } = makeMocks();
    const service = new DiagnosePollingService(diagnoseService, eventBus, logger);

    expect(() => service.stop()).not.toThrow();
  });
});
