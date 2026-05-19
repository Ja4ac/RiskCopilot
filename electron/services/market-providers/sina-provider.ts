import { v4 as uuid } from 'uuid'
import type { MarketQuote, KlineBar, KlinePeriod, AssetIdentifier } from '../../../shared/types/database'
import type { IMarketProvider } from './interface'

/**
 * 新浪免费行情适配器 —— 零配置开箱即用
 * 数据源：新浪财经实时行情 API (hq.sinajs.cn)
 * 无需注册、无需 API Key、完全免费
 */
export class SinaJsProvider implements IMarketProvider {
  readonly id = 'sina-free'
  readonly provider = 'sina'
  readonly name = '新浪免费行情'

  async getQuotes(symbols: AssetIdentifier[]): Promise<MarketQuote[]> {
    if (symbols.length === 0) return []

    // 新浪代码格式: sh600519, sz300750
    const codes = symbols.map((s) => `${s.market.toLowerCase()}${s.symbol}`).join(',')
    const url = `https://hq.sinajs.cn/list=${codes}`

    try {
      const resp = await fetch(url, {
        headers: { Referer: 'https://finance.sina.com.cn' },
      })
      if (!resp.ok) {
        console.error(`[SinaProvider] HTTP ${resp.status} for ${codes}`)
        return []
      }
      const text = await resp.text()

    const quotes: MarketQuote[] = []

    for (const symbol of symbols) {
      const code = `${symbol.market.toLowerCase()}${symbol.symbol}`
      const match = text.match(new RegExp(`var hq_str_${code}="([^"]*)"`, 'i'))
      if (!match) {
        console.warn(`[SinaProvider] Symbol not found: ${code}`)
        continue
      }

      const fields = match[1].split(',')
      if (fields.length < 3) {
        console.warn(`[SinaProvider] Incomplete data for ${code}`)
        continue
      }

      // 新浪返回字段顺序：名称, 今日开盘, 昨日收盘, 当前价, 最高价, 最低价, 竞买价, 竞卖价, 成交量, 成交额, ...
      const name = fields[0]
      const open = parseFloat(fields[1]) || 0
      const prevClose = parseFloat(fields[2]) || 0
      const price = parseFloat(fields[3]) || 0
      const volume = parseFloat(fields[8]) || 0
      const turnover = parseFloat(fields[9]) || 0

      // 计算涨跌幅百分比
      const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0

      quotes.push({
        id: uuid(),
        asset_id: '',
        symbol: symbol.symbol,
        market: symbol.market,
        price: Math.round(price * 100) / 100,
        change_pct: Math.round(changePct * 100) / 100,
        volume: volume > 0 ? volume : null,
        turnover: turnover > 0 ? turnover : null,
        quote_time: new Date().toISOString(),
        source: 'sina-free',
        provider_symbol: code,
      })
    }

    return quotes
    } catch (e: any) {
      console.error(`[SinaProvider] Fetch failed for ${codes}:`, e.message)
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
      console.error(`[SinaProvider] K-line proxy failed for ${symbol.symbol}:`, e.message)
      return []
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch('https://hq.sinajs.cn/list=sh600519', {
        headers: { Referer: 'https://finance.sina.com.cn' },
      })
      return resp.ok
    } catch {
      return false
    }
  }

  normalizeAssetCode(symbol: string, market: string): string {
    return `${market.toLowerCase()}${symbol}`
  }
}
