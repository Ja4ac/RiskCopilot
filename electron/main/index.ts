import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { initDatabase, closeDatabase } from '../db'
import { startDataProxy, stopDataProxy } from '../services/data-proxy'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

const isDev = !app.isPackaged

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    title: 'RiskPilot - 股票基金智能风险管理终端',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) mainWindow?.webContents.openDevTools()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Initialize database (non-fatal — window still opens if it fails)
  try {
    await initDatabase()
  } catch (e) {
    console.error('[MAIN] Database init failed:', e)
  }

  // Start Python data proxy for K-line data (non-fatal)
  try {
    await startDataProxy()
  } catch (e) {
    console.error('[MAIN] Data proxy start failed:', e)
  }

  // Register all IPC handlers (graceful failure — window still opens)
  try {
    const { registerAllHandlers } = await import('../ipc')
    registerAllHandlers()
  } catch (e) {
    console.error('[MAIN] Failed to register IPC handlers:', e)
  }

  // Start market sync engine
  try {
    const { getMarketSyncEngine } = await import('../services/market-sync')
    getMarketSyncEngine().start()
  } catch (e) {
    console.error('[MAIN] Market sync engine start failed:', e)
  }

  // Refresh stock+fund listings at startup (ensures complete data)
  try {
    const { getStockListingService } = await import('../services/stock-listing.service')
    const svc = getStockListingService()
    const result = await svc.refreshListings()
    console.log(`[MAIN] Listings refreshed: stocks=${result.stocks} funds=${result.funds}`)
  } catch (e) {
    console.error('[MAIN] Failed to fetch stock listings:', e)
  }

  // Fix assets where stock_listings has a matching entry with different type/name
  console.log('[MAIN] Checking asset names & types vs stock_listings...')
  try {
    const { getDb } = await import('../db')
    const db = getDb()

    // Diagnostic: check symbols that have MULTIPLE stock_listings entries
    const multiSymbols = db.prepare(`
      SELECT symbol, COUNT(*) as cnt FROM stock_listings WHERE is_active = 1 GROUP BY symbol HAVING cnt > 1
    `).all() as { symbol: string; cnt: number }[]
    if (multiSymbols.length > 0) {
      console.log(`[MAIN] Found ${multiSymbols.length} symbols with multiple listings:`)
      for (const { symbol } of multiSymbols) {
        const listings = db.prepare(`
          SELECT market, name, asset_type FROM stock_listings WHERE symbol = ? AND is_active = 1
        `).all(symbol) as { market: string; name: string; asset_type: string }[]
        const asset = db.prepare(`SELECT market, asset_type, name FROM assets WHERE symbol = ?`).get(symbol) as { market: string; asset_type: string; name: string } | undefined
        console.log(`[MAIN]   ${symbol}: listings=${JSON.stringify(listings)} asset=${asset ? JSON.stringify(asset) : 'N/A'}`)
      }
    }

    const assets = db.prepare(`
      SELECT a.id, a.symbol, a.market, a.asset_type, a.name AS current_name FROM assets a
    `).all() as { id: string; symbol: string; market: string; asset_type: string; current_name: string }[]
    let nameFixed = 0
    let typeFixed = 0
    for (const asset of assets) {
      if (asset.current_name !== asset.symbol) continue // already has a real name

      let listing: { name: string; asset_type: string } | undefined

      // 1) Try symbol + market + active
      listing = db.prepare(`SELECT name, asset_type FROM stock_listings WHERE symbol = ? AND market = ? AND is_active = 1 LIMIT 1`)
        .get(asset.symbol, asset.market) as any
      console.log(`[MAIN] DBG ${asset.symbol} mkt=${asset.market} type=${asset.asset_type} name="${asset.current_name}" → q1(active): ${listing ? listing.name + '/' + listing.asset_type : 'NOT FOUND'}`)

      // 2) Fund fallback: ignore market mismatch (OF vs SH)
      if (!listing && asset.asset_type === 'fund') {
        listing = db.prepare(`SELECT name, asset_type FROM stock_listings WHERE symbol = ? AND is_active = 1 AND asset_type = 'fund' LIMIT 1`)
          .get(asset.symbol) as any
        console.log(`[MAIN] DBG ${asset.symbol} → q2(fund any mkt): ${listing ? listing.name + '/' + listing.asset_type : 'NOT FOUND'}`)
      }

      // 3) Stock fallback: try inactive listings too
      if (!listing && asset.asset_type !== 'fund') {
        listing = db.prepare(`SELECT name, asset_type FROM stock_listings WHERE symbol = ? AND market = ? LIMIT 1`)
          .get(asset.symbol, asset.market) as any
        console.log(`[MAIN] DBG ${asset.symbol} → q3(inactive allowed): ${listing ? listing.name + '/' + listing.asset_type : 'NOT FOUND'}`)
      }

      // 4) Last resort: any listing with this symbol that isn't a fund
      if (!listing && asset.asset_type !== 'fund') {
        listing = db.prepare(`SELECT name, asset_type FROM stock_listings WHERE symbol = ? AND asset_type != 'fund' LIMIT 1`)
          .get(asset.symbol) as any
        console.log(`[MAIN] DBG ${asset.symbol} → q4(stock any mkt): ${listing ? listing.name + '/' + listing.asset_type : 'NOT FOUND'}`)
      }

      // 5) Proxy fallback: akshare individual stock lookup
      if (!listing && asset.current_name === asset.symbol) {
        try {
          const { resolveNameFromProxy } = await import('../services/data-proxy')
          const proxyName = await resolveNameFromProxy(asset.symbol)
          if (proxyName) {
            listing = { name: proxyName, asset_type: asset.asset_type || 'stock' }
            console.log(`[MAIN] DBG ${asset.symbol} → q5(proxy): ${proxyName}`)
          }
        } catch { /* proxy fallback non-blocking */ }
      }

      if (!listing) continue

      if (listing.asset_type !== asset.asset_type || listing.name !== asset.current_name) {
        db.prepare(`UPDATE assets SET asset_type = ?, name = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
          .run(listing.asset_type, listing.name, asset.id)
        typeFixed += listing.asset_type !== asset.asset_type ? 1 : 0
        nameFixed += listing.name !== asset.current_name ? 1 : 0
        console.log(`[MAIN] Fixed: ${asset.symbol} (${asset.market}) type=${asset.asset_type}→${listing.asset_type} name="${asset.current_name}"→"${listing.name}"`)
      }
    }
    if (typeFixed > 0 || nameFixed > 0) console.log(`[MAIN] Auto-fixed ${typeFixed} types, ${nameFixed} names`)
    else console.log('[MAIN] No fixes needed')
  } catch (e) {
    console.warn('[MAIN] Asset name/type fix failed:', e)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopDataProxy()
  if (process.platform !== 'darwin') {
    closeDatabase()
    app.quit()
  }
})
