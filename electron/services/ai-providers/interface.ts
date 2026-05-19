import type { AIChatContext } from '../../../shared/types/database'

export interface IAIProvider {
  readonly id: string
  readonly provider: string
  readonly name: string
  readonly model: string

  /** Send a chat message and get a response */
  chat(message: string, context: AIChatContext): Promise<string>

  /** Check if the provider is reachable */
  healthCheck(): Promise<boolean>
}
