export class AgentKitError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'AgentKitError';
  }
}

export class ConfigError extends AgentKitError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class ParserError extends AgentKitError {
  public line?: number;

  constructor(message: string, line?: number) {
    const formattedMessage = line !== undefined ? `Line ${line}: ${message}` : message;
    super(formattedMessage, 'PARSER_ERROR');
    this.name = 'ParserError';
    this.line = line;
  }
}

export class ProviderError extends AgentKitError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
  }
}

export class QueueError extends AgentKitError {
  constructor(message: string) {
    super(message, 'QUEUE_ERROR');
    this.name = 'QueueError';
  }
}

export class LoadError extends AgentKitError {
  constructor(message: string) {
    super(message, 'LOAD_ERROR');
    this.name = 'LoadError';
  }
}

export class LogsError extends AgentKitError {
  constructor(message: string) {
    super(message, 'LOGS_ERROR');
    this.name = 'LogsError';
  }
}

export class InspectError extends AgentKitError {
  constructor(message: string) {
    super(message, 'INSPECT_ERROR');
    this.name = 'InspectError';
  }
}

export class TraceError extends AgentKitError {
  constructor(message: string) {
    super(message, 'TRACE_ERROR');
    this.name = 'TraceError';
  }
}

export class LoggerError extends AgentKitError {
  constructor(message: string) {
    super(message, 'LOGGER_ERROR');
    this.name = 'LoggerError';
  }
}

export class ResetError extends AgentKitError {
  constructor(message: string) {
    super(message, 'RESET_ERROR');
    this.name = 'ResetError';
  }
}

export class MarkDoneError extends AgentKitError {
  constructor(
    message: string,
    public undoneStoryKeys?: string[],
  ) {
    super(message, 'MARK_DONE_ERROR');
    this.name = 'MarkDoneError';
  }
}

export class TeamSwitchError extends AgentKitError {
  constructor(message: string) {
    super(message, 'TEAM_SWITCH_ERROR');
    this.name = 'TeamSwitchError';
  }
}

export class DependencyResolverError extends AgentKitError {
  constructor(message: string) {
    super(message, 'DEPENDENCY_RESOLVER_ERROR');
    this.name = 'DependencyResolverError';
  }
}
