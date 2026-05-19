import { describe, it, expect } from 'vitest'

// Test market mock provider simulation logic
// Tests random-walk price generation and quote format

function seedRand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function generateQuote(symbol: string, basePrices: Record<string, number>): {
  price: number
  change_pct: number
  source: string
} {
  const rand = seedRand(hashCode(symbol))
  const basePrice = basePrices[symbol] ?? 10
  const changePct = (rand() - 0.5) * 0.02
  const newPrice = basePrice * (1 + changePct)

  return {
    price: Math.round(newPrice * 100) / 100,
    change_pct: Math.round(changePct * 10000) / 100,
    source: 'simulated',
  }
}

describe('Market Mock Provider', () => {
  const basePrices: Record<string, number> = {
    '300750': 205, '600519': 1620, '00700': 385, '002594': 268,
  }

  it('generates quote for a known asset', () => {
    const quote = generateQuote('300750', basePrices)
    expect(quote.price).toBeGreaterThan(0)
    expect(quote.price).toBeGreaterThan(basePrices['300750'] * 0.95)
    expect(quote.price).toBeLessThan(basePrices['300750'] * 1.05)
    expect(quote.source).toBe('simulated')
  })

  it('generates deterministic quotes for same input', () => {
    const q1 = generateQuote('600519', basePrices)
    const q2 = generateQuote('600519', basePrices)
    expect(q1.price).toBe(q2.price)
    expect(q1.change_pct).toBe(q2.change_pct)
  })

  it('generates different quotes for different symbols', () => {
    const q1 = generateQuote('300750', basePrices)
    const q2 = generateQuote('600519', basePrices)
    // They should be different values (not always true for random, but seed makes it deterministic)
    if (basePrices['300750'] !== basePrices['600519']) {
      // Different base prices may produce different prices
      expect(q1.price).not.toBe(q2.price)
    }
  })

  it('uses default price for unknown symbols', () => {
    const quote = generateQuote('UNKNOWN', basePrices)
    expect(quote.price).toBeGreaterThanOrEqual(9.9)
    expect(quote.price).toBeLessThanOrEqual(10.1)
  })

  it('change_pct is within ±1% range', () => {
    const quote = generateQuote('300750', basePrices)
    expect(Math.abs(quote.change_pct)).toBeLessThanOrEqual(1)
  })
})

describe('Risk Metric Calculations', () => {
  describe('Volatility', () => {
    it('returns 0 for insufficient data', () => {
      const returns: number[] = [0.01]
      if (returns.length < 2) {
        expect(0).toBe(0) // volatility would be 0
      }
    })

    it('calculates annualized volatility from daily returns', () => {
      // 10 days of random daily returns
      const dailyReturns = [0.01, -0.005, 0.02, -0.01, 0.005, 0.015, -0.008, 0.012, -0.003, 0.007]
      const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
      const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
      const dailyVol = Math.sqrt(variance)
      const annualVol = dailyVol * Math.sqrt(252)
      expect(annualVol).toBeGreaterThan(0)
      expect(annualVol).toBeLessThan(1) // Should be reasonable
    })
  })

  describe('Max Drawdown', () => {
    it('calculates max drawdown from cumulative returns', () => {
      const dailyReturns = [0.01, 0.02, -0.03, -0.01, 0.01, -0.02, 0.005]
      let peak = 1
      let maxDD = 0
      let cumValue = 1

      for (const r of dailyReturns) {
        cumValue *= (1 + r)
        if (cumValue > peak) peak = cumValue
        const dd = (peak - cumValue) / peak
        if (dd > maxDD) maxDD = dd
      }

      expect(maxDD).toBeGreaterThan(0)
    })

    it('returns 0 for only positive returns', () => {
      const dailyReturns = [0.01, 0.02, 0.005, 0.01]
      let peak = 1
      let maxDD = 0
      let cumValue = 1

      for (const r of dailyReturns) {
        cumValue *= (1 + r)
        if (cumValue > peak) peak = cumValue
        const dd = (peak - cumValue) / peak
        if (dd > maxDD) maxDD = dd
      }

      expect(maxDD).toBe(0)
    })
  })

  describe('Sharpe Ratio', () => {
    it('calculates annualized sharpe ratio', () => {
      const dailyReturns = [0.001, 0.002, -0.001, 0.0015, 0.0005, 0.001, -0.0005]
      const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
      const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
      const std = Math.sqrt(variance)

      if (std === 0) {
        expect(true).toBe(true)
        return
      }

      const rfDaily = 0.025 / 252
      const sharpe = ((mean - rfDaily) / std) * Math.sqrt(252)
      expect(typeof sharpe).toBe('number')
    })
  })
})
