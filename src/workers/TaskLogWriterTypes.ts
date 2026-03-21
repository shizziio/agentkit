export interface TaskLogEntry {
  taskId: number;
  sequence: number;
  eventType: string;
  eventData: string;
}
