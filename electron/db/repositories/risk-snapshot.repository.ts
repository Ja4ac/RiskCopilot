import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { RiskSnapshot } from '../../../shared/types/database'

export interface CreateSnapshotData {
  portfolio_id?: string
  risk_score: number
  volatility?: number | null
  max_drawdown?: number | null
  sharpe_ratio?: number | null
  beta?: number | null
  var_95?: number | null
  concentration_score?: number | null
  correlation_score?: number | null
  liquidity_score?: number | null
  sentiment_score?: number | null
  calculated_at?: string
}

export function create(data: CreateSnapshotData): RiskSnapshot {
  const db = getDb()
  const id = uuidv4()
  const calculatedAt = data.calculated_at ?? new Date().toISOString().replace('T', ' ').slice(0, 19)
  db.prepare(`
    INSERT INTO risk_snapshots (id, portfolio_id, risk_score, volatility, max_drawdown, sharpe_ratio, beta, var_95, concentration_score, correlation_score, liquidity_score, sentiment_score, calculated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.portfolio_id ?? 'default',
    data.risk_score,
    data.volatility ?? null,
    data.max_drawdown ?? null,
    data.sharpe_ratio ?? null,
    data.beta ?? null,
    data.var_95 ?? null,
    data.concentration_score ?? null,
    data.correlation_score ?? null,
    data.liquidity_score ?? null,
    data.sentiment_score ?? null,
    calculatedAt
  )
  return db.prepare('SELECT * FROM risk_snapshots WHERE id = ?').get(id) as RiskSnapshot
}

export function getLatest(): RiskSnapshot | undefined {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM risk_snapshots ORDER BY calculated_at DESC LIMIT 1'
  ).get() as RiskSnapshot | undefined
}

export function getHistory(limit: number): RiskSnapshot[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM risk_snapshots ORDER BY calculated_at DESC LIMIT ?'
  ).all(limit) as RiskSnapshot[]
}
