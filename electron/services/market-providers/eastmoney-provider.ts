import type { MarketQuote, KlineBar, KlinePeriod, AssetIdentifier } from '../../../shared/types/database'
import type { IMarketProvider } from './interface'

/**
 * East Money (东方财富) provider — free A-share + fund listings and quotes.
 * No auth required. Uses public endpoints.
 */
export class EastMoneyProvider implements IMarketProvider {
  readonly id = 'eastmoney-free'
  readonly provider = 'eastmoney'
  readonly name = '东方财富免费行情'

  // secid mapping: 0=SZ, 1=SH, 116=HK, 100=US(?)
  private secid(symbol: string, market: string): string {
    const m = market.toUpperCase()
    if (m === 'SH') return `1.${symbol}`
    if (m === 'SZ') return `0.${symbol}`
    if (m === 'HK') return `116.${symbol}`
    return `0.${symbol}`
  }

  async getQuotes(symbols: AssetIdentifier[]): Promise<MarketQuote[]> {
    if (symbols.length === 0) return []
    const results: MarketQuote[] = []

    // Separate funds from stocks/ETFs
    const funds = symbols.filter((s) => this.isFund(s.market, s.symbol))
    const stocks = symbols.filter((s) => !this.isFund(s.market, s.symbol))

    // --- Fetch stocks/ETFs via East Money stock API ---
    for (const s of stocks) {
      try {
        const secid = this.secid(s.symbol, s.market)
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f170`
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://quote.eastmoney.com',
          },
          signal: AbortSignal.timeout(10000),
        })
        if (!resp.ok) {
          console.error(`[EastMoneyProvider] HTTP ${resp.status} for ${s.symbol} (${secid})`)
          continue
        }
        const json = (await resp.json()) as { data?: Record<string, unknown>; rc?: number; rt?: number }
        const d = json.data
        if (!d) {
          console.error(`[EastMoneyProvider] No data for ${s.symbol} (${secid}):`, JSON.stringify(json).slice(0, 200))
          continue
        }

        // f43=price, f60=prevClose, f47=volume, f48=turnover
        const price = Number(d.f43) || 0
        const prevClose = Number(d.f60) || price
        const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0
        const volume = Number(d.f47) || 0
        const turnover = Number(d.f48) || 0

        results.push({
          id: '',
          asset_id: '',
          symbol: s.symbol,
          market: s.market,
          price: Math.round(price * 100) / 100,
          change_pct: Math.round(changePct * 100) / 100,
          volume: volume > 0 ? volume : null,
          turnover: turnover > 0 ? turnover : null,
          quote_time: new Date().toISOString(),
          source: 'eastmoney-free',
          provider_symbol: secid,
        } as MarketQuote)
      } catch (e: any) {
        const cause = e.cause ? ` | cause: ${e.cause.message || e.cause}` : ''
        const stack = e.stack ? ` | stack: ${e.stack.split('\n').slice(0, 3).join(' ')}` : ''
        console.error(`[EastMoneyProvider] Fetch failed for ${s.symbol}: ${e.message}${cause}${stack}`)
      }

      await new Promise((r) => setTimeout(r, 80))
    }

    // --- Fetch funds via East Money fund valuation API ---
    for (const s of funds) {
      try {
        const fundQuote = await this.fetchFundQuote(s.symbol)
        if (fundQuote) {
          results.push(fundQuote)
        }
      } catch (e: any) {
        console.error(`[EastMoneyProvider] Fund fetch failed for ${s.symbol}:`, e.message)
      }
      await new Promise((r) => setTimeout(r, 80))
    }

    return results
  }

  /**
   * Detect if a symbol is an off-exchange fund.
   */
  private isFund(market: string, symbol: string): boolean {
    const m = market.toUpperCase()
    if (m === 'OF' || m === 'FUND') return true
    // Most Chinese public funds are 6-digit numeric codes not starting with stock prefixes
    if (/^\d{6}$/.test(symbol)) {
      // Exclude known stock/ETF prefixes
      if (/^(60|68|00|30|51|56|15|16|18|88)/.test(symbol)) return false
      return true
    }
    return false
  }

  /**
   * Fetch fund real-time valuation from East Money fund API.
   */
  private async fetchFundQuote(symbol: string): Promise<MarketQuote | null> {
    const timestamp = Date.now()
    const url = `https://fundgz.1234567.com.cn/js/${symbol}.js?rt=${timestamp}`
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://fund.eastmoney.com/',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) {
      console.warn(`[EastMoneyProvider] Fund HTTP ${resp.status} for ${symbol}`)
      return null
    }

    const text = await resp.text()
    // Response: jsonpgz({"fundcode":"025209","name":"...","jzrq":"2024-05-17","dwjz":"1.0234","gsz":"1.0245","gszzl":"0.11","gztime":"2024-05-17 15:00"});
    const match = text.match(/jsonpgz\((\{[^}]+\})\);?/)
    if (!match) {
      console.warn(`[EastMoneyProvider] Fund response parse failed for ${symbol}:`, text.slice(0, 100))
      return null
    }

    try {
      const data = JSON.parse(match[1]) as {
        fundcode: string
        name: string
        jzrq: string
        dwjz: string
        gsz: string
        gszzl: string
        gztime: string
      }

      const nav = parseFloat(data.dwjz) || 0
      const estimateNav = parseFloat(data.gsz) || nav
      const changePct = parseFloat(data.gszzl) || 0

      return {
        id: '',
        asset_id: '',
        symbol: data.fundcode,
        market: 'OF',
        price: estimateNav > 0 ? estimateNav : nav,
        change_pct: Math.round(changePct * 100) / 100,
        volume: null,
        turnover: null,
        quote_time: new Date().toISOString(),
        source: 'eastmoney-fund',
        provider_symbol: data.fundcode,
      } as MarketQuote
    } catch (e: any) {
      console.error(`[EastMoneyProvider] Fund JSON parse failed for ${symbol}:`, e.message)
      return null
    }
  }

