import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.')
  return db
}

export async function initDatabase(): Promise<void> {
  const dbPath = join(app.getPath('userData'), 'riskpilot.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)
  console.log('[DB] Database initialized at:', dbPath)

  // ── Cleanup: strip trailing dots/spaces from asset symbols ──
  try {
    const cleaned = db.prepare(`
      UPDATE assets SET symbol = TRIM(REPLACE(symbol, '.', ''), ' ')
      WHERE symbol LIKE '%.' OR symbol LIKE '% '
    `).run()
    if (cleaned.changes > 0) {
      console.log(`[DB] Cleaned ${cleaned.changes} asset symbol(s) with trailing dots/spaces`)
    }
  } catch (e: any) {
    console.error('[DB] Asset cleanup error:', e.message)
  }

  // Never auto-seed demo data. All data must come from real user actions or real APIs.
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
