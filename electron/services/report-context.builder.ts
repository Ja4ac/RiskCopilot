import { v4 as uuid } from 'uuid'
import type {
  PortfolioSummary,
  RiskSummary,
  PositionWithAsset,
  NewsWithAsset,
  ReportType,
  Report,
} from '../../shared/types/database'

/**
 * ReportContextSnapshot — immutable snapshot of data at report generation time.
 */
export interface ReportContextSnapshot {
  generated_at: string
  portfolio_summary: PortfolioSummary
  risk_metrics: RiskSummary
  positions: Array<{
    symbol: string
    name: string
    asset_type: string
    weight_pct: number
    market_value: number
    unrealized_pnl: number
    total_return_pct: number
  }>
  news_headlines: Array<{
    title: string
    source: string
    published_at: string
    sentiment: number | null
  }>
  data_sources: string[]
  limitations: string[]
}

/**
 * ReportContextBuilder — single pipeline for report generation.
 *
 * Flow:
 *   1. Build context snapshot from current data
 *   2. Generate AI content (via active provider)
 *   3. Persist report with snapshot
 */
export class ReportContextBuilder {
  /**
   * Build a snapshot of the current portfolio state.
   */
  buildSnapshot(
    portfolioSummary: PortfolioSummary,
    riskMetrics: RiskSummary,
    positions: PositionWithAsset[],
    news: NewsWithAsset[],
    dataSources: string[]
  ): ReportContextSnapshot {
    return {
      generated_at: new Date().toISOString(),
      portfolio_summary: portfolioSummary,
      risk_metrics: riskMetrics,
      positions: positions.map((p) => ({
        symbol: p.asset.symbol,
        name: p.asset.name,
        asset_type: p.asset.asset_type,
        weight_pct: Math.round(p.weight_pct * 100) / 100,
        market_value: Math.round(p.market_value * 100) / 100,
        unrealized_pnl: Math.round(p.unrealized_pnl * 100) / 100,
        total_return_pct: Math.round(p.total_return_pct * 100) / 100,
      })),
      news_headlines: news.slice(0, 10).map((n) => ({
        title: n.title,
        source: n.source,
        published_at: n.published_at,
        sentiment: n.sentiment,
      })),
      data_sources: dataSources,
      limitations: [
        '数据来源于免费公开接口，可能存在延迟或缺失',
        '历史表现不代表未来收益',
        'AI 分析基于有限上下文，可能存在偏差',
      ],
    }
  }

  /**
   * Render a system prompt for report generation.
   */
  renderSystemPrompt(type: ReportType, snapshot: ReportContextSnapshot): string {
    const ps = snapshot.portfolio_summary
    const rm = snapshot.risk_metrics

    let prompt = `你是一位专业的投资顾问，正在为用户生成一份${this.typeLabel(type)}。\n\n`

    prompt += `## 报告要求\n`
    prompt += `- 使用 Markdown 格式\n`
    prompt += `- 包含：概览、历史表现、现状分析、风险变化、新闻事件、观察清单、总结\n`
    prompt += `- 所有数据必须标注来源和时间\n`
    prompt += `- 禁止给出确定性投资建议（如“必涨”“稳赚”）\n\n`

    prompt += `## 组合概览 (${snapshot.generated_at})\n`
    prompt += `- 总资产: ¥${ps.total_market_value.toLocaleString('zh-CN')}\n`
    prompt += `- 持仓数: ${ps.position_count}\n`
    prompt += `- 累计收益: ${(ps.cumulative_return_pct * 100).toFixed(2)}%\n`
    prompt += `- 风险评分: ${rm.risk_score}/100 (${rm.risk_level})\n`
    prompt += `- 健康评分: ${rm.health_score}/100\n\n`

    prompt += `## 风险指标\n`
    prompt += `- 波动率: ${(rm.volatility * 100).toFixed(2)}%\n`
    prompt += `- 最大回撤: ${(rm.max_drawdown * 100).toFixed(2)}%\n`
    prompt += `- 夏普比率: ${rm.sharpe_ratio.toFixed(2)}\n`
    prompt += `- Beta: ${rm.beta.toFixed(2)}\n\n`

    if (snapshot.positions.length > 0) {
      prompt += `## 主要持仓\n`
      for (const p of snapshot.positions.slice(0, 10)) {
        prompt += `- ${p.name} (${p.symbol}): ${p.weight_pct}%, 收益 ${p.total_return_pct}%\n`
      }
      prompt += `\n`
    }

    if (snapshot.news_headlines.length > 0) {
      prompt += `## 近期资讯\n`
      for (const n of snapshot.news_headlines) {
        prompt += `- [${n.source}] ${n.title}\n`
      }
      prompt += `\n`
    }

    prompt += `## 免责声明\n`
    prompt += `以上分析仅供参考，不构成投资建议。投资有风险，决策需谨慎。\n`

    return prompt
  }

  private typeLabel(type: ReportType): string {
    const labels: Record<ReportType, string> = {
      daily: '日报',
      weekly: '周报',
      monthly: '月报',
      risk_assessment: '风险评估报告',
      asset_analysis: '资产分析报告',
      fund_comparison: '基金对比报告',
    }
    return labels[type] || '投资报告'
  }
}

// Singleton
let builder: ReportContextBuilder | null = null
export function getReportContextBuilder(): ReportContextBuilder {
  if (!builder) builder = new ReportContextBuilder()
  return builder
}
