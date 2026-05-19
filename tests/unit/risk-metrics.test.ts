import { describe, it, expect } from 'vitest'

// ─── Helpers mirroring risk.service.ts logic ────────────────────────

/** Simulate calcVolatility from daily returns */
function calcVolatility(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
  return Math.sqrt(variance * 252) // Annualized
}

/** Simulate calcMaxDrawdown from daily returns */
function calcMaxDrawdown(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0

  let peak = 1
  let maxDD = 0
  let cumValue = 1

  for (const r of dailyReturns) {
    cumValue *= (1 + r)
    if (cumValue > peak) peak = cumValue
    const dd = (peak - cumValue) / peak
    if (dd > maxDD) maxDD = dd
  }

  return maxDD
}

/** Simulate calcSharpeRatio from daily returns */
function calcSharpeRatio(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
  const std = Math.sqrt(variance)
  if (std === 0) return 0

  const rfDaily = 0.025 / 252
  return ((mean - rfDaily) / std) * Math.sqrt(252)
}

/** Simulate calcBeta from portfolio and benchmark returns */
function calcBeta(portfolioReturns: number[], benchmarkReturns: number[]): number {
  if (portfolioReturns.length < 2 || benchmarkReturns.length < 2) return 1.0

  const n = Math.min(portfolioReturns.length, benchmarkReturns.length)
  const portR = portfolioReturns.slice(portfolioReturns.length - n)
  const benchR = benchmarkReturns.slice(benchmarkReturns.length - n)

  const portMean = portR.reduce((a, b) => a + b, 0) / n
  const benchMean = benchR.reduce((a, b) => a + b, 0) / n
  const cov = portR.reduce((s, r, i) => s + (r - portMean) * (benchR[i] - benchMean), 0) / (n - 1)
  const benchVar = benchR.reduce((s, r) => s + (r - benchMean) ** 2, 0) / (n - 1)

  return benchVar > 0 ? cov / benchVar : 1.0
}

/** Simulate calcVaR95 from daily returns */
function calcVaR95(dailyReturns: number[], portfolioValue: number): number {
  if (dailyReturns.length < 5) return 0
  const sorted = [...dailyReturns].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length * 0.05)
  const varReturn = sorted[idx]
  return Math.abs(varReturn * portfolioValue)
}

/** Simulate getPortfolioDailyReturns with mixed stock/fund data */
function getPortfolioDailyReturns(
  stockData: Map<string, Map<string, number>>, // date -> assetId -> price
  fundData: Map<string, Map<string, number>>, // date -> assetId -> nav
  weights: Map<string, number>
): number[] {
  const allDates = new Set([...stockData.keys(), ...fundData.keys()])
  const sortedDates = Array.from(allDates).sort()

  if (sortedDates.length < 2) return []

  const dailyReturns: number[] = []

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = new Map([
      ...(stockData.get(sortedDates[i - 1]) ?? new Map()),
      ...(fundData.get(sortedDates[i - 1]) ?? new Map()),
    ])
    const curDate = new Map([
      ...(stockData.get(sortedDates[i]) ?? new Map()),
      ...(fundData.get(sortedDates[i]) ?? new Map()),
    ])

    let portfolioReturn = 0
    for (const [assetId, weight] of weights) {
      const prevPrice = prevDate.get(assetId)
      const curPrice = curDate.get(assetId)
      if (prevPrice && curPrice && prevPrice > 0) {
        const assetReturn = (curPrice - prevPrice) / prevPrice
        portfolioReturn += weight * assetReturn
      }
    }
    dailyReturns.push(portfolioReturn)
  }

  return dailyReturns
}

/** Simulate getAssetDailyReturns with kline/fund fallback */
function getAssetDailyReturns(
  klineBars: { close: number; bar_time: string }[],
  fundNavs: { nav: number; nav_date: string }[],
  assetType: string
): number[] {
  if (klineBars.length >= 2) {
    const returns: number[] = []
    for (let i = 1; i < klineBars.length; i++) {
      if (klineBars[i - 1].close > 0) {
        returns.push((klineBars[i].close - klineBars[i - 1].close) / klineBars[i - 1].close)
      }
    }
    return returns
  }

  if (assetType === 'fund' && fundNavs.length >= 2) {
    const returns: number[] = []
    for (let i = 1; i < fundNavs.length; i++) {
      if (fundNavs[i - 1].nav > 0) {
        returns.push((fundNavs[i].nav - fundNavs[i - 1].nav) / fundNavs[i - 1].nav)
      }
    }
    return returns
  }

  return []
}

