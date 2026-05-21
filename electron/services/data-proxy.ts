import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { app } from 'electron'

let proxyProcess: ChildProcess | null = null
const PROXY_PORT = 18989
const PROXY_HOST = '127.0.0.1'

/**
 * Check if Python is available on the system.
 */
export function isPythonAvailable(): boolean {
  const { execSync } = require('child_process')
  const candidates = ['python', 'python3']
  if (process.platform === 'win32') {
    candidates.unshift('py') // Windows Python Launcher
  }
  for (const cmd of candidates) {
    try {
      const result = execSync(`${cmd} --version`, { encoding: 'utf-8', timeout: 5000, shell: true })
      console.log(`[DataProxy] Python found (${cmd}):`, result.trim())
      return true
    } catch (e: any) {
      console.log(`[DataProxy] Python check failed for "${cmd}":`, e.message?.trim() || 'unknown error')
      // try next
    }
  }
  // On Windows, also check common installation directories
  if (process.platform === 'win32') {
    const fs = require('fs')
    const path = require('path')
    const commonPaths = [
      'C:\\Python311\\python.exe',
      'C:\\Python310\\python.exe',
      'C:\\Python39\\python.exe',
      'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
      'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
    ]
    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        console.log(`[DataProxy] Python found at: ${p}`)
        return true
      }
    }
  }
  return false
}

/**
 * Check if AKShare is installed.
 */
export function isAkshareAvailable(): boolean {
  const { execSync } = require('child_process')
  const pythonCmd = getPythonCmd()
  try {
    execSync(`${pythonCmd} -c "import akshare"`, { timeout: 5000, shell: true })
    return true
  } catch {
    return false
  }
}

/**
 * Get the Python executable command.
 */
function getPythonCmd(): string {
  const { execSync } = require('child_process')
  const candidates = ['python', 'python3']
  if (process.platform === 'win32') {
    candidates.unshift('py')
  }
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { timeout: 2000, shell: true })
      return cmd
    } catch {
      // try next
    }
  }
  // On Windows, check common installation directories
  if (process.platform === 'win32') {
    const fs = require('fs')
    const commonPaths = [
      'C:\\Python311\\python.exe',
      'C:\\Python310\\python.exe',
      'C:\\Python39\\python.exe',
      'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
      'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
    ]
    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        return `"${p}"`
      }
    }
  }
  return 'python'
}

/**
 * Start the Python data proxy service.
 */
export async function startDataProxy(): Promise<boolean> {
  if (proxyProcess) {
    console.log('[DataProxy] Already running')
    return true
  }

  if (!isPythonAvailable()) {
    console.warn('[DataProxy] Python not found. K-line data will be unavailable.')
    console.warn('[DataProxy] To enable K-line data, install Python and run: pip install -r python-proxy/requirements.txt')
    return false
  }

  const pythonCmd = getPythonCmd()
  const scriptPath = join(app.getAppPath(), 'python-proxy', 'main.py')

  console.log(`[DataProxy] Starting proxy: ${pythonCmd} ${scriptPath}`)

  return new Promise((resolve) => {
    proxyProcess = spawn(pythonCmd, [scriptPath, '--port', String(PROXY_PORT), '--host', PROXY_HOST], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    proxyProcess.stdout?.on('data', (data: Buffer) => {
      console.log('[DataProxy]', data.toString().trim())
    })

    proxyProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[DataProxy]', data.toString().trim())
    })

    proxyProcess.on('error', (err) => {
      console.error('[DataProxy] Failed to start:', err.message)
      proxyProcess = null
      resolve(false)
    })

    proxyProcess.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[DataProxy] Exited with code ${code}`)
      }
      proxyProcess = null
    })

    // Wait for service to be ready (give more time on Windows)
    setTimeout(() => {
      // Quick health check with retry
      const tryHealthCheck = async (attempt: number): Promise<void> => {
        try {
          const res = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/health`, { 
            signal: AbortSignal.timeout(5000),
            headers: { 'Accept': 'application/json' }
          })
          if (res.ok) {
            console.log('[DataProxy] Health check passed')
            resolve(true)
            return
          }
          console.warn(`[DataProxy] Health check HTTP ${res.status}`)
          if (attempt < 3) {
            setTimeout(() => tryHealthCheck(attempt + 1), 2000)
          } else {
            resolve(false)
          }
        } catch (err: any) {
          console.warn(`[DataProxy] Health check error (attempt ${attempt + 1}):`, err.message)
          if (attempt < 3) {
            setTimeout(() => tryHealthCheck(attempt + 1), 2000)
          } else {
            resolve(false)
          }
        }
      }
      tryHealthCheck(0)
    }, 5000)
  })
}

/**
 * Stop the Python data proxy service.
 */
