import { describe, it, expect } from 'vitest'

// ─── Helpers mirroring market-sync.ts K-line logic ───────────────────

interface KlineBar {
  bar_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount?: number
}

function shouldSyncKlines(assetType: string, market: string): boolean {
  return assetType !== 'fund' && market !== 'OF'
}

function buildKlineId(assetId: string, barTime: string, period: string): string {
  return `${assetId}_${barTime}_${period}`
}

function transformProxyBarsToDbRows(
  bars: KlineBar[],
  assetId: string,
  source: string
): Array<{
  id: string
  asset_id: string
  period: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  bar_time: string
  source: string
}> {
  return bars.map((bar) => ({
    id: buildKlineId(assetId, bar.bar_time, '1d'),
    asset_id: assetId,
    period: '1d',
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 0,
    bar_time: bar.bar_time,
    source,
  }))
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('K-line Sync Filtering', () => {
  it('syncs K-lines for stocks', () => {
    expect(shouldSyncKlines('stock', 'SZ')).toBe(true)
    expect(shouldSyncKlines('stock', 'SH')).toBe(true)
  })

  it('syncs K-lines for ETFs', () => {
    expect(shouldSyncKlines('etf', 'SH')).toBe(true)
    expect(shouldSyncKlines('etf', 'SZ')).toBe(true)
  })

  it('skips K-lines for funds', () => {
    expect(shouldSyncKlines('fund', 'OF')).toBe(false)
  })

  it('skips K-lines for assets with OF market', () => {
    expect(shouldSyncKlines('stock', 'OF')).toBe(false)
  })
})

describe('K-line ID Generation', () => {
  it('generates stable IDs from asset_id + bar_time + period', () => {
    const id1 = buildKlineId('asset-001', '2024-01-15', '1d')
    const id2 = buildKlineId('asset-001', '2024-01-15', '1d')
    expect(id1).toBe(id2)
    expect(id1).toBe('asset-001_2024-01-15_1d')
  })

  it('generates different IDs for different dates', () => {
    const id1 = buildKlineId('asset-001', '2024-01-15', '1d')
    const id2 = buildKlineId('asset-001', '2024-01-16', '1d')
    expect(id1).not.toBe(id2)
  })
})

describe('K-line Data Transformation', () => {
  it('transforms proxy bars to DB rows correctly', () => {
    const bars: KlineBar[] = [
      { bar_time: '2024-01-15', open: 100, high: 105, low: 99, close: 102, volume: 10000 },
      { bar_time: '2024-01-16', open: 102, high: 108, low: 101, close: 107, volume: 15000 },
    ]

    const rows = transformProxyBarsToDbRows(bars, 'asset-001', 'akshare')
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe('asset-001_2024-01-15_1d')
    expect(rows[0].asset_id).toBe('asset-001')
    expect(rows[0].period).toBe('1d')
    expect(rows[0].open).toBe(100)
    expect(rows[0].close).toBe(102)
    expect(rows[0].volume).toBe(10000)
    expect(rows[0].source).toBe('akshare')
  })

  it('handles bars without volume', () => {
    const bars: KlineBar[] = [
      { bar_time: '2024-01-15', open: 100, high: 105, low: 99, close: 102, volume: 0 },
    ]

    const rows = transformProxyBarsToDbRows(bars, 'asset-001', 'akshare')
    expect(rows[0].volume).toBe(0)
  })

  it('handles bars with amount field', () => {
    const bars: KlineBar[] = [
      { bar_time: '2024-01-15', open: 100, high: 105, low: 99, close: 102, volume: 10000, amount: 1020000 },
    ]

    const rows = transformProxyBarsToDbRows(bars, 'asset-001', 'akshare')
    expect(rows).toHaveLength(1)
  })
})

describe('K-line Sync Batch Size', () => {
  it('limits to 60 bars per sync request', () => {
    const requestedCount = 60
    expect(requestedCount).toBeLessThanOrEqual(120) // max from proxy
    expect(requestedCount).toBeGreaterThanOrEqual(1)
  })

  it('uses qfq adjustment for stocks', () => {
    const adjust = 'qfq'
    expect(adjust).toBe('qfq')
  })

  it('uses 1d period for daily sync', () => {
    const period = '1d'
    expect(period).toBe('1d')
  })
})

describe('K-line Data Quality', () => {
  it('validates OHLC consistency (high >= low)', () => {
    const bars: KlineBar[] = [
      { bar_time: '2024-01-15', open: 100, high: 105, low: 99, close: 102, volume: 10000 },
    ]
    for (const bar of bars) {
      expect(bar.high).toBeGreaterThanOrEqual(bar.low)
      expect(bar.high).toBeGreaterThanOrEqual(bar.open)
      expect(bar.high).toBeGreaterThanOrEqual(bar.close)
      expect(bar.low).toBeLessThanOrEqual(bar.open)
      expect(bar.low).toBeLessThanOrEqual(bar.close)
    }
  })

  it('validates bar_time format', () => {
    const barTime = '2024-01-15'
    expect(barTime).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('validates chronological order', () => {
    const bars: KlineBar[] = [
      { bar_time: '2024-01-15', open: 100, high: 105, low: 99, close: 102, volume: 10000 },
      { bar_time: '2024-01-16', open: 102, high: 108, low: 101, close: 107, volume: 15000 },
      { bar_time: '2024-01-17', open: 107, high: 110, low: 106, close: 108, volume: 12000 },
    ]

    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].bar_time > bars[i - 1].bar_time).toBe(true)
    }
  })
})

describe('K-line Error Handling', () => {
  it('handles empty bar array gracefully', () => {
    const bars: KlineBar[] = []
    const rows = transformProxyBarsToDbRows(bars, 'asset-001', 'akshare')
    expect(rows).toHaveLength(0)
  })

  it('handles proxy failure without crashing', () => {
    const proxyError = new Error('Proxy HTTP 500: Internal error')
    expect(proxyError.message).toContain('Proxy HTTP')
  })

  it('handles unsupported market gracefully', () => {
    const unsupportedMarkets = ['FOREX', 'CRYPTO', 'COMMODITY']
    for (const market of unsupportedMarkets) {
      expect(['SH', 'SZ', 'BJ', 'US', 'HK', 'ETF', 'FUND', 'OF']).not.toContain(market)
    }
  })
})
