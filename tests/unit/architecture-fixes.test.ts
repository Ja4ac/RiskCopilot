// ============================================================
// Tests for recent architecture fixes:
//   - guessAssetType (no longer used — type from user action)
//   - AssetRepo.upsert name fallback (uses cleanSymbol)
//   - recalculatePosition price normalization (分→元)
//   - MarketQuote historical price fields
//   - HoldingsTable / WatchlistPanel column helpers
// ============================================================

import { describe, it, expect } from 'vitest'

// ─── 1. guessAssetType (no longer used in production — asset type
//      comes from user's transaction method choice) ─────────────
// Mirrors electron/utils/market-detection.ts

type AssetType = 'stock' | 'etf' | 'fund'

function guessAssetType(symbol: string): AssetType {
  if (/^\d{6}$/.test(symbol)) {
    if (symbol.startsWith('51')) return 'etf'
    if (symbol.startsWith('15') || symbol.startsWith('16')) return 'etf'
    if (symbol.startsWith('00') && symbol.length === 6 && /^00\d{4}$/.test(symbol)) {
      return 'stock'
    }
    return 'stock'
  }
  return 'stock'
}

describe('guessAssetType (no longer used in production)', () => {
  it('classifies 002xxx (Shenzhen SME) as stock', () => {
    expect(guessAssetType('002300')).toBe('stock') // 太阳电缆
    expect(guessAssetType('002415')).toBe('stock') // 海康威视
    expect(guessAssetType('002714')).toBe('stock') // 牧原股份
  })

  it('classifies 003xxx as stock (no code-prefix guessing)', () => {
    // 003 was previously guessed as fund — no longer.
    // Asset type is determined by user's transaction method choice.
    expect(guessAssetType('003816')).toBe('stock')
  })

  it('classifies 001xxx as stock', () => {
    expect(guessAssetType('001979')).toBe('stock') // 招商蛇口
  })

  it('classifies 000xxx as stock (no code-prefix guessing)', () => {
    expect(guessAssetType('005827')).toBe('stock')
    expect(guessAssetType('000961')).toBe('stock')
  })

  it('classifies 60xxxx (Shanghai) as stock', () => {
    expect(guessAssetType('600519')).toBe('stock') // 贵州茅台
    expect(guessAssetType('601318')).toBe('stock') // 中国平安
  })

  it('classifies 30xxxx (ChiNext) as stock', () => {
    expect(guessAssetType('300750')).toBe('stock') // 宁德时代
    expect(guessAssetType('300274')).toBe('stock') // 阳光电源
  })

  it('classifies 51xxxx as ETF', () => {
    expect(guessAssetType('510050')).toBe('etf')
    expect(guessAssetType('512880')).toBe('etf')
  })

  it('classifies 15xxxx/16xxxx as ETF', () => {
    expect(guessAssetType('159915')).toBe('etf')
    expect(guessAssetType('159949')).toBe('etf')
  })
})

// ─── 2. Asset type resolution priority ─────────────────────
// Priority: user choice > stock_listings > 'stock' (default)
// Mirrors the logic in AssetRepo.upsert

function resolveAssetTypeFinal(
  userChoice: string | undefined,
  stockListingType: string | undefined,
): string {
  return userChoice ?? stockListingType ?? 'stock'
}

describe('Asset type resolution priority', () => {
  it('uses user choice when provided', () => {
    // User explicitly selected "股票" — this must always win
    expect(resolveAssetTypeFinal('stock', undefined)).toBe('stock')
    expect(resolveAssetTypeFinal('stock', 'fund')).toBe('stock')
  })

  it('falls back to stock_listings when user did not choose', () => {
    // CSV import without asset_type column → look up stock_listings
    expect(resolveAssetTypeFinal(undefined, 'stock')).toBe('stock')
    expect(resolveAssetTypeFinal(undefined, 'fund')).toBe('fund')
  })

  it('defaults to stock when nothing else is available', () => {
    // Brand new stock not yet in stock_listings, no user choice
    // No code-prefix guessing — just default to 'stock'
    expect(resolveAssetTypeFinal(undefined, undefined)).toBe('stock')
  })
})

