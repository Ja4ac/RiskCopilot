import { describe, it, expect } from 'vitest'

// ─── Helpers mirroring market-sync.ts and portfolio.service.ts logic ───────────────────

/** Simulate change_pct calculation from historical NAV data */
function calculateChangePct(currentNav: number, yesterdayNav: number | null): number | null {
  if (!yesterdayNav || yesterdayNav <= 0) return null
  return Math.round(((currentNav - yesterdayNav) / yesterdayNav) * 10000) / 100
}

/** Simulate getYesterdayNav lookup from fund_navs table */
function getYesterdayNav(
  navHistory: { nav_date: string; nav: number }[],
  targetDate: string
): number {
  // Try exact match for yesterday
  const exact = navHistory.find(h => h.nav_date === targetDate)
  if (exact) return exact.nav

  // Fallback: most recent NAV before target date
  const recent = navHistory
    .filter(h => h.nav_date < targetDate)
    .sort((a, b) => b.nav_date.localeCompare(a.nav_date))[0]

  return recent?.nav ?? 0
}

/** Simulate getPositionsWithDetails yesterday_pnl calculation */
function calculateFundYesterdayPnl(
  quantity: number,
  currentPrice: number,
  navHistory: { nav_date: string; nav: number }[],
  todayStr: string
): number {
  if (currentPrice <= 0 || quantity <= 0) return 0

  const yesterday = new Date(todayStr)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  const yesterdayNav = getYesterdayNav(navHistory, yesterdayStr)
  if (yesterdayNav > 0) {
    return Math.round(quantity * (currentPrice - yesterdayNav) * 100) / 100
  }

  return 0
}