  async getKline(symbol: AssetIdentifier, period: KlinePeriod): Promise<KlineBar[]> {
    // Delegate to Python AKShare proxy for K-line data
    try {
      const { fetchKlineFromProxy } = await import('../data-proxy')
      const { v4: uuid } = await import('uuid')
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
      console.error(`[EastMoneyProvider] K-line proxy failed for ${symbol.symbol}:`, e.message)
      return []
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch('https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      return resp.ok
    } catch {
      return false
    }
  }

  normalizeAssetCode(symbol: string, market: string): string {
    return `${market.toUpperCase()}.${symbol}`
  }

  /**
   * Fetch full A-share + ETF listings from East Money.
   * Returns array of { symbol, market, name, asset_type, industry }.
   */
  async fetchAStockListings(): Promise<Array<{
    symbol: string
    market: string
    name: string
    asset_type: 'stock' | 'etf'
    industry: string | null
  }>> {
    // fs param breakdown:
    // m:0+t:6 = 深A主板, m:0+t:80 = 深A创业板
    // m:1+t:2 = 沪A主板, m:1+t:23 = 沪A科创板
    // m:0+t:11 = 深市ETF, m:1+t:11 = 沪市ETF
    const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:11,m:1+t:11'
    const pageSize = 1000
    let pageNo = 1
    const allListings: Array<{
      symbol: string; market: string; name: string
      asset_type: 'stock' | 'etf'; industry: string | null
    }> = []

    while (true) {
      const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${pageNo}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${fs}&fields=f12,f13,f14,f20,f128,f136`
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      if (!resp.ok) throw new Error(`EastMoney listing fetch failed: ${resp.status}`)

      const json = (await resp.json()) as {
        data?: {
          total?: number
          diff?: Record<string, { f12: string; f13: number; f14: string; f20?: number; f128?: string; f136?: string }>
        }
      }

      const diff = json.data?.diff
      if (!diff || Object.keys(diff).length === 0) break

      for (const key of Object.keys(diff)) {
        const item = diff[key]
        if (!item || !item.f12) continue

        const symbol = String(item.f12)
        const market = item.f13 === 1 ? 'SH' : 'SZ'
        const name = String(item.f14 || '')
        const isEtf = /^5[0-6]|^15|^16/.test(symbol) || /ETF/i.test(name)

        allListings.push({
          symbol, market, name,
          asset_type: isEtf ? 'etf' : 'stock',
          industry: item.f128 || null,
        })
      }

      // Termination: empty page, or reached reported total, or last page shorter than pageSize
      if (Object.keys(diff).length < pageSize) break
      const total = json.data?.total
      if (total != null && allListings.length >= Number(total)) break
      pageNo++
      // Rate limit between pages
      await new Promise((r) => setTimeout(r, 300))
    }

    return allListings
  }

  /**
   * Fetch full fund listings from East Money.
   */
  async fetchFundListings(): Promise<Array<{
    symbol: string
    market: string
    name: string
    asset_type: 'fund'
    industry: string | null
  }>> {
    // East Money fund list endpoint returns all funds
    const url = 'http://fund.eastmoney.com/js/fundcode_search.js'
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'http://fund.eastmoney.com/',
      },
    })
    if (!resp.ok) throw new Error(`EastMoney fund listing fetch failed: ${resp.status}`)

    const text = await resp.text()
    // Response format: var r = [["000001","HXCZHH","华夏成长混合","混合型-偏股"],[...]];
    const match = text.match(/var\s+r\s*=\s*(\[.*\]);?\s*$/s)
    if (!match) return []

    try {
      const arr = JSON.parse(match[1]) as [string, string, string, string][]
      return arr.map((item) => ({
        symbol: item[0],
        market: 'SH', // Funds use SH as default market for quoting
        name: item[2],
        asset_type: 'fund' as const,
        industry: item[3] || null,
      }))
    } catch {
      return []
    }
  }
}
