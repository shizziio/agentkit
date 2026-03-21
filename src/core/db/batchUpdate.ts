import { inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type { DrizzleDB } from './Connection.js'
import { tasks } from './schema.js'
import type { NewTask } from './schema.js'
import * as schema from './schema.js'

const BATCH_SIZE = 999

// Type that works with both database connection and transactions
type DBOrTransaction = DrizzleDB | BetterSQLite3Database<typeof schema>

export function batchUpdate(tx: DBOrTransaction, ids: number[], values: Partial<NewTask>): void {
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE)
    tx.update(tasks).set(values).where(inArray(tasks.id, batch)).run()
  }
}
