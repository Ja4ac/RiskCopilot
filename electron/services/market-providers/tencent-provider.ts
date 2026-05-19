import { v4 as uuid } from 'uuid'
import type { MarketQuote, KlineBar, KlinePeriod, AssetIdentifier } from '../../../shared/types/database'
import type { IMarketProvider } from './interface'

/**
 * 腾讯免费行情适配器 —— 零配置开箱即用
 * 数据源：腾讯财经实时行情 API (qt.gtimg.cn)
 * 无需注册、无需 API Key、完全免费
 */
export class TencentProvider implements IMarketProvider {
  readonly id = 'tencent-free'
  readonly provider = 'tencent'
  readonly name = '腾讯免费行情'

  async getQuotes(symbols: AssetIdentifier[]): Promise<MarketQuote[]> {
    if (symbols.length === 0) return []

    // 腾讯代码格式: sh600519,sz300750
    const codes = symbols.map((s) => `${s.market.toLowerCase()}${s.symbol}`).join(',')
    const url = `https://qt.gtimg.cn/q=${codes}`

    try {
      const resp = await fetch(url)
      if (!resp.ok) {
        console.error(`[TencentProvider] HTTP ${resp.status} for ${codes}`)
        return []
      }
      const text = await resp.text()

    const quotes: MarketQuote[] = []

    for (const symbol of symbols) {
      const code = `${symbol.market.toLowerCase()}${symbol.symbol}`
      const match = text.match(new RegExp(`v_${code}="([^"]*)"`, 'i'))
      if (!match) {
        console.warn(`[TencentProvider] Symbol not found: ${code}`)
        continue
      }

      const fields = match[1].split('~')
      if (fields.length < 3) {
        console.warn(`[TencentProvider] Incomplete data for ${code}`)
        continue
      }

      // 腾讯返回字段顺序：~名称~代码~当前价~昨日收~今日开~成交量~...~涨跌幅%~...
      const price = parseFloat(fields[3]) || 0
      const changePct = parseFloat(fields[32]) || 0 // 涨跌幅百分比
      const volume = parseFloat(fields[36]) || 0    // 成交量

      quotes.push({
        id: uuid(),
        asset_id: '',
        symbol: symbol.symbol,
        market: symbol.market,
        price: Math.round(price * 100) / 100,
        change_pct: Math.round(changePct * 100) / 100,
        volume: volume > 0 ? volume : null,
        turnover: null, // 腾讯免费 API 不直接提供成交额
        quote_time: new Date().toISOString(),
        source: 'tencent-free',
        provider_symbol: code,
      })
    }

    return quotes
    } catch (e: any) {
      console.error(`[TencentProvider] Fetch failed for ${codes}:`, e.message)
      return []
    }
  }

  async getKline(symbol: AssetIdentifier, period: KlinePeriod): Promise<KlineBar[]> {
    // Delegate to Python AKShare proxy for K-line data
    try {
      const { fetchKlineFromProxy } = await import('../data-proxy')
      const bars = await fetchKlineFromProxy(symbol.symbol, symbol.market, period, 120, 'qfq')
      return bars.map((b: { bar_time: string; open: number; high: number; low: number; close: number; volume: number; amount?: number }) => ({
        id: uuid(),
        asset_id: '',
        period,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        bar_time: b.bar_time,
        source: 'akshare',
      }))
    } catch (e: any) {
      console.error(`[TencentProvider] K-line proxy failed for ${symbol.symbol}:`, e.message)
      return []
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch('https://qt.gtimg.cn/q=sh600519')
      return resp.ok
    } catch {
      return false
    }
  }

  normalizeAssetCode(symbol: string, market: string): string {
    return `${market.toLowerCase()}${symbol}`
  }
}
