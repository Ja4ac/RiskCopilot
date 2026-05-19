import { contextBridge, ipcRenderer } from 'electron'

console.log('[PRELOAD] Starting preload script...')

const api = {
  invoke: (channel: string, ...args: unknown[]) => {
    console.log('[PRELOAD] invoke:', channel)
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('riskPilot', api)
console.log('[PRELOAD] riskPilot exposed via contextBridge')
