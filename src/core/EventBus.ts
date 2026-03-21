import { Logger } from '@core/Logger.js';
import type { EventMap } from './EventTypes.js';

type Listener<T> = (payload: T) => void;

export class EventBus {
  private listeners: Map<string, Set<Listener<unknown>>> = new Map();
  private logger: ReturnType<typeof Logger.getLogger> | null = null;

  private getLog(): ReturnType<typeof Logger.getLogger> | null {
    if (this.logger === null) {
      try {
        this.logger = Logger.getLogger('EventBus');
      } catch {
        // Logger not yet initialized
      }
    }
    return this.logger;
  }

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    let set = this.listeners.get(event as string);
    if (!set) {
      set = new Set();
      this.listeners.set(event as string, set);
    }
    set.add(listener as Listener<unknown>);
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    const set = this.listeners.get(event as string);
    if (set) {
      set.delete(listener as Listener<unknown>);
    }
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event as string);
    if (!set) return;
    // Snapshot listeners so newly-added listeners during emit are not called
    const snapshot = [...set];
    for (const listener of snapshot) {
      try {
        listener(payload);
      } catch (err) {
        const log = this.getLog();
        if (log) {
          log.warn('emit: subscriber error caught', {
            event: String(event),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
}

export const eventBus = new EventBus();
export default eventBus;
