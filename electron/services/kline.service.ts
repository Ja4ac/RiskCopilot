// ============================================================
// KlineService — unified K-line fetching, caching, and proxy/provider fallback
// ============================================================

import { MarketService } from './market.service'
import { fetchKlineFromProxy, isProxyRunning } from './data-proxy'
import { getMarketProviderRegistry } from './market-providers/registry'
import { getDb } from '../db'
import type { KlineBar, KlineErrorCode, KlineFetchResult, Market } from '../../shared/types/database'

const MAX_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export class KlineService {
  private marketService = new MarketService()

  /**
   * Fetch K-line data with 5-step fallback:
   *   a. Force-refresh: delete cached bars when `force` is true
   *   b. Check DB cache
   *   c. Unsupported market check (OF / OTC)
   *   d. Try Python proxy with isProxyRunning() → fetchKlineFromProxy()
   *   e. Provider fallback via getMarketProviderRegistry()
   *   f. All failed → structured error result
   */
  async fetchKline(
    assetId: string,
    period: string = '1d',
    force?: boolean,
    from?: string,
    to?: string
  ): Promise<KlineFetchResult> {
    const db = getDb()

    // Force refresh: clear existing cache
    if (force && assetId) {
      db.prepare(`DELETE FROM kline_bars WHERE asset_id = ?`).run(assetId)
    }

    const asset = db.prepare('SELECT symbol, market FROM assets WHERE id = ?').get(assetId) as { symbol: string; market: string } | undefined

    // Step 1: DB cache
    let klines = this.marketService.getKline(assetId, period as any, from, to)
    if (klines.length > 0) {
      return this.makeResult(klines, 'db', true, 'not_checked', 'NONE')
    }

    // Step 2: Unsupported market
    if (!asset || asset.market === 'OF' || asset.market === 'OTC') {
      return this.makeResult([], 'none', false, 'not_checked', 'UNSUPPORTED_MARKET', '该市场类型不支持在线获取K线数据')
    }

    // Step 3: Try Python proxy — adjust count and adjustment method per market & period
    const proxyRunning = await isProxyRunning()
    if (proxyRunning) {
      try {
        // Request more bars for weekly/monthly to get meaningful history
        const barCount = period === '1M' ? 360 : period === '1w' ? 520 : 365
        // '' (不复权): shows real trading prices at each point in time
        // qfq (前复权): adjusts historical DOWN → past prices appear too low
        // hfq (后复权): accumulates dividends into current → current prices appear too high
        const adjust = ''
        const bars = await fetchKlineFromProxy(asset.symbol, asset.market, period, barCount, adjust)
        if (bars.length > 0) {
          // Debug: log first 3 bars to verify OHLC values
          for (let i = 0; i < Math.min(3, bars.length); i++) {
            const b = bars[i]
            console.log(`[KlineDebug] ${asset.symbol} ${period} bar[${i}]: date=${b.bar_time} open=${b.open} close=${b.close} high=${b.high} low=${b.low} vol=${b.volume}`)
          }
          // Also log last bar (most recent)
          const last = bars[bars.length - 1]
          console.log(`[KlineDebug] ${asset.symbol} ${period} last: date=${last.bar_time} open=${last.open} close=${last.close} high=${last.high} low=${last.low} vol=${last.volume}`)
          this.storeBars(assetId, period, bars, 'akshare')
          klines = this.marketService.getKline(assetId, period as any, from, to)
          return this.makeResult(klines, 'proxy', false, 'active', 'NONE')
        }
        return this.makeResult([], 'proxy', false, 'active', 'NO_DATA', '代理返回0条K线数据')
      } catch { /* fall through to provider fallback */ }
    }

    // Step 4: Provider fallback
    const providers = Array.from(getMarketProviderRegistry().values())
    let lastError: string | null = null
    for (const provider of providers) {
      try {
        const healthy = await provider.healthCheck()
        if (!healthy) {
          lastError = `${provider.name} 健康检查失败`
          continue
        }
        const providerBars = await provider.getKline(
          { symbol: asset.symbol, market: asset.market as Market },
          period as any
        )
        if (providerBars.length > 0) {
          this.storeBars(assetId, period, providerBars, provider.id)
          klines = this.marketService.getKline(assetId, period as any, from, to)
          return this.makeResult(klines, 'provider', false, 'active', 'NONE')
        }
        lastError = `${provider.name} 返回0条数据`
      } catch (e: any) {
        lastError = `${provider.name}: ${e.message}`
      }
    }

    // Step 5: All failed
    return this.makeResult(
      [],
      'none',
      false,
      proxyRunning ? 'error' : 'unavailable',
      proxyRunning ? 'PROXY_ERROR' : 'PROXY_UNAVAILABLE',
      proxyRunning
        ? `数据源错误: ${lastError || '获取失败'}`
        : 'Python数据源未启动。请安装Python环境并运行: pip install -r python-proxy/requirements.txt'
    )
  }

  /**
   * Sync K-line for a single asset — used by force-refresh in market-sync.
   * Fetches from proxy with retry and writes to DB.
   * Returns the number of bars written.
   */
  async syncKlineForAsset(
    symbol: string,
    market: string,
    assetId: string,
    period: string = '1d',
    count: number = 120,
    adjust: string = 'qfq'
  ): Promise<number> {
    let lastErr: any
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const bars = await fetchKlineFromProxy(symbol, market, period, count, adjust)
        if (bars.length === 0) throw new Error('No K-line data returned')
        this.storeBars(assetId, period, bars, 'akshare')
        return bars.length
      } catch (e: any) {
        lastErr = e
        if (attempt < MAX_RETRIES) {
          console.warn(`[KlineService] syncKlineForAsset ${symbol} attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}. Retrying...`)
          await sleep(2000 * attempt)
        }
      }
    }
    throw new Error(`${symbol} K线获取失败: ${lastErr?.message || lastErr}`)
  }

  /**
   * Write K-line bars to DB with INSERT OR REPLACE.
   */
  storeBars(
    assetId: string,
    period: string,
    bars: Array<{
      bar_time: string
      open: number
      high: number
      low: number
      close: number
      volume: number | null | undefined
    }>,
    source: string
  ): void {
    const db = getDb()
    const insertKline = db.prepare(
      `INSERT OR REPLACE INTO kline_bars (id, asset_id, period, open, high, low, close, volume, bar_time, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const bar of bars) {
      const id = `${assetId}_${bar.bar_time}_${period}`
      insertKline.run(id, assetId, period, bar.open, bar.high, bar.low, bar.close, bar.volume ?? 0, bar.bar_time, source)
    }
  }

  private makeResult(
    bars: KlineBar[],
    source: KlineFetchResult['source'],
    cacheHit: boolean,
    providerStatus: KlineFetchResult['providerStatus'],
    errorCode: KlineErrorCode,
    errorMessage?: string
  ): KlineFetchResult {
    return { bars, source, cacheHit, providerStatus, errorCode, errorMessage }
  }
}
