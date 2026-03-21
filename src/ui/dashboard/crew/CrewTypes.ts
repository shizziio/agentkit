export type RobotState = 'idle' | 'queued' | 'running' | 'done' | 'error';

export interface RobotEntry {
  name: string;              // stage name (sm, dev, review, tester)
  displayName: string;       // display label
  state: RobotState;
  blinkPhase: boolean;       // toggle for running animation
}

export interface CrewState {
  orchestrator: RobotEntry;
  workers: RobotEntry[];
  healthStatus: 'healthy' | 'issues' | 'critical';
}