/** Simulate pearsonCorrelation */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 3) return 0

  const xs = x.slice(x.length - n)
  const ys = y.slice(y.length - n)

  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n

  let cov = 0, varX = 0, varY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }

  if (varX === 0 || varY === 0) return 0
  return cov / Math.sqrt(varX * varY)
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Risk Metrics with Fund NAV Fallback', () => {
  it('calculates volatility from fund NAV returns', () => {
    const fundNavs = [
      { nav_date: '2024-01-01', nav: 1.0 },
      { nav_date: '2024-01-02', nav: 1.01 },
      { nav_date: '2024-01-03', nav: 0.99 },
      { nav_date: '2024-01-04', nav: 1.02 },
      { nav_date: '2024-01-05', nav: 1.03 },
    ]

    const returns = getAssetDailyReturns([], fundNavs, 'fund')
    expect(returns.length).toBe(4)

    const vol = calcVolatility(returns)
    expect(vol).toBeGreaterThan(0)
  })

  it('calculates max drawdown from fund NAV returns', () => {
    const fundNavs = [
      { nav_date: '2024-01-01', nav: 1.0 },
      { nav_date: '2024-01-02', nav: 1.05 },
      { nav_date: '2024-01-03', nav: 0.95 },
      { nav_date: '2024-01-04', nav: 1.02 },
    ]

    const returns = getAssetDailyReturns([], fundNavs, 'fund')
    const dd = calcMaxDrawdown(returns)
    expect(dd).toBeGreaterThan(0)
    // Peak at 1.05, trough at 0.95 → drawdown ~9.5%
    expect(dd).toBeCloseTo(0.095, 2)
  })

  it('calculates Sharpe ratio from fund NAV returns', () => {
    const fundNavs = [
      { nav_date: '2024-01-01', nav: 1.0 },
      { nav_date: '2024-01-02', nav: 1.01 },
      { nav_date: '2024-01-03', nav: 1.02 },
      { nav_date: '2024-01-04', nav: 1.03 },
      { nav_date: '2024-01-05', nav: 1.04 },
    ]

    const returns = getAssetDailyReturns([], fundNavs, 'fund')
    const sharpe = calcSharpeRatio(returns)
    expect(sharpe).toBeGreaterThan(0)
  })

  it('returns 0 volatility when insufficient fund NAV data', () => {
    const fundNavs = [
      { nav_date: '2024-01-01', nav: 1.0 },
    ]

    const returns = getAssetDailyReturns([], fundNavs, 'fund')
    expect(returns.length).toBe(0)

    const vol = calcVolatility(returns)
    expect(vol).toBe(0)
  })

  it('returns 0 max drawdown when insufficient fund NAV data', () => {
    const fundNavs = [
      { nav_date: '2024-01-01', nav: 1.0 },
    ]

    const returns = getAssetDailyReturns([], fundNavs, 'fund')
    const dd = calcMaxDrawdown(returns)
    expect(dd).toBe(0)
  })

  it('returns 1.0 beta when no benchmark data available', () => {
    const portfolioReturns = [0.01, -0.005, 0.008, 0.002]
    const benchmarkReturns: number[] = []

    const beta = calcBeta(portfolioReturns, benchmarkReturns)
    expect(beta).toBe(1.0)
  })

  it('returns 0 VaR when insufficient daily returns', () => {
    const returns = [0.01, 0.02]
    const portfolioValue = 10000

    const var95 = calcVaR95(returns, portfolioValue)
    expect(var95).toBe(0)
  })

  it('calculates VaR with sufficient daily returns', () => {
    const returns = [0.01, -0.02, 0.005, -0.01, 0.015, -0.005, 0.008]
    const portfolioValue = 10000

    const var95 = calcVaR95(returns, portfolioValue)
    expect(var95).toBeGreaterThan(0)
  })
})