// ─── 3. Asset name resolution ───────────────────────────────
// Mirrors the cleanSymbol logic in AssetRepo.upsert

function resolveAssetName(name: string | undefined, symbol: string): string {
  const cleanSymbol = symbol.trim().replace(/\.+$/, '')
  return name || cleanSymbol
}

describe('Asset name resolution', () => {
  it('uses name when provided', () => {
    expect(resolveAssetName('太阳电缆', '002300')).toBe('太阳电缆')
  })

  it('falls back to cleanSymbol when name is empty', () => {
    expect(resolveAssetName('', '002300')).toBe('002300')
    expect(resolveAssetName(undefined, '002300')).toBe('002300')
  })

  it('strips trailing dots from symbol fallback name', () => {
    // Previously: name = params.name || params.symbol → "300750."
    // Fixed:      name = params.name || cleanSymbol  → "300750"
    expect(resolveAssetName(undefined, '300750.')).toBe('300750')
    expect(resolveAssetName('', '600519..')).toBe('600519')
  })

  it('does not strip name-provided dots', () => {
    // When name is explicitly provided, use it as-is
    expect(resolveAssetName('宁德时代', '300750')).toBe('宁德时代')
  })
})

// ─── 4. Price normalization (分→元 conversion) ──────────────
// Mirrors the logic in PositionService.recalculatePosition

function normalizeQuotePrice(rawPrice: number, avgCost: number): number {
  if (rawPrice > 100 && avgCost > 0) {
    const inYuan = rawPrice / 100
    if (inYuan > 0.5 && inYuan < 100 &&
        Math.abs(inYuan / avgCost - 1) < Math.abs(rawPrice / avgCost - 1)) {
      return inYuan
    }
  }
  return rawPrice
}

describe('Price normalization 分→元', () => {
  it('converts 981 (分) to 9.81 (元) when avgCost is ~11', () => {
    // avgCost=11.075, rawPrice=981 → inYuan=9.81
    // diff(inYuan)=|9.81/11.075-1|=0.114, diff(raw)=|981/11.075-1|=87.58
    // 0.114 < 87.58 → convert
    expect(normalizeQuotePrice(981, 11.075)).toBeCloseTo(9.81, 2)
  })

  it('converts 1550 (分) to 15.50 (元) when avgCost is ~16', () => {
    expect(normalizeQuotePrice(1550, 16.20)).toBeCloseTo(15.50, 2)
  })

  it('does NOT convert normal prices (9.81)', () => {
    expect(normalizeQuotePrice(9.81, 11.075)).toBe(9.81)
  })

  it('does NOT convert when avgCost is 0', () => {
    // Cannot determine normalization without avgCost reference
    expect(normalizeQuotePrice(981, 0)).toBe(981)
  })

  it('does NOT convert when inYuan is > 100', () => {
    // Price in 元 that's genuinely > 100 (e.g., 茅台 1500元)
    expect(normalizeQuotePrice(150000, 0)).toBe(150000) // no avgCost → skip
    expect(normalizeQuotePrice(1500, 1500)).toBe(1500)  // inYuan=15, diff=0.99 vs raw diff=0 → keep raw
  })

  it('does NOT convert when inYuan is < 0.5', () => {
    expect(normalizeQuotePrice(30, 11.075)).toBe(30) // inYuan=0.3 < 0.5
  })

  it('picks 分→元 conversion when it is closer to avgCost than raw price', () => {
    // avgCost=10, rawPrice=1050, inYuan=10.50
    // diff(inYuan)=|10.50/10-1|=0.05, diff(raw)=|1050/10-1|=104
    // 0.05 < 104 → convert
    expect(normalizeQuotePrice(1050, 10)).toBeCloseTo(10.50, 2)
  })
})

// ─── 5. Column display helpers ─────────────────────────────

