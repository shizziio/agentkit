import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';

import { createConnection } from '@core/db/Connection';

describe('Connection', () => {
  describe('createConnection with in-memory database', () => {
    it('should return a usable Drizzle instance', () => {
      const db = createConnection(':memory:');
      expect(db).toBeDefined();
      // safe: $client is always a better-sqlite3 Database instance when using the better-sqlite3 driver
      const sqlite = db.$client as Database.Database;
      // safe: query always returns a row with a numeric result column
      const row = sqlite.prepare('SELECT 1 + 1 as result').get() as { result: number };
      expect(row.result).toBe(2);
    });

    it('should set foreign_keys pragma to ON', () => {
      const db = createConnection(':memory:');
      // safe: $client is always a better-sqlite3 Database instance when using the better-sqlite3 driver
      const sqlite = db.$client as Database.Database;
      // safe: pragma() returns an array of objects with the pragma name as key
      const [row] = sqlite.pragma('foreign_keys') as { foreign_keys: number }[];
      expect(row!.foreign_keys).toBe(1);
    });

    it('should set busy_timeout to 5000', () => {
      const db = createConnection(':memory:');
      // safe: $client is always a better-sqlite3 Database instance when using the better-sqlite3 driver
      const sqlite = db.$client as Database.Database;
      // safe: pragma() returns an array of objects with the pragma name as key
      const [row] = sqlite.pragma('busy_timeout') as { timeout: number }[];
      expect(row!.timeout).toBe(5000);
    });
  });

  describe('createConnection with file-based database', () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-test-'));
      dbPath = path.join(tmpDir, 'test.sqlite');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should create a .sqlite file on disk', () => {
      createConnection(dbPath);
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('should enable WAL journal mode for file database', () => {
      const db = createConnection(dbPath);
      // safe: $client is always a better-sqlite3 Database instance when using the better-sqlite3 driver
      const sqlite = db.$client as Database.Database;
      // safe: pragma() returns an array of objects with the pragma name as key
      const [row] = sqlite.pragma('journal_mode') as { journal_mode: string }[];
      expect(row!.journal_mode).toBe('wal');
    });
  });
});
