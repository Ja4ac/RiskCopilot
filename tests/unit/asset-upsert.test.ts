import { describe, it, expect } from 'vitest'
import { guessMarket, guessAssetType } from '../../electron/utils/market-detection'

describe('Market Detection', () => {
  it('detects Shanghai stocks (60xxxx)', () => {
    expect(guessMarket('600519')).toBe('SH')
    expect(guessMarket('601318')).toBe('SH')
  })

  it('detects Shanghai STAR market (688xxx)', () => {
    expect(guessMarket('688111')).toBe('SH')
  })

  it('detects Shenzhen stocks (00xxxx, 30xxxx)', () => {
    expect(guessMarket('000001')).toBe('SZ')
    expect(guessMarket('300750')).toBe('SZ')
  })

  it('detects Hong Kong stocks (5-digit)', () => {
    expect(guessMarket('00700')).toBe('HK')
    expect(guessMarket('09988')).toBe('HK')
  })

  it('detects US stocks (alpha tickers)', () => {
    expect(guessMarket('AAPL')).toBe('US')
    expect(guessMarket('TSLA')).toBe('US')
  })

  it('uses hint when provided', () => {
    expect(guessMarket('600519', 'SH')).toBe('SH')
    expect(guessMarket('AAPL', 'US')).toBe('US')
  })

  it('respects hint even for ambiguous codes', () => {
    expect(guessMarket('00001', 'HK')).toBe('HK')
  })
})

describe('Asset Type Detection', () => {
  it('detects ETF by prefix', () => {
    expect(guessAssetType('510300')).toBe('etf')
    expect(guessAssetType('513180')).toBe('etf')
  })

  it('detects fund by 00xxxx pattern', () => {
    expect(guessAssetType('005827')).toBe('fund')
    expect(guessAssetType('003095')).toBe('fund')
  })

  it('detects regular stock', () => {
    expect(guessAssetType('300750')).toBe('stock')
    expect(guessAssetType('600519')).toBe('stock')
    expect(guessAssetType('00700')).toBe('stock')
  })
})

describe('Portfolio Cost Calculation', () => {
  it('calculates simple buy cost', () => {
    const trades = [
      { side: 'buy', quantity: 100, price: 50, fee: 5, tax: 0 },
    ]
    let quantity = 0
    let costAmount = 0

    for (const t of trades) {
      const tradeCost = t.quantity * t.price + t.fee + t.tax
      if (t.side === 'buy') {
        quantity += t.quantity
        costAmount += tradeCost
      }
    }

    expect(quantity).toBe(100)
    expect(costAmount).toBe(5005)
  })

  it('calculates average cost from multiple buys', () => {
    const trades = [
      { side: 'buy' as const, quantity: 100, price: 50, fee: 5, tax: 0 },
      { side: 'buy' as const, quantity: 100, price: 60, fee: 5, tax: 0 },
    ]
    let quantity = 0
    let costAmount = 0

    for (const t of trades) {
      const tradeCost = t.quantity * t.price + t.fee + t.tax
      if (t.side === 'buy') {
        quantity += t.quantity
        costAmount += tradeCost
      }
    }

    const avgCost = costAmount / quantity
    expect(quantity).toBe(200)
    expect(costAmount).toBe(11010)
    expect(avgCost).toBe(55.05)
  })

  it('reduces cost proportionally on sell', () => {
    const trades = [
      { side: 'buy' as const, quantity: 100, price: 50, fee: 5, tax: 0 },
      { side: 'sell' as const, quantity: 50, price: 55, fee: 5, tax: 10 },
    ]
    let quantity = 0
    let costAmount = 0

    for (const t of trades) {
      if (t.side === 'buy') {
        quantity += t.quantity
        costAmount += t.quantity * t.price + t.fee + t.tax
      } else {
        if (quantity > 0) {
          const avgCost = costAmount / quantity
          quantity -= t.quantity
          costAmount -= t.quantity * avgCost
        }
        if (quantity < 0) quantity = 0
        if (costAmount < 0) costAmount = 0
      }
    }

    expect(quantity).toBe(50)
    expect(costAmount).toBe(2502.5)
  })

  it('handles full sell position', () => {
    const trades = [
      { side: 'buy' as const, quantity: 100, price: 50, fee: 5, tax: 0 },
      { side: 'sell' as const, quantity: 100, price: 55, fee: 5, tax: 10 },
    ]
    let quantity = 0
    let costAmount = 0

    for (const t of trades) {
      if (t.side === 'buy') {
        quantity += t.quantity
        costAmount += t.quantity * t.price + t.fee + t.tax
      } else {
        if (quantity > 0) {
          const avgCost = costAmount / quantity
          quantity -= t.quantity
          costAmount -= t.quantity * avgCost
        }
      }
    }

    expect(quantity).toBe(0)
    expect(costAmount).toBe(0)
  })
})
