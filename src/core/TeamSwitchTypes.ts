export interface PipelineRef {
  isRunning(): boolean;
}

export interface ITeamSwitchService {
  switchTeam(toTeam: string, pipeline?: PipelineRef): Promise<void>;
}
