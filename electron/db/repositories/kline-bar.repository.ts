import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { KlineBar, KlinePeriod } from '../../../shared/types/database'

export function getByAsset(
  assetId: string,
  period: KlinePeriod,
  from?: string,
  to?: string
): KlineBar[] {
  const db = getDb()
  let sql = 'SELECT * FROM kline_bars WHERE asset_id = ? AND period = ?'
  const params: (string | number)[] = [assetId, period]

  if (from) {
    sql += ' AND bar_time >= ?'
    params.push(from)
  }
  if (to) {
    sql += ' AND bar_time <= ?'
    params.push(to)
  }
  sql += ' ORDER BY bar_time'

  return db.prepare(sql).all(...params) as KlineBar[]
}

export interface CreateBarData {
  asset_id: string
  period?: KlinePeriod
  open: number
  high: number
  low: number
  close: number
  volume?: number | null
  bar_time: string
  source?: string
}

export function create(data: CreateBarData): KlineBar {
  const db = getDb()
  const id = uuidv4()
  db.prepare(`
    INSERT INTO kline_bars (id, asset_id, period, open, high, low, close, volume, bar_time, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.asset_id,
    data.period ?? '1d',
    data.open,
    data.high,
    data.low,
    data.close,
    data.volume ?? null,
    data.bar_time,
    data.source ?? 'simulated'
  )
  return db.prepare('SELECT * FROM kline_bars WHERE id = ?').get(id) as KlineBar
}

export function createMany(bars: CreateBarData[]): number {
  const db = getDb()
  const insert = db.prepare(`
    INSERT INTO kline_bars (id, asset_id, period, open, high, low, close, volume, bar_time, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction((items: CreateBarData[]) => {
    let count = 0
    for (const item of items) {
      insert.run(
        uuidv4(),
        item.asset_id,
        item.period ?? '1d',
        item.open,
        item.high,
        item.low,
        item.close,
        item.volume ?? null,
        item.bar_time,
        item.source ?? 'simulated'
      )
      count++
    }
    return count
  })

  return insertMany(bars)
}

export function getDateRange(
  assetId: string,
  period: KlinePeriod,
  from: string,
  to: string
): KlineBar[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM kline_bars WHERE asset_id = ? AND period = ? AND bar_time >= ? AND bar_time <= ? ORDER BY bar_time'
  ).all(assetId, period, from, to) as KlineBar[]
}
