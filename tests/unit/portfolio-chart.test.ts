import { describe, it, expect } from 'vitest'

// ─── Helpers mirroring portfolio.service.ts getPortfolioPerformance ───────────────────

interface PortfolioSnapshot {
  date: string
  total_market_value: number
  total_cost: number
}

interface NavRecord {
  nav_date: string
  symbol: string
  nav: number
  market: string
}

interface KlineRecord {
  bar_time: string
  asset_id: string
  close: number
}

/** Mock for generatePerformanceFromHistory: aggregates daily values from price history */
function generateFromHistory(
  currentPositions: { market_value: number; cost_amount: number }[],
  fundNavs: NavRecord[],
  klineBars: KlineRecord[],
  positions: { symbol: string; market: string; asset_id: string; quantity: number; cost_amount: number }[]
): { dates: string[]; values: number[]; cumulativeReturns: number[] } {
  const totalCost = positions.reduce((s, p) => s + p.cost_amount, 0)
  if (totalCost <= 0) return { dates: [], values: [], cumulativeReturns: [] }

  const dateValues = new Map<string, number>()

  // Aggregate fund NAVs
  for (const nav of fundNavs) {
    const pos = positions.find((p) => p.symbol === nav.symbol && p.market === nav.market)
    if (!pos) continue
    const val = pos.quantity * nav.nav
    dateValues.set(nav.nav_date, (dateValues.get(nav.nav_date) ?? 0) + val)
  }

  // Aggregate kline bars
  for (const bar of klineBars) {
    const pos = positions.find((p) => p.asset_id === bar.asset_id)
    if (!pos) continue
    const val = pos.quantity * bar.close
    dateValues.set(bar.bar_time, (dateValues.get(bar.bar_time) ?? 0) + val)
  }

  // Add today's value
  const today = new Date().toISOString().slice(0, 10)
  const todayVal = currentPositions.reduce((s, p) => s + p.market_value, 0)
  if (todayVal > 0) dateValues.set(today, todayVal)

  if (dateValues.size < 2) return { dates: [], values: [], cumulativeReturns: [] }

  const sortedDates = Array.from(dateValues.keys()).sort()
  const dates: string[] = []
  const values: number[] = []
  const cumulativeReturns: number[] = []

  for (const date of sortedDates) {
    const tv = dateValues.get(date)!
    const ret = totalCost > 0 ? Math.round(((tv - totalCost) / totalCost) * 10000) / 100 : 0
    dates.push(date)
    values.push(Math.round(tv * 100) / 100)
    cumulativeReturns.push(ret)
  }

  return { dates, values, cumulativeReturns }
}

