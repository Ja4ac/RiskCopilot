import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { Alert, AlertStatus, AlertType } from '../../../shared/types/database'

export function getAll(status?: AlertStatus): Alert[] {
  const db = getDb()
  if (status) {
    return db.prepare(
      'SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC'
    ).all(status) as Alert[]
  }
  return db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all() as Alert[]
}

export function getById(id: string): Alert | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Alert | undefined
}

export interface CreateAlertData {
  alert_type: AlertType
  target_type?: string
  target_id: string
  rule_json: string
  status?: AlertStatus
}

export function create(data: CreateAlertData): Alert {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  db.prepare(`
    INSERT INTO alerts (id, alert_type, target_type, target_id, rule_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.alert_type,
    data.target_type ?? 'asset',
    data.target_id,
    data.rule_json,
    data.status ?? 'pending',
    now,
    now
  )
  return getById(id)!
}

export function updateStatus(id: string, status: AlertStatus): Alert | undefined {
  const db = getDb()
  const existing = getById(id)
  if (!existing) return undefined

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const updates: string[] = ['status = ?', "updated_at = datetime('now','localtime')"]
  const params: (string | null)[] = [status]

  if (status === 'triggered' && !existing.triggered_at) {
    updates.push('triggered_at = ?')
    params.push(now)
  }
  if (status === 'acknowledged' && !existing.acknowledged_at) {
    updates.push('acknowledged_at = ?')
    params.push(now)
  }
  if ((status === 'resolved' || status === 'archived') && !existing.resolved_at) {
    updates.push('resolved_at = ?')
    params.push(now)
  }

  params.push(id)
  db.prepare(`UPDATE alerts SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return getById(id)
}

export function deleteRule(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM alerts WHERE id = ?').run(id)
  return result.changes > 0
}

/** Alias for deleteRule — matches the spec method name */
export const deleteAlert = deleteRule
