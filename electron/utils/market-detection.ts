import type { AssetType, Market } from '../../shared/types/database'

export function guessMarket(symbol: string, hint?: string): Market {
  // OF/OTC are explicit market designations that can't be derived from code
  if (hint?.toUpperCase() === 'OF' || hint?.toUpperCase() === 'OTC') return hint.toUpperCase() as Market

  // Code rules take priority over hint:
  //  6xxxxx → SH, 0/2/3xxxxx → SZ, 5-digit → HK, letters → US
  if (/^\d{6}$/.test(symbol)) {
    if (symbol.startsWith('6') || symbol.startsWith('9')) return 'SH'
    return 'SZ'
  }
  if (/^\d{5}$/.test(symbol)) return 'HK'
  if (/^[A-Z]+$/.test(symbol)) return 'US'

  // Fallback: use hint if valid
  if (hint && ['SH', 'SZ', 'HK', 'US'].includes(hint.toUpperCase())) {
    return hint.toUpperCase() as Market
  }
  return 'SZ'
}

export function guessAssetType(symbol: string): AssetType {
  if (/^\d{6}$/.test(symbol)) {
    if (symbol.startsWith('51')) return 'etf'
    if (symbol.startsWith('15') || symbol.startsWith('16')) return 'etf'
    if (symbol.startsWith('00') && symbol.length === 6 && /^00\d{4}$/.test(symbol)) {
      // 000xxx-004xxx are Shenzhen main board/SME stocks (never funds)
      // Return 'stock' here; stock_listings will override if this is wrong
      return 'stock'
    }
    return 'stock'
  }
  return 'stock'
}
