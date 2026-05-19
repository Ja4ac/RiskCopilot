/// <reference types="vite/client" />

export interface RiskPilotAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
}

declare global {
  interface Window {
    riskPilot: RiskPilotAPI
  }
}
