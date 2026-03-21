import { describe, it, expect } from 'vitest';
import {
  AgentKitError,
  ConfigError,
  ParserError,
  ProviderError,
  QueueError,
} from '@core/Errors';

describe('AgentKitError', () => {
  it('should create error with message and code', () => {
    const error = new AgentKitError('test message', 'TEST_CODE');
    expect(error.message).toBe('test message');
    expect(error.code).toBe('TEST_CODE');
    expect(error.name).toBe('AgentKitError');
    expect(error).toBeInstanceOf(Error);
  });

  it('should have stack trace', () => {
    const error = new AgentKitError('test', 'TEST');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('AgentKitError');
  });

  it('should support error chaining with different codes', () => {
    const error1 = new AgentKitError('first error', 'CODE_1');
    const error2 = new AgentKitError('second error', 'CODE_2');
    expect(error1.code).not.toBe(error2.code);
    expect(error1.message).not.toBe(error2.message);
  });

  it('should be throwable and catchable', () => {
    const error = new AgentKitError('catch me', 'CATCH_ME');
    expect(() => {
      throw error;
    }).toThrow(AgentKitError);
  });

  it('should preserve error message on toString', () => {
    const error = new AgentKitError('test message', 'TEST_CODE');
    const str = error.toString();
    expect(str).toContain('test message');
  });
});

describe('ConfigError', () => {
  it('should create error with CONFIG_ERROR code', () => {
    const error = new ConfigError('bad config');
    expect(error.message).toBe('bad config');
    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.name).toBe('ConfigError');
    expect(error).toBeInstanceOf(AgentKitError);
  });

  it('should have correct inheritance chain', () => {
    const error = new ConfigError('test');
    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toBeInstanceOf(AgentKitError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should be catchable as AgentKitError', () => {
    expect(() => {
      throw new ConfigError('config issue');
    }).toThrow(AgentKitError);
  });

  it('should have code property accessible', () => {
    const error = new ConfigError('missing field');
    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.code).toBeDefined();
  });
});

describe('ParserError', () => {
  it('should create error with PARSER_ERROR code', () => {
    const error = new ParserError('parse failed');
    expect(error.message).toBe('parse failed');
    expect(error.code).toBe('PARSER_ERROR');
    expect(error.name).toBe('ParserError');
    expect(error).toBeInstanceOf(AgentKitError);
  });

  it('should distinguish from other error types', () => {
    const parserErr = new ParserError('parse');
    const configErr = new ConfigError('config');
    expect(parserErr.code).not.toBe(configErr.code);
    expect(parserErr.name).not.toBe(configErr.name);
  });

  it('should be catchable as AgentKitError and ParserError', () => {
    expect(() => {
      throw new ParserError('invalid syntax');
    }).toThrow(ParserError);
    expect(() => {
      throw new ParserError('invalid syntax');
    }).toThrow(AgentKitError);
  });

  it('should have undefined line when no line number provided', () => {
    const error = new ParserError('no line info');
    expect(error.line).toBeUndefined();
    expect(error.message).toBe('no line info');
  });

  it('should set line property and prepend line number to message', () => {
    const error = new ParserError('bad heading', 42);
    expect(error.line).toBe(42);
    expect(error.message).toBe('Line 42: bad heading');
  });
});

describe('ProviderError', () => {
  it('should create error with PROVIDER_ERROR code', () => {
    const error = new ProviderError('provider down');
    expect(error.message).toBe('provider down');
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.name).toBe('ProviderError');
    expect(error).toBeInstanceOf(AgentKitError);
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw new ProviderError('connection timeout');
    }).toThrow(ProviderError);
  });

  it('should contain meaningful error code', () => {
    const error = new ProviderError('API error');
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.code).toBeDefined();
  });
});

describe('QueueError', () => {
  it('should create error with QUEUE_ERROR code', () => {
    const error = new QueueError('queue full');
    expect(error.message).toBe('queue full');
    expect(error.code).toBe('QUEUE_ERROR');
    expect(error.name).toBe('QueueError');
    expect(error).toBeInstanceOf(AgentKitError);
  });

  it('should be distinguishable by code', () => {
    const error = new QueueError('full');
    expect(error.code).toBe('QUEUE_ERROR');
    const configError = new ConfigError('bad');
    expect(error.code).not.toBe(configError.code);
  });

  it('should support re-throwing and catching', () => {
    try {
      throw new QueueError('queue overflow');
    } catch (e) {
      expect(e).toBeInstanceOf(QueueError);
      expect((e as QueueError).code).toBe('QUEUE_ERROR');
    }
  });
});

describe('Error type discrimination', () => {
  it('should allow type guards based on code property', () => {
    const errors = [
      new ConfigError('config'),
      new ParserError('parse'),
      new ProviderError('provider'),
      new QueueError('queue'),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(AgentKitError);
      expect(error.code).toBeDefined();
      expect(['CONFIG_ERROR', 'PARSER_ERROR', 'PROVIDER_ERROR', 'QUEUE_ERROR']).toContain(
        error.code,
      );
    }
  });

  it('should maintain error identity through error handling flow', () => {
    const originalError = new ProviderError('API failure');
    try {
      throw originalError;
    } catch (e) {
      const caught = e as ProviderError;
      expect(caught.code).toBe(originalError.code);
      expect(caught.message).toBe(originalError.message);
      expect(caught.name).toBe(originalError.name);
    }
  });
});
