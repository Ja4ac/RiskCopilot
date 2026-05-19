// ============================================================
// AlertService — CRUD, lifecycle FSM, rule evaluation
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../db'
import type {
  Alert,
  AlertType,
  AlertStatus,
  AlertRule
} from '../../shared/types/database'
import type { IpcCreateAlertPayload } from '../../shared/types/ipc'

export class AlertService {
  /**
   * Get all alerts
   */
  getList(status?: AlertStatus): Alert[] {
    const db = getDb()

    if (status) {
      return db.prepare(
        'SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC'
      ).all(status) as Alert[]
    }

    return db.prepare(
      'SELECT * FROM alerts ORDER BY created_at DESC'
    ).all() as Alert[]
  }

  /**
   * Create a new alert rule
   */
  createRule(payload: IpcCreateAlertPayload): Alert {
    const db = getDb()
    const now = new Date().toISOString()
    const alertId = uuid()

    const alert: Alert = {
      id: alertId,
      alert_type: payload.alert_type as AlertType,
      target_type: payload.target_type,
      target_id: payload.target_id,
      rule_json: JSON.stringify(payload.rule_json),
      status: 'pending',
      triggered_at: null,
      acknowledged_at: null,
      resolved_at: null,
      created_at: now,
      updated_at: now
    }

    db.prepare(`
      INSERT INTO alerts (id, alert_type, target_type, target_id, rule_json, status, triggered_at, acknowledged_at, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      alert.id, alert.alert_type, alert.target_type, alert.target_id,
      alert.rule_json, alert.status, alert.triggered_at,
      alert.acknowledged_at, alert.resolved_at, alert.created_at, alert.updated_at
    )

    return alert
  }

  /**
   * Delete an alert rule
   */
  deleteRule(alertId: string): void {
    const db = getDb()
    const result = db.prepare('DELETE FROM alerts WHERE id = ?').run(alertId)
    if (result.changes === 0) {
      throw new Error(`未找到告警规则: ${alertId}`)
    }
  }

  /**
   * Acknowledge a triggered alert
   */
  acknowledge(alertId: string): Alert {
    const db = getDb()
    const now = new Date().toISOString()

    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId) as Alert | undefined
    if (!alert) throw new Error(`未找到告警: ${alertId}`)

    // FSM: pending → triggered → acknowledged → resolved → archived
    const validTransitions: Record<AlertStatus, AlertStatus[]> = {
      pending: ['triggered'],
      triggered: ['acknowledged'],
      acknowledged: ['resolved', 'archived'],
      resolved: ['archived'],
      archived: []
    }

    const allowed = validTransitions[alert.status] || []
    if (!allowed.includes('acknowledged')) {
      throw new Error(`无法从状态 "${alert.status}" 转为 "acknowledged"。当前状态只能转为: ${allowed.join(', ')}`)
    }

    db.prepare(`
      UPDATE alerts SET status = 'acknowledged', acknowledged_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, alertId)

    return { ...alert, status: 'acknowledged', acknowledged_at: now, updated_at: now }
  }

  /**
   * Resolve an acknowledged alert
   */
  resolve(alertId: string): Alert {
    const db = getDb()
    const now = new Date().toISOString()

    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId) as Alert | undefined
    if (!alert) throw new Error(`未找到告警: ${alertId}`)

    const validTransitions: Record<AlertStatus, AlertStatus[]> = {
      pending: ['triggered'],
      triggered: ['acknowledged'],
      acknowledged: ['resolved', 'archived'],
      resolved: ['archived'],
      archived: []
    }

    const allowed = validTransitions[alert.status] || []
    if (!allowed.includes('resolved')) {
      throw new Error(`无法从状态 "${alert.status}" 转为 "resolved"。当前状态只能转为: ${allowed.join(', ')}`)
    }

