import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from './tasks'

export async function ensureLocksTable(env: Env) {
  const database = db(env)
  await database.run(sql`
    CREATE TABLE IF NOT EXISTS _app_locks (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)
}

export function resetLocksTableInitializedForTests() {}

export async function withDbLock<T>(
  env: Env,
  name: string,
  fn: () => Promise<T>,
  options?: { timeoutMs?: number; ttlMs?: number },
): Promise<T> {
  await ensureLocksTable(env)
  const database = db(env)
  const timeoutMs = options?.timeoutMs ?? 5000
  const ttlMs = options?.ttlMs ?? 5000
  const owner = nanoid()
  const start = Date.now()
  let acquired = false

  while (Date.now() - start < timeoutMs) {
    const now = Date.now()
    const expiresAt = now + ttlMs

    // 1. Try to insert lock if not present
    const insert = await database.run(sql`
      INSERT OR IGNORE INTO _app_locks (name, owner, expires_at)
      VALUES (${name}, ${owner}, ${expiresAt})
    `)
    if (insert.meta.changes === 1) {
      acquired = true
      break
    }

    // 2. If present, check if expired and try CAS takeover
    const update = await database.run(sql`
      UPDATE _app_locks
      SET owner = ${owner}, expires_at = ${expiresAt}
      WHERE name = ${name} AND expires_at < ${now}
    `)
    if (update.meta.changes === 1) {
      acquired = true
      break
    }

    await new Promise((r) => setTimeout(r, 25))
  }

  if (!acquired) {
    throw new Error(`LOCK_TIMEOUT: 获取锁 [${name}] 超时`)
  }

  try {
    return await fn()
  } finally {
    // Release only if we still hold ownership
    await database.run(sql`
      DELETE FROM _app_locks
      WHERE name = ${name} AND owner = ${owner}
    `)
  }
}
