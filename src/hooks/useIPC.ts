// ============================================================
// IPC invocation helper — safe, typed, with error handling
// ============================================================

interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

function getRiskPilot() {
  if (typeof window === 'undefined' || !window.riskPilot) {
    return null
  }
  return window.riskPilot
}

/**
 * Invoke IPC channel and unwrap the {success, data} envelope.
 * Returns data on success, throws on failure or missing bridge.
 */
export async function ipcInvoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const api = getRiskPilot()
  if (!api) {
    throw new Error('IPC桥接未就绪 — 请在 Electron 环境中运行此应用')
  }

  const result = (await api.invoke(channel, ...args)) as IpcResponse<T>

  if (!result) {
    throw new Error(`IPC 调用失败: 通道 "${channel}" 无响应`)
  }

  if (!result.success) {
    throw new Error(result.error || `IPC 调用失败: ${channel}`)
  }

  return result.data as T
}

export { getRiskPilot }
export type { IpcResponse }
