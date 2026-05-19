import type { AIChatContext } from '../../../shared/types/database'

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * OpenAI-compatible AI provider.
 * Works with OpenAI, DeepSeek, and any other API that follows the chat completions format.
 */
export class OpenAIProvider {
  readonly id: string
  readonly provider: string
  readonly name: string
  readonly model: string
  private baseUrl: string
  private apiKey: string
  private timeout: number

  constructor(id: string, name: string, baseUrl: string, apiKey: string, model: string, timeout = 30000) {
    this.id = id
    this.provider = 'openai'
    this.name = name
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.model = model
    this.timeout = timeout
  }

  async chat(message: string, context: AIChatContext): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(context)
    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ]

    const resp = await this.fetchTimeout(`${this.baseUrl}/chat/completions`, this.timeout, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
      }),
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`AI 服务返回错误 ${resp.status}: ${body.slice(0, 200)}`)
    }

    const json = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
    return json.choices?.[0]?.message?.content || '(AI 未返回有效响应)'
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await this.fetchTimeout(
        `${this.baseUrl}/chat/completions`, this.timeout,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
        }
      )
      return resp.ok || resp.status === 400 // 400 means auth works but body wrong
    } catch {
      return false
    }
  }

  /**
   * Build sanitized system prompt — only sends authorized summary data, no raw positions.
   */
  private buildSystemPrompt(ctx: AIChatContext): string {
    const { portfolio_summary, risk_metrics } = ctx
    return `你是 RiskPilot 风险管理助手的 AI 后端。

**当前投资组合摘要（已脱敏）：**
- 持仓数量：${portfolio_summary.position_count} 个标的
- 总市值：约 ¥${Math.round(portfolio_summary.total_market_value / 10000)} 万
- 今日盈亏：¥${portfolio_summary.today_pnl.toLocaleString('zh-CN')}
- 累计收益率：${portfolio_summary.cumulative_return_pct.toFixed(2)}%
- 风险等级：${risk_metrics.risk_level} (${risk_metrics.risk_score}/100)

**风险指标：**
- 波动率：${(risk_metrics.volatility * 100).toFixed(2)}%
- 最大回撤：${(risk_metrics.max_drawdown * 100).toFixed(2)}%
- 夏普比率：${risk_metrics.sharpe_ratio.toFixed(2)}
- Beta：${risk_metrics.beta.toFixed(2)}
- VaR(95%)：¥${risk_metrics.var_95.toLocaleString('zh-CN')}

**重要约束：**
1. 不得生成"必涨""稳赚""确定买入"等确定性投资表述
2. 所有结论必须包含数据依据
3. 风险建议必须带免责声明
4. 区分事实、推断和建议
5. 用中文回答`
  }

  private fetchTimeout(url: string, ms: number, options?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
  }
}
