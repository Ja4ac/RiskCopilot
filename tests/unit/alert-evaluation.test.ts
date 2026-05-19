import { describe, it, expect } from 'vitest'

// Test alert rule evaluation logic (replicated from AlertService.evaluateRule)

interface AlertRule {
  alert_type: string
  target_id: string
  rule_json: string
}

function compareValues(a: number, b: number, operator: string): boolean {
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

describe('Alert Rule Evaluation', () => {
  describe('Price Threshold', () => {
    it('triggers when price crosses above threshold', () => {
      const price = 1550
      const threshold = 1500
      const operator = '>='
      expect(compareValues(price, threshold, operator)).toBe(true)
    })

    it('does not trigger when price is below threshold', () => {
      const price = 1450
      const threshold = 1500
      const operator = '>='
      expect(compareValues(price, threshold, operator)).toBe(false)
    })
  })

  describe('Stop Loss', () => {
    it('triggers when loss exceeds threshold (-8%)', () => {
      const avgCost = 100
      const currentPrice = 90  // -10%
      const lossPct = ((currentPrice - avgCost) / avgCost) * 100
      const threshold = 8
      expect(lossPct <= -Math.abs(threshold)).toBe(true)
    })

    it('does not trigger when loss is within threshold', () => {
      const avgCost = 100
      const currentPrice = 95  // -5%
      const lossPct = ((currentPrice - avgCost) / avgCost) * 100
      const threshold = 8
      expect(lossPct <= -Math.abs(threshold)).toBe(false)
    })

    it('does not trigger when in profit', () => {
      const avgCost = 100
      const currentPrice = 105  // +5%
      const lossPct = ((currentPrice - avgCost) / avgCost) * 100
      const threshold = 8
      expect(lossPct <= -Math.abs(threshold)).toBe(false)
    })
  })

  describe('Stop Profit', () => {
    it('triggers when profit exceeds threshold (15%)', () => {
      const avgCost = 100
      const currentPrice = 120  // +20%
      const profitPct = ((currentPrice - avgCost) / avgCost) * 100
      const threshold = 15
      expect(profitPct >= threshold).toBe(true)
    })

    it('does not trigger when profit is below threshold', () => {
      const avgCost = 100
      const currentPrice = 110  // +10%
      const profitPct = ((currentPrice - avgCost) / avgCost) * 100
      const threshold = 15
      expect(profitPct >= threshold).toBe(false)
    })
  })

  describe('Concentration', () => {
    it('triggers when single asset weight exceeds threshold', () => {
      const positions = [
        { market_value: 80000 },
        { market_value: 20000 },
      ]
      const totalValue = positions.reduce((sum, p) => sum + p.market_value, 0)
      const threshold = 70
      const maxWeight = Math.max(...positions.map((p) => p.market_value / totalValue * 100))
      expect(maxWeight >= threshold).toBe(true)
    })

    it('does not trigger when weights are balanced', () => {
      const positions = [
        { market_value: 30000 },
        { market_value: 30000 },
        { market_value: 40000 },
      ]
      const totalValue = positions.reduce((sum, p) => sum + p.market_value, 0)
      const threshold = 70
      const maxWeight = Math.max(...positions.map((p) => p.market_value / totalValue * 100))
      expect(maxWeight >= threshold).toBe(false)
    })
  })

  describe('Drawdown', () => {
    it('triggers when portfolio drawdown exceeds threshold', () => {
      const totalCost = 100000
      const totalValue = 82000  // -18%
      const drawdownPct = ((totalCost - totalValue) / totalCost) * 100
      const threshold = 15
      expect(drawdownPct >= threshold).toBe(true)
    })

    it('does not trigger when drawdown is below threshold', () => {
      const totalCost = 100000
      const totalValue = 92000  // -8%
      const drawdownPct = ((totalCost - totalValue) / totalCost) * 100
      const threshold = 15
      expect(drawdownPct >= threshold).toBe(false)
    })
  })
})

describe('Alert State Machine', () => {
  const validTransitions: Record<string, string[]> = {
    pending: ['triggered'],
    triggered: ['acknowledged'],
    acknowledged: ['resolved', 'archived'],
    resolved: ['archived'],
    archived: [],
  }

  it('allows pending → triggered', () => {
    expect(validTransitions['pending']).toContain('triggered')
  })

  it('allows triggered → acknowledged', () => {
    expect(validTransitions['triggered']).toContain('acknowledged')
  })

  it('allows acknowledged → resolved', () => {
    expect(validTransitions['acknowledged']).toContain('resolved')
  })

  it('allows acknowledged → archived', () => {
    expect(validTransitions['acknowledged']).toContain('archived')
  })

  it('allows resolved → archived', () => {
    expect(validTransitions['resolved']).toContain('archived')
  })

  it('does NOT allow pending → acknowledged (skip trigger)', () => {
    expect(validTransitions['pending']).not.toContain('acknowledged')
  })

  it('does NOT allow triggered → resolved (skip ack)', () => {
    expect(validTransitions['triggered']).not.toContain('resolved')
  })

  it('archived has no transitions', () => {
    expect(validTransitions['archived']).toHaveLength(0)
  })
})
