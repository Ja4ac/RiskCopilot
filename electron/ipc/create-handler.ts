// ============================================================
// Unified IPC handler factory — standardizes error handling,
// logging, parameter validation, and timing across all handlers.
// ============================================================

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'

// ── Types ──

interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

type AsyncHandler<T, P = undefined> = (
  event: IpcMainInvokeEvent,
  payload: P
) => Promise<T>

interface HandlerOptions {
  /** Channel name for logging (defaults to channel key) */
  label?: string
  /** Enable performance logging (default: true) */
  timing?: boolean
}

// ── Factory ──

/**
 * Register a typed IPC handler with unified error handling, logging, and timing.
 *
 * Usage:
 *   createIpcHandler(IPC_CHANNELS.PORTFOLIO_GET_POSITIONS, async () => {
 *     return portfolioService.getPositionsWithDetails()
 *   })
 *
 *   createIpcHandler(IPC_CHANNELS.PORTFOLIO_ADD_TRADE, async (_event, payload: IpcAddTradePayload) => {
 *     return portfolioService.addTrade(payload)
 *   })
 */
export function createIpcHandler<T, P = undefined>(
  channel: string,
  handler: AsyncHandler<T, P>,
  options?: HandlerOptions
): void {
  const label = options?.label ?? channel
  const enableTiming = options?.timing ?? true

  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: P): Promise<IpcResponse<T>> => {
    const start = enableTiming ? performance.now() : 0

    try {
      console.log(`[IPC →] ${label}`)
      if (payload !== undefined) {
        console.log(`[IPC →] ${label} payload:`, truncatePayload(payload))
      }

      const result = await handler(event, payload)

      if (enableTiming) {
        const elapsed = (performance.now() - start).toFixed(1)
        console.log(`[IPC ←] ${label} (${elapsed}ms)`)
      } else {
        console.log(`[IPC ←] ${label}`)
      }

      return { success: true, data: result as T }
    } catch (error: any) {
      const errorMessage = error?.message || String(error) || 'Unknown error'
      console.error(`[IPC ✗] ${label}: ${errorMessage}`)
      if (enableTiming) {
        console.error(`[IPC ✗] ${label} failed after ${(performance.now() - start).toFixed(1)}ms`)
      }
      return { success: false, error: errorMessage }
    }
  })
}

// ── Validation helper ──

type ValidationRule<P> = {
  check: (payload: P) => boolean
  message: string
}

/**
 * Wrap a handler with parameter validation rules.
 * Returns a handler function that validates before calling the original.
 *
 * Usage:
 *   createIpcHandler(
 *     IPC_CHANNELS.PORTFOLIO_ADD_TRADE,
 *     withValidation(
 *       (p: IpcAddTradePayload) => { ... },
 *       [
 *         { check: (p) => !!p.symbol, message: 'symbol 是必填参数' },
 *         { check: (p) => p.quantity > 0, message: '数量必须大于 0' },
 *       ]
 *     )
 *   )
 */
export function withValidation<P>(
  handler: AsyncHandler<any, P>,
  rules: ValidationRule<P>[]
): AsyncHandler<any, P> {
  return async (event, payload) => {
    for (const rule of rules) {
      if (!rule.check(payload)) {
        throw new Error(rule.message)
      }
    }
    return handler(event, payload)
  }
}

// ── Internal helpers ──

function truncatePayload(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return payload
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' && value.length > 100) {
      result[key] = value.slice(0, 100) + '...'
    } else {
      result[key] = value
    }
  }
  return result
}