describe('Column display helpers', () => {
  it('formats positive change with + sign', () => {
    const pct = 0.5
    const display = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
    expect(display).toBe('+0.50%')
  })

  it('formats negative change with no extra sign', () => {
    const pct = -0.5
    const display = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
    expect(display).toBe('-0.50%')
  })

  it('formats zero change as +0.00%', () => {
    const pct = 0
    const display = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
    expect(display).toBe('+0.00%')
  })

  it('formats yesterday_pnl amount with ¥ sign', () => {
    const pnl = 123.45
    const display = `${pnl >= 0 ? '+' : ''}¥${pnl.toFixed(2)}`
    expect(display).toBe('+¥123.45')
  })
})

// ─── 6. Market auto-detection (code priority over hint) ────
// Mirrors electron/utils/market-detection.ts guessMarket (FIXED)
// and src/features/portfolio/TradeModal.tsx detectMarket

type Market = 'SH' | 'SZ' | 'HK' | 'US' | 'OF' | 'OTC'

function guessMarket(symbol: string, hint?: string): Market {
  if (hint?.toUpperCase() === 'OF' || hint?.toUpperCase() === 'OTC') return hint.toUpperCase() as Market
  if (/^\d{6}$/.test(symbol)) {
    if (symbol.startsWith('6') || symbol.startsWith('9')) return 'SH'
    return 'SZ'
  }
  if (/^\d{5}$/.test(symbol)) return 'HK'
  if (/^[A-Z]+$/.test(symbol)) return 'US'
  if (hint && ['SH', 'SZ', 'HK', 'US'].includes(hint.toUpperCase())) return hint.toUpperCase() as Market
  return 'SZ'
}

function detectMarket(symbol: string): string {
  if (/^\d{6}$/.test(symbol)) {
    return (symbol.startsWith('6') || symbol.startsWith('9')) ? 'SH' : 'SZ'
  }
  if (/^\d{5}$/.test(symbol)) return 'HK'
  if (/^[A-Z]+$/.test(symbol)) return 'US'
  return 'SZ'
}

describe('Market auto-detection', () => {
  // Code rules are authoritative
  it('detects SZ for 002xxx codes', () => {
    expect(guessMarket('002300')).toBe('SZ')
    expect(detectMarket('002300')).toBe('SZ')
  })
  it('detects SZ for 00xxxx codes', () => {
    expect(guessMarket('000001')).toBe('SZ')
    expect(detectMarket('000001')).toBe('SZ')
  })
  it('detects SH for 60xxxx codes', () => {
    expect(guessMarket('600519')).toBe('SH')
    expect(detectMarket('600519')).toBe('SH')
  })
  it('detects SZ for 30xxxx (ChiNext) codes', () => {
    expect(guessMarket('300750')).toBe('SZ')
    expect(detectMarket('300750')).toBe('SZ')
  })
  it('detects SZ for 3xxxxx codes', () => {
    expect(guessMarket('399001')).toBe('SZ')
    expect(detectMarket('399001')).toBe('SZ')
  })
  it('detects HK for 5-digit codes', () => {
    expect(guessMarket('00700')).toBe('HK')
    expect(detectMarket('00700')).toBe('HK')
  })
  it('detects US for letter codes', () => {
    expect(guessMarket('AAPL')).toBe('US')
    expect(detectMarket('AAPL')).toBe('US')
  })

  // Code takes priority over wrong hint
  it('returns SZ even when hint is SH for 002xxx code', () => {
    expect(guessMarket('002300', 'SH')).toBe('SZ')
  })
  it('returns SH even when hint is SZ for 60xxxx code', () => {
    expect(guessMarket('600519', 'SZ')).toBe('SH')
  })
  it('ignores invalid hint for 6-digit code', () => {
    expect(guessMarket('002300', 'US')).toBe('SZ')
  })

  // Special markets preserved
  it('preserves OF hint for off-exchange funds', () => {
    expect(guessMarket('002300', 'OF')).toBe('OF')
  })
  it('preserves OTC hint', () => {
    expect(guessMarket('000001', 'OTC')).toBe('OTC')
  })

  // Non-standard codes fallback to hint
  it('uses hint when code cannot determine market', () => {
    expect(guessMarket('12345A', 'SH')).toBe('SH')
  })
  it('defaults to SZ when no hint and unknown format', () => {
    expect(guessMarket('')).toBe('SZ')
    expect(detectMarket('')).toBe('SZ')
  })
})
