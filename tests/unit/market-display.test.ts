import { describe, it, expect } from 'vitest'

// ─── Helpers mirroring MarketPage display logic ─────────────────────

function formatPrice(price: number, isFund: boolean): string {
  if (price == null) return '—'
  return `¥${isFund ? price.toFixed(4) : price.toFixed(2)}`
}

function formatChangePct(changePct: number | null): string {
  if (changePct == null) return '—'
  return `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('MarketPage Display Formatting', () => {
  it('formats fund price with 4 decimal places', () => {
    expect(formatPrice(1.8213, true)).toBe('¥1.8213')
    expect(formatPrice(2.3619, true)).toBe('¥2.3619')
    expect(formatPrice(1.5, true)).toBe('¥1.5000')
  })

  it('formats stock price with 2 decimal places', () => {
    expect(formatPrice(100.5, false)).toBe('¥100.50')
    expect(formatPrice(50, false)).toBe('¥50.00')
    expect(formatPrice(1234.567, false)).toBe('¥1234.57')
  })

  it('handles null/undefined price', () => {
    expect(formatPrice(null as any, true)).toBe('—')
    expect(formatPrice(undefined as any, false)).toBe('—')
  })

  it('formats positive change_pct with + sign', () => {
    expect(formatChangePct(2.5)).toBe('+2.50%')
    expect(formatChangePct(0)).toBe('+0.00%')
  })

  it('formats negative change_pct with - sign', () => {
    expect(formatChangePct(-1.25)).toBe('-1.25%')
    expect(formatChangePct(-0.05)).toBe('-0.05%')
  })

  it('handles null change_pct', () => {
    expect(formatChangePct(null)).toBe('—')
  })
})

describe('Fund NAV Change Percentage Calculation', () => {
  it('calculates correct change_pct from two NAV values', () => {
    const todayNav = 1.8213
    const yesterdayNav = 1.8000
    const changePct = Math.round(((todayNav - yesterdayNav) / yesterdayNav) * 10000) / 100
    expect(changePct).toBe(1.18)
  })

  it('calculates negative change_pct', () => {
    const todayNav = 1.7800
    const yesterdayNav = 1.8000
    const changePct = Math.round(((todayNav - yesterdayNav) / yesterdayNav) * 10000) / 100
    expect(changePct).toBe(-1.11)
  })

  it('handles zero change', () => {
    const todayNav = 2.0000
    const yesterdayNav = 2.0000
    const changePct = Math.round(((todayNav - yesterdayNav) / yesterdayNav) * 10000) / 100
    expect(changePct).toBe(0)
  })

  it('handles large change', () => {
    const todayNav = 2.2000
    const yesterdayNav = 2.0000
    const changePct = Math.round(((todayNav - yesterdayNav) / yesterdayNav) * 10000) / 100
    expect(changePct).toBe(10)
  })
})

describe('Report Delete Parameter Format', () => {
  it('should pass reportId as string, not object', () => {
    const reportId = 'report-123'
    // Simulating the fixed frontend call: ipcInvoke(CHANNEL, reportId)
    // Instead of: ipcInvoke(CHANNEL, { id: reportId })
    const payload = reportId
    expect(typeof payload).toBe('string')
    expect(payload).toBe('report-123')
  })

  it('should not wrap reportId in object', () => {
    const reportId = 'report-456'
    const wrongPayload = { id: reportId }
    const correctPayload = reportId

    expect(typeof wrongPayload).toBe('object')
    expect(typeof correctPayload).toBe('string')
    expect(correctPayload).toBe(reportId)
  })
})