export function stopDataProxy(): void {
  if (proxyProcess) {
    console.log('[DataProxy] Stopping proxy...')
    proxyProcess.kill('SIGTERM')
    proxyProcess = null
  }
}

/**
 * Get the proxy base URL.
 */
export function getProxyUrl(): string {
  return `http://${PROXY_HOST}:${PROXY_PORT}`
}

/**
 * Check if proxy is running.
 */
export async function isProxyRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Fetch K-line data from the proxy.
 */
export async function fetchKlineFromProxy(
  symbol: string,
  market: string,
  period: string,
  count: number = 120,
  adjust: string = 'qfq'
): Promise<Array<{
  bar_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount?: number
}>> {
  const url = new URL(`${getProxyUrl()}/kline`)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('market', market)
  url.searchParams.set('period', period)
  url.searchParams.set('count', String(count))
  url.searchParams.set('adjust', adjust)

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) })
  if (!res.ok) {
    throw new Error(`Proxy HTTP ${res.status}: ${await res.text()}`)
  }

  const json = (await res.json()) as { success: boolean; data: any[]; error?: string }
  if (!json.success) {
    throw new Error(json.error || 'Proxy returned failure')
  }
  return json.data
}

/**
 * Fetch fund NAV from the proxy.
 */
export async function fetchFundNavFromProxy(
  symbol: string,
  date?: string
): Promise<{
  symbol: string
  nav: number
  nav_date: string
  name: string | null
}> {
  const url = new URL(`${getProxyUrl()}/fund/nav`)
  url.searchParams.set('symbol', symbol)
  if (date) {
    url.searchParams.set('date', date)
  }

  // Retry up to 3 times with increasing timeout
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const timeoutMs = attempt === 1 ? 30000 : attempt === 2 ? 45000 : 60000
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) {
        throw new Error(`Proxy HTTP ${res.status}: ${await res.text()}`)
      }

      const json = (await res.json()) as {
        success: boolean
        data: { symbol: string; nav: number; nav_date: string; name: string | null }
        error?: string
      }
      if (!json.success) {
        throw new Error(json.error || 'Proxy returned failure')
      }
      return json.data
    } catch (e: any) {
      lastError = e
      console.warn(`[DataProxy] fetchFundNavFromProxy attempt ${attempt} failed for ${symbol}: ${e.message}`)
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }
  throw lastError || new Error(`Failed to fetch NAV for ${symbol} after 3 attempts`)
}

/**
 * Fetch fund NAV history from the proxy.
 */
export async function fetchFundNavHistoryFromProxy(
  symbol: string,
  startDate?: string,
  endDate?: string
): Promise<{
  symbol: string
  history: { nav_date: string; nav: number }[]
  count: number
}> {
  const url = new URL(`${getProxyUrl()}/fund/nav/history`)
  url.searchParams.set('symbol', symbol)
  if (startDate) {
    url.searchParams.set('start_date', startDate)
  }
  if (endDate) {
    url.searchParams.set('end_date', endDate)
  }

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const timeoutMs = attempt === 1 ? 30000 : attempt === 2 ? 45000 : 60000
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) {
        throw new Error(`Proxy HTTP ${res.status}: ${await res.text()}`)
      }

      const json = (await res.json()) as {
        success: boolean
        data: { symbol: string; history: { nav_date: string; nav: number }[]; count: number }
        error?: string
      }
      if (!json.success) {
        throw new Error(json.error || 'Proxy returned failure')
      }
      return json.data
    } catch (e: any) {
      lastError = e
      console.warn(`[DataProxy] fetchFundNavHistoryFromProxy attempt ${attempt} failed for ${symbol}: ${e.message}`)
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }
  throw lastError || new Error(`Failed to fetch NAV history for ${symbol} after 3 attempts`)
}

/**
 * Resolve a stock/fund name by symbol via the proxy (akshare fallback).
 */
export async function resolveNameFromProxy(
  symbol: string
): Promise<string | null> {
  try {
    const url = new URL(`${getProxyUrl()}/resolve/name`)
    url.searchParams.set('symbol', symbol)
    console.log(`[resolveNameFromProxy] Fetching name for ${symbol}...`)
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60000) })
    if (!res.ok) {
      console.warn(`[resolveNameFromProxy] Proxy returned ${res.status} for ${symbol}`)
      return null
    }
    const json = (await res.json()) as { success: boolean; data?: { name: string }; error?: string }
    const name = json.success && json.data ? json.data.name : null
    console.log(`[resolveNameFromProxy] ${symbol} → ${name ?? 'NOT FOUND'}`)
    return name
  } catch (e: any) {
    console.warn(`[resolveNameFromProxy] Failed for ${symbol}: ${e.message}`)
    return null
  }
}
