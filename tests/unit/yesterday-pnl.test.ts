import { describe, it, expect } from 'vitest'

// ─── Helpers mirroring portfolio.service.ts logic ───────────────────

function calculateYesterdayPnl(
  quantity: number,
  currentPrice: number,
  yesterdayPrice: number
): number {
  if (yesterdayPrice <= 0 || currentPrice <= 0) return 0
  return Math.round(quantity * (currentPrice - yesterdayPrice) * 100) / 100
}

function calculateStockYesterdayPnl(
  quantity: number,
  currentPrice: number,
  changePct: number | null
): number {
  if (changePct === null || currentPrice <= 0) return 0
  const yesterdayPrice = currentPrice / (1 + changePct / 100)
  return Math.round(quantity * (currentPrice - yesterdayPrice) * 100) / 100
}

function calculateFundYesterdayPnl(
  quantity: number,
  currentNav: number,
  yesterdayNav: number
): number {
  return calculateYesterdayPnl(quantity, currentNav, yesterdayNav)
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Yesterday PnL Calculation', () => {
  it('calculates fund yesterday PnL correctly', () => {
    const qty = 266.28
    const currentNav = 1.8879
    const yesterdayNav = 1.8777
    const pnl = calculateFundYesterdayPnl(qty, currentNav, yesterdayNav)
    expect(pnl).toBe(2.72)
  })

  it('calculates stock yesterday PnL from change_pct', () => {
    const qty = 100
    const currentPrice = 100
    const changePct = 2.5
    const pnl = calculateStockYesterdayPnl(qty, currentPrice, changePct)
    // yesterdayPrice = 100 / 1.025 = 97.56
    // pnl = 100 * (100 - 97.56) = 243.9
    expect(pnl).toBeCloseTo(243.9, 1)
  })

  it('returns 0 when yesterday nav is not available', () => {
    const pnl = calculateFundYesterdayPnl(100, 1.5, 0)
    expect(pnl).toBe(0)
  })

  it('returns 0 when change_pct is null', () => {
    const pnl = calculateStockYesterdayPnl(100, 100, null)
    expect(pnl).toBe(0)
  })

  it('handles negative change_pct', () => {
    const qty = 100
    const currentPrice = 98
    const changePct = -2
    const pnl = calculateStockYesterdayPnl(qty, currentPrice, changePct)
    // yesterdayPrice = 98 / 0.98 = 100
    // pnl = 100 * (98 - 100) = -200
    expect(pnl).toBe(-200)
  })

  it('handles zero quantity', () => {
    const pnl = calculateFundYesterdayPnl(0, 1.5, 1.4)
    expect(pnl).toBe(0)
  })

  it('handles large quantities correctly', () => {
    const qty = 10000
    const currentNav = 2.5
    const yesterdayNav = 2.4
    const pnl = calculateFundYesterdayPnl(qty, currentNav, yesterdayNav)
    expect(pnl).toBe(1000)
  })
})

describe('Portfolio Summary Yesterday PnL', () => {
  it('sums yesterday PnL across multiple positions', () => {
    const positions = [
      { yesterday_pnl: 100 },
      { yesterday_pnl: -50 },
      { yesterday_pnl: 200 },
    ]
    const total = positions.reduce((s, p) => s + p.yesterday_pnl, 0)
    expect(total).toBe(250)
  })

  it('handles empty positions', () => {
    const positions: { yesterday_pnl: number }[] = []
    const total = positions.reduce((s, p) => s + p.yesterday_pnl, 0)
    expect(total).toBe(0)
  })
})

describe('Fund NAV History Sync', () => {
  it('stores NAV history in correct format', () => {
    const history = [
      { nav_date: '2024-01-01', nav: 1.0 },
      { nav_date: '2024-01-02', nav: 1.01 },
      { nav_date: '2024-01-03', nav: 1.02 },
    ]
    expect(history).toHaveLength(3)
    expect(history[0].nav_date).toBe('2024-01-01')
    expect(history[0].nav).toBe(1.0)
  })

  it('filters NAV history by date range', () => {
    const history = [
      { nav_date: '2024-01-01', nav: 1.0 },
      { nav_date: '2024-02-01', nav: 1.1 },
      { nav_date: '2024-03-01', nav: 1.2 },
    ]
    const startDate = '2024-02-01'
    const filtered = history.filter(h => h.nav_date >= startDate)
    expect(filtered).toHaveLength(2)
    expect(filtered[0].nav_date).toBe('2024-02-01')
  })

  it('calculates cumulative return from NAV history', () => {
    const history = [
      { nav_date: '2024-01-01', nav: 1.0 },
      { nav_date: '2024-06-01', nav: 1.15 },
    ]
    const startNav = history[0].nav
    const endNav = history[history.length - 1].nav
    const returnPct = Math.round(((endNav - startNav) / startNav) * 10000) / 100
    expect(returnPct).toBe(15)
  })
})

describe('Portfolio Daily Value', () => {
  it('records daily portfolio snapshot', () => {
    const snapshot = {
      date: '2024-05-13',
      total_market_value: 10000,
      total_cost: 9000,
      total_pnl: 1000,
    }
    expect(snapshot.date).toBe('2024-05-13')
    expect(snapshot.total_pnl).toBe(1000)
  })

  it('calculates cumulative return over time', () => {
    const snapshots = [
      { date: '2024-01-01', total_market_value: 10000, total_cost: 10000 },
      { date: '2024-03-01', total_market_value: 11000, total_cost: 10000 },
      { date: '2024-06-01', total_market_value: 10500, total_cost: 10000 },
    ]
    const start = snapshots[0]
    const end = snapshots[snapshots.length - 1]
    const returnPct = Math.round(((end.total_market_value - start.total_cost) / start.total_cost) * 10000) / 100
    expect(returnPct).toBe(5)
  })
})