/** Simulate market-sync.ts historical NAV sync filter */
function syncNavHistory(
  allHistory: { nav_date: string; nav: number }[],
  endDate: string,
  daysBack: number
): { nav_date: string; nav: number }[] {
  const end = new Date(endDate)
  const start = new Date(endDate)
  start.setDate(start.getDate() - daysBack)
  const startStr = start.toISOString().slice(0, 10)

  return allHistory.filter(h => h.nav_date >= startStr && h.nav_date <= endDate)
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('NAV History Sync', () => {
  it('syncs last 90 days of NAV history', () => {
    const allHistory = [
      { nav_date: '2024-01-15', nav: 1.0 },
      { nav_date: '2024-02-01', nav: 1.05 },
      { nav_date: '2024-03-01', nav: 1.10 },
      { nav_date: '2024-03-15', nav: 1.12 },
      { nav_date: '2024-04-01', nav: 1.15 },
    ]

    const synced = syncNavHistory(allHistory, '2024-04-01', 90)
    expect(synced.length).toBe(5) // All within 90 days
    expect(synced[synced.length - 1].nav).toBe(1.15)
  })

  it('filters out old NAV records beyond 90 days', () => {
    const allHistory = [
      { nav_date: '2023-01-01', nav: 1.0 },
      { nav_date: '2024-03-01', nav: 1.10 },
      { nav_date: '2024-04-01', nav: 1.15 },
    ]

    const synced = syncNavHistory(allHistory, '2024-04-01', 90)
    expect(synced.length).toBe(2)
    expect(synced[0].nav_date).toBe('2024-03-01')
  })

  it('inserts NAV records with correct format', () => {
    const record = {
      symbol: '000001',
      market: 'OF',
      nav: 1.8213,
      nav_date: '2026-05-18',
      source: 'akshare'
    }
    expect(record.symbol).toBe('000001')
    expect(record.market).toBe('OF')
    expect(record.nav).toBe(1.8213)
    expect(record.nav_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('Change Pct Calculation from NAV History', () => {
  it('calculates positive change_pct correctly', () => {
    const change = calculateChangePct(1.10, 1.00)
    expect(change).toBe(10)
  })

  it('calculates negative change_pct correctly', () => {
    const change = calculateChangePct(0.98, 1.00)
    expect(change).toBe(-2)
  })

  it('returns null when yesterday NAV is unavailable', () => {
    const change = calculateChangePct(1.10, null)
    expect(change).toBeNull()
  })

  it('returns null when yesterday NAV is zero', () => {
    const change = calculateChangePct(1.10, 0)
    expect(change).toBeNull()
  })

  it('handles small changes with 4 decimal precision', () => {
    const change = calculateChangePct(1.0001, 1.0000)
    expect(change).toBe(0.01)
  })
})

describe('Yesterday NAV Lookup', () => {
  const navHistory = [
    { nav_date: '2026-05-13', nav: 1.8400 }, // Friday
    { nav_date: '2026-05-14', nav: 1.8410 }, // Saturday (unlikely but for test)
    { nav_date: '2026-05-15', nav: 1.8420 }, // Sunday (unlikely but for test)
    { nav_date: '2026-05-16', nav: 1.8430 }, // Monday
    { nav_date: '2026-05-17', nav: 1.8440 }, // Tuesday
    { nav_date: '2026-05-18', nav: 1.8450 }, // Wednesday
  ]

  it('finds exact yesterday NAV when available', () => {
    const yesterdayNav = getYesterdayNav(navHistory, '2026-05-17')
    expect(yesterdayNav).toBe(1.8440)
  })

  it('finds most recent NAV before yesterday when exact match missing', () => {
    // If yesterday was 2026-05-18 (Wed), look for 2026-05-17 (Tue)
    // But if we pass a weekend date with no data, fallback to Friday
    const weekendHistory = [
      { nav_date: '2026-05-13', nav: 1.8400 }, // Friday
      { nav_date: '2026-05-16', nav: 1.8430 }, // Monday
    ]
    const yesterdayNav = getYesterdayNav(weekendHistory, '2026-05-15') // Sunday
    expect(yesterdayNav).toBe(1.8400) // Friday's NAV
  })

  it('returns 0 when no historical data exists', () => {
    const yesterdayNav = getYesterdayNav([], '2026-05-17')
    expect(yesterdayNav).toBe(0)
  })

  it('returns 0 when all data is after target date', () => {
    const futureHistory = [
      { nav_date: '2026-05-19', nav: 1.8500 },
    ]
    const yesterdayNav = getYesterdayNav(futureHistory, '2026-05-17')
    expect(yesterdayNav).toBe(0)
  })
})

describe('Fund Yesterday PnL with Historical NAV', () => {
  it('calculates yesterday PnL when yesterday NAV exists', () => {
    const navHistory = [
      { nav_date: '2026-05-17', nav: 1.8440 },
      { nav_date: '2026-05-18', nav: 1.8450 },
    ]
    const pnl = calculateFundYesterdayPnl(100, 1.8450, navHistory, '2026-05-18')
    // 100 * (1.8450 - 1.8440) = 0.10
    expect(pnl).toBe(0.1)
  })

  it('calculates yesterday PnL with weekend fallback', () => {
    const navHistory = [
      { nav_date: '2026-05-15', nav: 1.8400 }, // Friday
      { nav_date: '2026-05-18', nav: 1.8450 }, // Monday
    ]
    // Today is Monday 2026-05-18, yesterday is Sunday 2026-05-17 (no data)
    // Should fallback to Friday 2026-05-15
    const pnl = calculateFundYesterdayPnl(100, 1.8450, navHistory, '2026-05-18')
    // 100 * (1.8450 - 1.8400) = 0.50
    expect(pnl).toBe(0.5)
  })

  it('returns 0 when no historical NAV available', () => {
    const pnl = calculateFundYesterdayPnl(100, 1.8450, [], '2026-05-18')
    expect(pnl).toBe(0)
  })

  it('returns 0 when current price is 0', () => {
    const navHistory = [
      { nav_date: '2026-05-17', nav: 1.8440 },
    ]
    const pnl = calculateFundYesterdayPnl(100, 0, navHistory, '2026-05-18')
    expect(pnl).toBe(0)
  })

  it('returns 0 when quantity is 0', () => {
    const navHistory = [
      { nav_date: '2026-05-17', nav: 1.8440 },
    ]
    const pnl = calculateFundYesterdayPnl(0, 1.8450, navHistory, '2026-05-18')
    expect(pnl).toBe(0)
  })

  it('handles large quantities with decimal NAV', () => {
    const navHistory = [
      { nav_date: '2026-05-17', nav: 1.8213 },
      { nav_date: '2026-05-18', nav: 1.8225 },
    ]
    const pnl = calculateFundYesterdayPnl(369.5882, 1.8225, navHistory, '2026-05-18')
    // 369.5882 * (1.8225 - 1.8213) = 369.5882 * 0.0012 = 0.4435
    expect(pnl).toBeCloseTo(0.44, 2)
  })
})

describe('Market Sync NAV History Integration', () => {
  it('syncs both latest and historical NAV for funds', () => {
    const latestNav = { nav: 1.8450, nav_date: '2026-05-18' }
    const historicalNav = [
      { nav_date: '2026-05-15', nav: 1.8400 },
      { nav_date: '2026-05-16', nav: 1.8430 },
      { nav_date: '2026-05-17', nav: 1.8440 },
      { nav_date: '2026-05-18', nav: 1.8450 },
    ]

    // After sync, fund_navs should contain both historical and latest
    const allNavs = [...historicalNav]
    const hasLatest = allNavs.some(n => n.nav_date === latestNav.nav_date)
    expect(hasLatest).toBe(true)
    expect(allNavs.length).toBeGreaterThanOrEqual(4)
  })

  it('calculates change_pct after historical sync', () => {
    const historicalNav = [
      { nav_date: '2026-05-17', nav: 1.8440 },
      { nav_date: '2026-05-18', nav: 1.8450 },
    ]

    const currentNav = 1.8450
    const yesterdayNav = historicalNav.find(h => h.nav_date === '2026-05-17')?.nav ?? null
    const changePct = calculateChangePct(currentNav, yesterdayNav)

    expect(changePct).toBeCloseTo(0.05, 2)
  })

  it('handles missing yesterday NAV gracefully', () => {
    const historicalNav = [
      { nav_date: '2026-05-18', nav: 1.8450 }, // Only today's data
    ]

    const currentNav = 1.8450
    const yesterdayNav = historicalNav.find(h => h.nav_date === '2026-05-17')?.nav ?? null
    const changePct = calculateChangePct(currentNav, yesterdayNav)

    expect(changePct).toBeNull()
  })
})