    db.prepare(`
      UPDATE alerts SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, alertId)

    return { ...alert, status: 'resolved', resolved_at: now, updated_at: now }
  }

  /**
   * Archive an alert
   */
  archive(alertId: string): Alert {
    const db = getDb()
    const now = new Date().toISOString()

    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId) as Alert | undefined
    if (!alert) throw new Error(`未找到告警: ${alertId}`)

    db.prepare(`
      UPDATE alerts SET status = 'archived', updated_at = ? WHERE id = ?
    `).run(now, alertId)

    return { ...alert, status: 'archived', updated_at: now }
  }

  /**
   * Evaluate all pending/triggered alerts
   * Returns list of alerts that changed state
   */
  evaluateAll(): Alert[] {
    const db = getDb()
    const now = new Date().toISOString()

    // Get all non-archived alerts
    const alerts = db.prepare(`
      SELECT * FROM alerts WHERE status IN ('pending', 'triggered')
    `).all() as Alert[]

    const changed: Alert[] = []

    for (const alert of alerts) {
      let rule: Record<string, unknown>
      try {
        rule = JSON.parse(alert.rule_json)
      } catch {
        continue
      }

      const condition = rule.condition as Record<string, unknown> | undefined
      if (!condition) continue

      const triggered = this.evaluateRule(alert, condition)

      if (triggered && alert.status === 'pending') {
        // Transition to triggered
        db.prepare(`
          UPDATE alerts SET status = 'triggered', triggered_at = ?, updated_at = ? WHERE id = ?
        `).run(now, now, alert.id)
        changed.push({ ...alert, status: 'triggered', triggered_at: now, updated_at: now })
      } else if (!triggered && alert.status === 'triggered') {
        // Auto-resolve if condition no longer met
        db.prepare(`
          UPDATE alerts SET status = 'pending', triggered_at = NULL, updated_at = ? WHERE id = ?
        `).run(now, alert.id)
        changed.push({ ...alert, status: 'pending', triggered_at: null, updated_at: now })
      }
    }

    return changed
  }

  /**
   * Evaluate a single alert rule against current market/portfolio data
   */
  private evaluateRule(alert: Alert, condition: Record<string, unknown>): boolean {
    const db = getDb()
    const threshold = (condition.threshold as number) ?? 0
    const operator = (condition.operator as string) || '>='

    switch (alert.alert_type) {
      case 'price_threshold': {
        // Check if price crossed threshold
        const quote = db.prepare(`
          SELECT price FROM market_quotes
          WHERE asset_id = ?
          ORDER BY quote_time DESC LIMIT 1
        `).get(alert.target_id) as { price: number } | undefined

        if (!quote) return false
        return this.compareValues(quote.price, threshold, operator)
      }

      case 'stop_loss': {
        // Get the latest quote for this specific asset
        const pos = db.prepare(`
          SELECT p.*, q.price AS current_price
          FROM positions p
          LEFT JOIN (
            SELECT mq.asset_id, mq.price FROM market_quotes mq
            WHERE mq.id = (
              SELECT mq2.id FROM market_quotes mq2
              WHERE mq2.asset_id = mq.asset_id
              ORDER BY mq2.quote_time DESC LIMIT 1
            )
          ) q ON p.asset_id = q.asset_id
          WHERE p.asset_id = ? AND p.quantity > 0
        `).get(alert.target_id) as any

        if (!pos || !pos.current_price) return false

        const lossPct = ((pos.current_price - pos.avg_cost) / pos.avg_cost) * 100
        // Stop loss triggers when loss exceeds negative threshold (e.g., -8%)
        return lossPct <= -Math.abs(threshold)
      }

      case 'stop_profit': {
        // Get the latest quote for this specific asset
        const pos = db.prepare(`
          SELECT p.*, q.price AS current_price
          FROM positions p
          LEFT JOIN (
            SELECT mq.asset_id, mq.price FROM market_quotes mq
            WHERE mq.id = (
              SELECT mq2.id FROM market_quotes mq2
              WHERE mq2.asset_id = mq.asset_id
              ORDER BY mq2.quote_time DESC LIMIT 1
            )
          ) q ON p.asset_id = q.asset_id
          WHERE p.asset_id = ? AND p.quantity > 0
        `).get(alert.target_id) as any

        if (!pos || !pos.current_price) return false

        const profitPct = ((pos.current_price - pos.avg_cost) / pos.avg_cost) * 100
        return profitPct >= threshold
      }

      case 'drawdown': {
        // Check portfolio-level drawdown
        const pos = db.prepare(`
          SELECT SUM(cost_amount) AS total_cost, SUM(market_value) AS total_value
          FROM positions WHERE quantity > 0
        `).get() as any

        if (!pos || !pos.total_cost || pos.total_cost <= 0) return false

        const drawdownPct = ((pos.total_cost - pos.total_value) / pos.total_cost) * 100
        return drawdownPct >= threshold
      }

      case 'concentration': {
        // Check if any single asset exceeds weight threshold
        const positions = db.prepare(`
          SELECT market_value FROM positions WHERE quantity > 0
        `).all() as { market_value: number }[]

        const totalValue = positions.reduce((sum, p) => sum + (p.market_value || 0), 0)
        if (totalValue <= 0) return false

        for (const p of positions) {
          const weight = (p.market_value / totalValue) * 100
          if (weight >= threshold) return true
        }
        return false
      }

      case 'var_breach': {
        // Simplified VaR check from latest risk snapshot
        const snapshot = db.prepare(`
          SELECT var_95 FROM risk_snapshots
          WHERE portfolio_id = 'default'
          ORDER BY calculated_at DESC LIMIT 1
        `).get() as { var_95: number } | undefined

        if (!snapshot) return false
        return Math.abs(snapshot.var_95) >= threshold
      }

      case 'news_keyword': {
        // Check for recent news containing keywords
        const keywords = (condition.keywords as string[]) || []
        if (keywords.length === 0) return false

        const kwConditions = keywords.map(() => '(n.title LIKE ? OR n.summary LIKE ?)').join(' OR ')
        const kwParams: string[] = []
        for (const kw of keywords) {
          kwParams.push(`%${kw}%`, `%${kw}%`)
        }

        const recentNews = db.prepare(`
          SELECT n.id FROM news_items n
          INNER JOIN news_asset_links nal ON nal.news_id = n.id
          WHERE nal.asset_id = ? AND (${kwConditions})
          AND n.published_at > datetime('now', '-24 hours')
          LIMIT 1
        `).get(alert.target_id, ...kwParams)

        return !!recentNews
      }

      default:
        return false
    }
  }

  /**
   * Compare two values with an operator
   */
  private compareValues(a: number, b: number, operator: string): boolean {
    switch (operator) {
      case '>': return a > b
      case '>=': return a >= b
      case '<': return a < b
      case '<=': return a <= b
      case '==': return a === b
      case '!=': return a !== b
      default: return a >= b
    }
  }
}