describe('Portfolio Daily Returns with Mixed Assets', () => {
  it('combines stock kline and fund NAV data', () => {
    const stockData = new Map([
      ['2024-01-01', new Map([['stock-1', 100]])],
      ['2024-01-02', new Map([['stock-1', 102]])],
      ['2024-01-03', new Map([['stock-1', 101]])],
    ])

    const fundData = new Map([
      ['2024-01-01', new Map([['fund-1', 1.0]])],
      ['2024-01-02', new Map([['fund-1', 1.01]])],
      ['2024-01-03', new Map([['fund-1', 1.02]])],
    ])

    const weights = new Map([
      ['stock-1', 0.6],
      ['fund-1', 0.4],
    ])

    const returns = getPortfolioDailyReturns(stockData, fundData, weights)
    expect(returns.length).toBe(2)

    // Day 1-2: stock +2%, fund +1% → portfolio = 0.6*0.02 + 0.4*0.01 = 0.016
    expect(returns[0]).toBeCloseTo(0.016, 3)

    // Day 2-3: stock -0.98%, fund +0.99% → portfolio = 0.6*(-0.0098) + 0.4*0.0099 ≈ -0.0019
    expect(returns[1]).toBeCloseTo(-0.0019, 3)
  })

  it('handles fund-only portfolio', () => {
    const stockData = new Map<string, Map<string, number>>()

    const fundData = new Map([
      ['2024-01-01', new Map([['fund-1', 1.0]])],
      ['2024-01-02', new Map([['fund-1', 1.02]])],
      ['2024-01-03', new Map([['fund-1', 1.01]])],
    ])

    const weights = new Map([['fund-1', 1.0]])

    const returns = getPortfolioDailyReturns(stockData, fundData, weights)
    expect(returns.length).toBe(2)
    expect(returns[0]).toBeCloseTo(0.02, 3)
    expect(returns[1]).toBeCloseTo(-0.0098, 3)
  })

  it('handles stock-only portfolio', () => {
    const stockData = new Map([
      ['2024-01-01', new Map([['stock-1', 100]])],
      ['2024-01-02', new Map([['stock-1', 105]])],
    ])

    const fundData = new Map<string, Map<string, number>>()
    const weights = new Map([['stock-1', 1.0]])

    const returns = getPortfolioDailyReturns(stockData, fundData, weights)
    expect(returns.length).toBe(1)
    expect(returns[0]).toBeCloseTo(0.05, 3)
  })

  it('returns empty array when no data available', () => {
    const stockData = new Map<string, Map<string, number>>()
    const fundData = new Map<string, Map<string, number>>()
    const weights = new Map<string, number>()

    const returns = getPortfolioDailyReturns(stockData, fundData, weights)
    expect(returns.length).toBe(0)
  })
})

describe('Asset Daily Returns Fallback', () => {
  it('prefers kline bars over fund NAVs for stocks', () => {
    const klineBars = [
      { close: 100, bar_time: '2024-01-01' },
      { close: 102, bar_time: '2024-01-02' },
    ]
    const fundNavs = [
      { nav: 1.0, nav_date: '2024-01-01' },
      { nav: 1.1, nav_date: '2024-01-02' },
    ]

    const returns = getAssetDailyReturns(klineBars, fundNavs, 'stock')
    expect(returns.length).toBe(1)
    expect(returns[0]).toBeCloseTo(0.02, 3)
  })

  it('falls back to fund NAVs when no kline bars for funds', () => {
    const klineBars: { close: number; bar_time: string }[] = []
    const fundNavs = [
      { nav: 1.0, nav_date: '2024-01-01' },
      { nav: 1.05, nav_date: '2024-01-02' },
    ]

    const returns = getAssetDailyReturns(klineBars, fundNavs, 'fund')
    expect(returns.length).toBe(1)
    expect(returns[0]).toBeCloseTo(0.05, 3)
  })

  it('returns empty array for non-fund assets without kline bars', () => {
    const klineBars: { close: number; bar_time: string }[] = []
    const fundNavs: { nav: number; nav_date: string }[] = []

    const returns = getAssetDailyReturns(klineBars, fundNavs, 'stock')
    expect(returns.length).toBe(0)
  })

  it('returns empty array for funds without any NAV data', () => {
    const klineBars: { close: number; bar_time: string }[] = []
    const fundNavs: { nav: number; nav_date: string }[] = []

    const returns = getAssetDailyReturns(klineBars, fundNavs, 'fund')
    expect(returns.length).toBe(0)
  })
})

