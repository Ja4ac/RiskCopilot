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

  // Auto-fetch stock listings on first launch (if table is empty)
  try {
    const { getStockListingService } = await import('../services/stock-listing.service')
    const svc = getStockListingService()
    if (!svc.hasListings()) {
      console.log('[MAIN] Stock listings empty, fetching from East Money...')
      const result = await svc.refreshListings()
      console.log('[MAIN] Listings fetched:', result)
    }
  } catch (e) {
    console.error('[MAIN] Failed to fetch stock listings:', e)
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
