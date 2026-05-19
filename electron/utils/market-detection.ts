import type { AssetType, Market } from '../../shared/types/database'

export function guessMarket(symbol: string, hint?: string): Market {
  if (hint && ['SH', 'SZ', 'HK', 'US', 'OF'].includes(hint.toUpperCase())) {
    return hint.toUpperCase() as Market
  }
  if (/^\d{6}$/.test(symbol)) {
    if (symbol.startsWith('6') || symbol.startsWith('9')) return 'SH'
    if (symbol.startsWith('0') || symbol.startsWith('3') || symbol.startsWith('2')) return 'SZ'
    return 'SZ'
  }
  if (/^\d{5}$/.test(symbol)) return 'HK'
  if (/^[A-Z]+$/.test(symbol)) return 'US'
  return 'SZ'
}

export function guessAssetType(symbol: string): AssetType {
  if (/^\d{6}$/.test(symbol)) {
    if (symbol.startsWith('51')) return 'etf'
    if (symbol.startsWith('15') || symbol.startsWith('16')) return 'etf'
    if (symbol.startsWith('00') && symbol.length === 6 && /^00\d{4}$/.test(symbol)) return 'fund'
    return 'stock'
  }
  return 'stock'
}