function getPortfolioPerformance(
  rows: PortfolioSnapshot[],
  currentPositions: { market_value: number; cost_amount: number }[],
  fundNavs: NavRecord[] = [],
  klineBars: KlineRecord[] = [],
  positions: { symbol: string; market: string; asset_id: string; quantity: number; cost_amount: number }[] = []
): { dates: string[]; values: number[]; cumulativeReturns: number[] } {
  if (rows.length <= 1) {
    const totalCost = positions.reduce((s, p) => s + p.cost_amount, 0)
    if (totalCost > 0) {
      const result = generateFromHistory(currentPositions, fundNavs, klineBars, positions)
      if (result.dates.length > 0) return result
    }
    return { dates: [], values: [], cumulativeReturns: [] }
  }

  const firstCost = rows[0].total_cost || rows[0].total_market_value
  const dates = rows.map((r) => r.date)
  const values = rows.map((r) => r.total_market_value)
  const cumulativeReturns = rows.map((r) =>
    firstCost > 0 ? Math.round(((r.total_market_value - firstCost) / firstCost) * 10000) / 100 : 0
  )

  return { dates, values, cumulativeReturns }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Portfolio Chart Data Generation from Price History', () => {
  it('generates points from fund NAV history', () => {
    const result = getPortfolioPerformance(
      [],
      [{ market_value: 11000, cost_amount: 10000 }],
      [
        { nav_date: '2024-01-05', symbol: '025209', nav: 2.0, market: 'OF' },
        { nav_date: '2024-01-10', symbol: '025209', nav: 2.1, market: 'OF' },
        { nav_date: '2024-01-15', symbol: '025209', nav: 2.05, market: 'OF' },
      ],
      [],
      [{ symbol: '025209', market: 'OF', asset_id: 'a1', quantity: 5000, cost_amount: 10000 }]
    )
    expect(result.dates.length).toBeGreaterThanOrEqual(4) // 3 NAV dates + today
    expect(result.dates[0]).toBe('2024-01-05')
    expect(result.cumulativeReturns[0]).toBe(0) // 5000*2.0=10000, return 0%
  })

  it('last point return matches current P&L', () => {
    const result = getPortfolioPerformance(
      [],
      [{ market_value: 11000, cost_amount: 10000 }],
      [
        { nav_date: '2024-01-05', symbol: '025209', nav: 2.0, market: 'OF' },
      ],
      [],
      [{ symbol: '025209', market: 'OF', asset_id: 'a1', quantity: 5000, cost_amount: 10000 }]
    )
    const lastIdx = result.dates.length - 1
    // Last date = today, market_value=11000, cost=10000, return=10%
    expect(result.cumulativeReturns[lastIdx]).toBe(10)
  })

  it('includes today as final data point', () => {
    const result = getPortfolioPerformance(
      [],
      [{ market_value: 11000, cost_amount: 10000 }],
      [
        { nav_date: '2024-01-05', symbol: '025209', nav: 2.0, market: 'OF' },
      ],
      [],
      [{ symbol: '025209', market: 'OF', asset_id: 'a1', quantity: 5000, cost_amount: 10000 }]
    )
    const today = new Date().toISOString().slice(0, 10)
    expect(result.dates[result.dates.length - 1]).toBe(today)
  })

  it('generates points from kline bars for stocks', () => {
    const result = getPortfolioPerformance(
      [],
      [{ market_value: 11000, cost_amount: 10000 }],
      [],
      [
        { bar_time: '2024-01-05', asset_id: 'a1', close: 50 },
        { bar_time: '2024-01-10', asset_id: 'a1', close: 55 },
      ],
      [{ symbol: '300750', market: 'SZ', asset_id: 'a1', quantity: 200, cost_amount: 10000 }]
    )
    expect(result.dates.length).toBeGreaterThanOrEqual(3)
    expect(result.cumulativeReturns[1]).toBeGreaterThan(0) // positive return
  })

  it('combines multiple fund positions', () => {
    const result = getPortfolioPerformance(
      [],
      [{ market_value: 21000, cost_amount: 20000 }],
      [
        { nav_date: '2024-01-05', symbol: '025209', nav: 2.0, market: 'OF' },
        { nav_date: '2024-01-05', symbol: '018927', nav: 1.5, market: 'OF' },
      ],
      [],
      [
        { symbol: '025209', market: 'OF', asset_id: 'a1', quantity: 5000, cost_amount: 10000 },
        { symbol: '018927', market: 'OF', asset_id: 'a2', quantity: 6666, cost_amount: 10000 },
      ]
    )
    // 5000*2.0 + 6666*1.5 = 10000 + 9999 = ~19999, cost=20000, return≈0%
    expect(result.cumulativeReturns[0]).toBeCloseTo(0, 0)
  })

  it('returns empty arrays when no cost', () => {
    const result = getPortfolioPerformance(
      [],
      [{ market_value: 10000, cost_amount: 0 }],
      [],
      [],
      []
    )
    expect(result.dates).toHaveLength(0)
  })

  it('returns empty arrays when less than 2 date points', () => {
    const result = getPortfolioPerformance(
      [],
      [{ market_value: 10000, cost_amount: 10000 }],
      [], [], []
    )
    expect(result.dates).toHaveLength(0)
  })

  it('handles negative returns correctly', () => {
    const result = getPortfolioPerformance(
      [],
      [{ market_value: 9000, cost_amount: 10000 }],
      [
        { nav_date: '2024-01-05', symbol: '025209', nav: 2.0, market: 'OF' },
        { nav_date: '2024-01-10', symbol: '025209', nav: 1.8, market: 'OF' },
      ],
      [],
      [{ symbol: '025209', market: 'OF', asset_id: 'a1', quantity: 5000, cost_amount: 10000 }]
    )
    // 5000*1.8=9000, return=(9000-10000)/10000=-10%
    expect(result.cumulativeReturns[1]).toBe(-10)
  })
})

describe('Portfolio Chart Historical Data from DB', () => {
  it('uses portfolio_daily_value when available', () => {
    const rows: PortfolioSnapshot[] = [
      { date: '2024-01-01', total_market_value: 10000, total_cost: 10000 },
      { date: '2024-01-02', total_market_value: 10200, total_cost: 10000 },
      { date: '2024-01-03', total_market_value: 10100, total_cost: 10000 },
    ]
    const result = getPortfolioPerformance(rows, [])
    expect(result.dates).toHaveLength(3)
    expect(result.cumulativeReturns[0]).toBe(0)
    expect(result.cumulativeReturns[1]).toBe(2)
    expect(result.cumulativeReturns[2]).toBe(1)
  })

  it('handles negative returns in DB data', () => {
    const rows: PortfolioSnapshot[] = [
      { date: '2024-01-01', total_market_value: 10000, total_cost: 10000 },
      { date: '2024-01-02', total_market_value: 9500, total_cost: 10000 },
    ]
    const result = getPortfolioPerformance(rows, [])
    expect(result.cumulativeReturns[1]).toBe(-5)
  })
})

describe('Portfolio Chart ECharts Compatibility', () => {
  it('all cumulative returns are finite numbers', () => {
    const rows: PortfolioSnapshot[] = [
      { date: '2024-01-01', total_market_value: 10000, total_cost: 10000 },
      { date: '2024-01-02', total_market_value: 10200, total_cost: 10000 },
    ]
    const result = getPortfolioPerformance(rows, [])
    for (const ret of result.cumulativeReturns) {
      expect(Number.isFinite(ret)).toBe(true)
    }
  })
})
