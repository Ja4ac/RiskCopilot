import type { AIChatContext, AIChatMessage, NewsWithAsset, RiskSummary, ReportType } from '../../../shared/types/database'

const DISCLAIMER = '\n\n---\n\n> ⚠️ **免责声明**：以上分析仅供参考，不构成投资建议。请根据自身风险承受能力做出决策。市场有风险，投资需谨慎。'

/**
 * Mock AI provider — generates rule-based responses, same logic as the old AIService.
 * Used when no real AI provider is configured.
 */
export class MockAIProvider {
  readonly id = 'mock-ai'
  readonly provider = 'mock'
  readonly name = '本地模拟AI'
  readonly model = 'mock-model'

  async chat(message: string, context: AIChatContext): Promise<string> {
    const msg = message.toLowerCase()
    if (this.matchKeywords(msg, ['波动', '风险', '风险多大', '安全吗', '稳'])) return this.respondRisk(context)
    if (this.matchKeywords(msg, ['持仓', '仓位', '配置', '组合', '有哪些', '列表'])) return this.respondPortfolio(context)
    if (this.matchKeywords(msg, ['涨', '跌', '行情', '走势', '趋势', '技术'])) return this.respondTrend(context)
    if (this.matchKeywords(msg, ['建议', '怎么操作', '买什么', '卖什么', '调仓'])) return this.respondAdvice(context)
    if (this.matchKeywords(msg, ['新闻', '消息', '事件', '热点'])) return this.respondNews(context)
    if (this.matchKeywords(msg, ['你好', 'hello', 'hi', '介绍', '功能'])) return this.respondGreeting(context)
    return this.respondGeneral(context)
  }

  async summarizeNews(newsIds: string[]): Promise<string> {
    return 'Mock AI: 新闻摘要功能。连接真实 AI 服务后，可获得基于内容的智能摘要分析。'
  }

  async explainRisk(riskData: RiskSummary): Promise<string> {
    const level = riskData.risk_level === 'critical' ? '极高风险' :
      riskData.risk_level === 'high' ? '高风险' :
      riskData.risk_level === 'medium' ? '中等风险' : '低风险'

    return `## 📊 风险指标解读

**综合风险评分**：${riskData.risk_score} 分（${level}）

| 指标 | 数值 |
|------|------|
| 波动率 | ${(riskData.volatility * 100).toFixed(2)}% |
| 最大回撤 | ${(riskData.max_drawdown * 100).toFixed(2)}% |
| 夏普比率 | ${riskData.sharpe_ratio.toFixed(2)} |
| Beta | ${riskData.beta.toFixed(2)} |
| VaR(95%) | ¥${riskData.var_95.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} |
${DISCLAIMER}`
  }

  async generateReport(type: ReportType): Promise<string> {
    const titles: Record<string, string> = {
      daily: '每日风险报告', weekly: '周度风险管理报告', monthly: '月度风险管理报告',
      risk_assessment: '风险评估报告', asset_analysis: '资产分析报告', fund_comparison: '基金对比报告',
    }
    return `# ${titles[type] || '风险管理报告'}\n\nMock AI: 报告生成功能。连接真实 AI 服务后，可获得完整的分析报告。\n${DISCLAIMER}`
  }

  async healthCheck(): Promise<boolean> {
    return true
  }

  // ---- Private response methods (subset of original AIService) ----
  private respondRisk(ctx: AIChatContext): string {
    const { risk_metrics, portfolio_summary } = ctx
    return `## 🔍 当前风险分析

**综合风险评分**：${risk_metrics.risk_score} 分（${this.riskLevelLabel(risk_metrics.risk_level)}）

- **年化波动率**：${(risk_metrics.volatility * 100).toFixed(2)}%
- **最大回撤**：${(risk_metrics.max_drawdown * 100).toFixed(2)}%
- **夏普比率**：${risk_metrics.sharpe_ratio.toFixed(2)}
- **Beta系数**：${risk_metrics.beta.toFixed(2)}
- **VaR (95%)**：¥${risk_metrics.var_95.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}

${DISCLAIMER}`
  }

  private respondPortfolio(ctx: AIChatContext): string {
    const { portfolio_summary, positions } = ctx
    const posList = positions.slice(0, 10).map((p, i) =>
      `${i + 1}. **${p.asset.name}** (${p.asset.symbol}) | 市值 ¥${p.market_value.toLocaleString('zh-CN')} | 权重 ${p.weight_pct.toFixed(1)}%`
    ).join('\n')
    return `## 📋 持仓概览\n总市值：¥${portfolio_summary.total_market_value.toLocaleString('zh-CN')}\n\n${posList}\n${DISCLAIMER}`
  }

  private respondTrend(ctx: AIChatContext): string {
    return `## 📈 市场走势\n基于当前数据，组合趋势分析如下。连接真实行情源可获得更准确的市场分析。\n${DISCLAIMER}`
  }

  private respondAdvice(ctx: AIChatContext): string {
    return `## 💡 投资建议\n建议基于量化指标综合分析，关注集中度和波动率变化。\n${DISCLAIMER}`
  }

  private respondNews(ctx: AIChatContext): string {
    return `## 📰 新闻动态\n当前使用模拟数据。连接真实舆情源后可获取最新新闻分析。\n${DISCLAIMER}`
  }

  private respondGreeting(ctx: AIChatContext): string {
    const { portfolio_summary } = ctx
    return `您好！我是 RiskPilot AI 助手。
当前组合概况：**${portfolio_summary.position_count}** 个标的，总市值 ¥${portfolio_summary.total_market_value.toLocaleString('zh-CN')}，风险等级 **${this.riskLevelLabel(portfolio_summary.risk_level)}**。
您可以询问持仓、风险、行情和投资建议。${DISCLAIMER}`
  }

  private respondGeneral(ctx: AIChatContext): string {
    const { portfolio_summary, risk_metrics } = ctx
    return `根据当前数据，您的投资组合表现如下：
- 持仓数量：${portfolio_summary.position_count} 个
- 总市值：¥${portfolio_summary.total_market_value.toLocaleString('zh-CN')}
- 风险评分：${risk_metrics.risk_score} 分 (${this.riskLevelLabel(risk_metrics.risk_level)})
${DISCLAIMER}`
  }

  private matchKeywords(text: string, keywords: string[]): boolean {
    return keywords.some((kw) => text.includes(kw))
  }

  private riskLevelLabel(level: string): string {
    switch (level) {
      case 'low': return '低风险 ✅'
      case 'medium': return '中风险 ⚡'
      case 'high': return '高风险 ⚠️'
      case 'critical': return '极高风险 🚨'
      default: return level
    }
  }
}
