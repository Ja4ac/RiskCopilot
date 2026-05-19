import type {
  PortfolioSummary,
  RiskSummary,
  PositionWithAsset,
  NewsWithAsset,
  InstrumentSnapshot,
  DataQualityStatus,
  AIAnswerSchema,
} from '../../shared/types/database'

/**
 * AIContextBuilder — assembles rich, structured context for AI queries.
 *
 * Design principles:
 *   - No "training" — only RAG-style context assembly
   *   - Include portfolio summary, risk metrics, positions, news, and instrument snapshots
   *   - Mark every datum with source and freshness
   *   - Exclude sensitive fields (account IDs, API keys, raw trade details)
 */
export interface AIContextEnvelope {
  portfolio_summary: PortfolioSummary
  risk_metrics: RiskSummary
  positions: Array<{
    symbol: string
    name: string
    asset_type: string
    market: string
    weight_pct: number
    market_value: number
    unrealized_pnl: number
    total_return_pct: number
    risk_tag: string
    quote_price: number | null
    quote_change_pct: number | null
  }>
  latest_news: Array<{
    title: string
    summary: string | null
    source: string
    published_at: string
    sentiment: number | null
    importance: string
    linked_assets: string[]
  }>
  instrument_snapshots: InstrumentSnapshot[]
  data_quality: DataQualityStatus
  query_intent?: string
}

export class AIContextBuilder {
  /**
   * Build a sanitized context envelope for AI consumption.
   */
  build(
    portfolioSummary: PortfolioSummary,
    riskMetrics: RiskSummary,
    positions: PositionWithAsset[],
    news: NewsWithAsset[],
    snapshots: InstrumentSnapshot[],
    quality: DataQualityStatus
  ): AIContextEnvelope {
    return {
      portfolio_summary: portfolioSummary,
      risk_metrics: riskMetrics,
      positions: positions.map((p) => ({
        symbol: p.asset.symbol,
        name: p.asset.name,
        asset_type: p.asset.asset_type,
        market: p.asset.market,
        weight_pct: Math.round(p.weight_pct * 100) / 100,
        market_value: Math.round(p.market_value * 100) / 100,
        unrealized_pnl: Math.round(p.unrealized_pnl * 100) / 100,
        total_return_pct: Math.round(p.total_return_pct * 100) / 100,
        risk_tag: p.risk_tag,
        quote_price: p.quote?.price ?? null,
        quote_change_pct: p.quote?.change_pct ?? null,
      })),
      latest_news: news.map((n) => ({
        title: n.title,
        summary: n.summary,
        source: n.source,
        published_at: n.published_at,
        sentiment: n.sentiment,
        importance: n.importance,
        linked_assets: n.linked_assets.map((la) => la.asset_symbol),
      })),
      instrument_snapshots: snapshots,
      data_quality: quality,
    }
  }

  /**
   * Render context envelope into a markdown prompt snippet.
   */
  renderPrompt(context: AIContextEnvelope, userQuery: string): string {
    const ps = context.portfolio_summary
    const rm = context.risk_metrics

    let prompt = `## 用户问题\n${userQuery}\n\n`

    prompt += `## 组合概览\n`
    prompt += `- 总资产: ¥${ps.total_market_value.toLocaleString('zh-CN')} (${ps.position_count} 个持仓)\n`
    prompt += `- 累计收益: ¥${ps.cumulative_pnl.toLocaleString('zh-CN')} (${(ps.cumulative_return_pct * 100).toFixed(2)}%)\n`
    prompt += `- 今日收益: ¥${ps.today_pnl.toLocaleString('zh-CN')} (${(ps.today_pnl_pct * 100).toFixed(2)}%)\n\n`

    prompt += `## 风险指标\n`
    prompt += `- 风险评分: ${rm.risk_score}/100 (${rm.risk_level})\n`
    prompt += `- 健康评分: ${rm.health_score}/100\n`
    prompt += `- 波动率: ${(rm.volatility * 100).toFixed(2)}%\n`
    prompt += `- 最大回撤: ${(rm.max_drawdown * 100).toFixed(2)}%\n`
    prompt += `- 夏普比率: ${rm.sharpe_ratio.toFixed(2)}\n`
    prompt += `- Beta: ${rm.beta.toFixed(2)}\n\n`

    if (context.positions.length > 0) {
      prompt += `## 持仓明细\n`
      for (const p of context.positions) {
        prompt += `- ${p.name} (${p.symbol}): 权重 ${p.weight_pct}%, 市值 ¥${p.market_value.toLocaleString('zh-CN')}, 收益 ${p.total_return_pct}%\n`
      }
      prompt += `\n`
    }

    if (context.latest_news.length > 0) {
      prompt += `## 最新资讯 (${context.latest_news.length} 条)\n`
      for (const n of context.latest_news.slice(0, 5)) {
        prompt += `- [${n.source}] ${n.title}\n`
      }
      prompt += `\n`
    }

    prompt += `## 数据质量\n`
    prompt += `- 来源: ${context.data_quality.source}\n`
    prompt += `- 更新时间: ${context.data_quality.source_time}\n`
    prompt += `- 置信度: ${context.data_quality.confidence}\n\n`

    prompt += `## 回答要求\n`
    prompt += `1. 使用中文回答。\n`
    prompt += `2. 区分事实、推断和建议。\n`
    prompt += `3. 对每项分析标注数据来源和时间。\n`
    prompt += `4. 禁止给出“必涨、稳赚、确定买入”等确定性结论。\n`
    prompt += `5. 最后必须加上免责声明：以上分析仅供参考，不构成投资建议。\n`

    return prompt
  }
}

// Singleton
let builder: AIContextBuilder | null = null
export function getAIContextBuilder(): AIContextBuilder {
  if (!builder) builder = new AIContextBuilder()
  return builder
}