describe('Correlation with Fund NAV Data', () => {
  it('calculates correlation between two funds', () => {
    const fundANavs = [
      { nav: 1.0, nav_date: '2024-01-01' },
      { nav: 1.01, nav_date: '2024-01-02' },
      { nav: 1.02, nav_date: '2024-01-03' },
      { nav: 1.03, nav_date: '2024-01-04' },
      { nav: 1.04, nav_date: '2024-01-05' },
    ]

    const fundBNavs = [
      { nav: 2.0, nav_date: '2024-01-01' },
      { nav: 2.02, nav_date: '2024-01-02' },
      { nav: 2.01, nav_date: '2024-01-03' },
      { nav: 2.03, nav_date: '2024-01-04' },
      { nav: 2.04, nav_date: '2024-01-05' },
    ]

    const returnsA = getAssetDailyReturns([], fundANavs, 'fund')
    const returnsB = getAssetDailyReturns([], fundBNavs, 'fund')

    const corr = pearsonCorrelation(returnsA, returnsB)
    expect(corr).toBeGreaterThan(0)
    expect(Math.abs(corr)).toBeLessThanOrEqual(1)
  })

  it('returns 0 correlation with insufficient data', () => {
    const fundANavs = [
      { nav: 1.0, nav_date: '2024-01-01' },
      { nav: 1.01, nav_date: '2024-01-02' },
    ]

    const fundBNavs = [
      { nav: 2.0, nav_date: '2024-01-01' },
      { nav: 2.02, nav_date: '2024-01-02' },
    ]

    const returnsA = getAssetDailyReturns([], fundANavs, 'fund')
    const returnsB = getAssetDailyReturns([], fundBNavs, 'fund')

    const corr = pearsonCorrelation(returnsA, returnsB)
    expect(corr).toBe(0)
  })
})

describe('Beta Calculation with Fund Benchmark', () => {
  it('calculates beta with fund-based benchmark', () => {
    const portfolioReturns = [0.01, 0.02, -0.01, 0.005, 0.015]
    const benchmarkReturns = [0.008, 0.015, -0.008, 0.003, 0.012]

    const beta = calcBeta(portfolioReturns, benchmarkReturns)
    expect(beta).toBeGreaterThan(0)
    expect(beta).not.toBe(1.0) // Should differ from default
  })

  it('returns 1.0 when benchmark has zero variance', () => {
    const portfolioReturns = [0.01, 0.02, -0.01]
    const benchmarkReturns = [0.01, 0.01, 0.01]

    const beta = calcBeta(portfolioReturns, benchmarkReturns)
    expect(beta).toBe(1.0)
  })

  it('aligns different length return arrays', () => {
    const portfolioReturns = [0.01, 0.02, -0.01, 0.005]
    const benchmarkReturns = [0.008, 0.015, -0.008]

    const beta = calcBeta(portfolioReturns, benchmarkReturns)
    // Beta can be positive or negative depending on correlation; just verify it's computed
    expect(typeof beta).toBe('number')
    expect(Number.isFinite(beta)).toBe(true)
  })
})

describe('Risk Score Calculation', () => {
  it('calculates health score from component scores', () => {
    const volatilityScore = 80
    const drawdownScore = 90
    const concentrationScore = 70
    const correlationScore = 85
    const liquidityScore = 75
    const sentimentScore = 60
    const alertScore = 95

    const healthScore = Math.round(
      0.20 * volatilityScore +
      0.20 * drawdownScore +
      0.15 * concentrationScore +
      0.15 * correlationScore +
      0.10 * liquidityScore +
      0.10 * sentimentScore +
      0.10 * alertScore
    )

    expect(healthScore).toBeGreaterThan(0)
    expect(healthScore).toBeLessThanOrEqual(100)

    const riskScore = Math.max(0, Math.min(100, 100 - healthScore))
    expect(riskScore).toBeGreaterThanOrEqual(0)
    expect(riskScore).toBeLessThanOrEqual(100)
  })

  it('returns low risk for perfect health score', () => {
    const healthScore = 100
    const riskScore = 100 - healthScore
    expect(riskScore).toBe(0)
  })

  it('returns critical risk for zero health score', () => {
    const healthScore = 0
    const riskScore = 100 - healthScore
    expect(riskScore).toBe(100)
  })
})

describe('Concentration Score', () => {
  it('returns 100 for perfectly diversified portfolio', () => {
    const positions = [
      { market_value: 2500 },
      { market_value: 2500 },
      { market_value: 2500 },
      { market_value: 2500 },
    ]
    const totalValue = 10000
    const weights = positions.map(p => p.market_value / totalValue)
    const hhi = weights.reduce((s, w) => s + w * w, 0)
    const minHhi = 1 / positions.length
    const normalizedHhi = (hhi - minHhi) / (1 - minHhi)
    const score = Math.round((1 - normalizedHhi) * 100)

    expect(score).toBe(100)
  })

  it('returns 0 for single-asset portfolio', () => {
    const positions = [{ market_value: 10000 }]
    const totalValue = 10000
    const weights = positions.map(p => p.market_value / totalValue)
    const hhi = weights.reduce((s, w) => s + w * w, 0)

    expect(hhi).toBe(1)

    const minHhi = 1 / positions.length
    const normalizedHhi = positions.length > 1 ? (hhi - minHhi) / (1 - minHhi) : 1
    const score = Math.round((1 - normalizedHhi) * 100)

    expect(score).toBe(0)
  })
})
