import type { EventBus } from '@core/EventBus.js';
import type { EventMap } from '@core/EventTypes.js';

type Listener<T> = (payload: T) => void;

export interface EventBinding<K extends keyof EventMap = keyof EventMap> {
  event: K;
  handler: Listener<EventMap[K]>;
}

/**
 * Connects EventBus events to store updater functions.
 * Subscribes each binding's handler and returns a cleanup function
 * that unsubscribes all handlers using the exact same references.
 */
export function bridgeEvents(
  eventBus: EventBus,
  bindings: ReadonlyArray<EventBinding>,
): () => void {
  for (const binding of bindings) {
    eventBus.on(binding.event, binding.handler as Listener<EventMap[typeof binding.event]>);
  }

  return (): void => {
    for (const binding of bindings) {
      eventBus.off(binding.event, binding.handler as Listener<EventMap[typeof binding.event]>);
    }
  };
}
