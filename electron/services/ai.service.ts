// ============================================================
// AIService — mock AI chat, news summary, risk explanation, reports
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../db'
import type {
  AIChatMessage,
  AIChatContext,
  ReportType,
  Report as ReportRecord,
  RiskSummary,
  NewsWithAsset
} from '../../shared/types/database'

const DISCLAIMER = '\n\n---\n\n> ⚠️ **免责声明**：以上分析仅供参考，不构成投资建议。请根据自身风险承受能力做出决策。市场有风险，投资需谨慎。'

export class AIService {
  /**
   * AI Chat — mock context-aware responses
   */
  chat(message: string, context: AIChatContext): AIChatMessage {
    const msg = message.toLowerCase()
    const response = this.generateResponse(msg, context)

    return {
      id: uuid(),
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
      type: 'chat'
    }
  }

  /**
   * Summarize specified news items into markdown
   */
  summarizeNews(newsIds: string[]): AIChatMessage {
    const db = getDb()

    if (newsIds.length === 0) {
      return {
        id: uuid(),
        role: 'assistant',
        content: '暂无新闻可总结。',
        timestamp: new Date().toISOString(),
        type: 'summary'
      }
    }

    const placeholders = newsIds.map(() => '?').join(',')
    const newsItems = db.prepare(`
      SELECT * FROM news_items WHERE id IN (${placeholders})
      ORDER BY importance DESC, published_at DESC
    `).all(...newsIds) as NewsWithAsset[]

    if (newsItems.length === 0) {
      return {
        id: uuid(),
        role: 'assistant',
        content: '未找到指定的新闻。',
        timestamp: new Date().toISOString(),
        type: 'summary'
      }
    }

    const highCount = newsItems.filter((n) => n.importance === 'high').length
    const mediumCount = newsItems.filter((n) => n.importance === 'medium').length
    const sentimentTotal = newsItems.reduce((s, n) => s + (n.sentiment ?? 0), 0)
    const avgSentiment = newsItems.length > 0 ? sentimentTotal / newsItems.length : 0

    let sentimentDesc = '中性'
    if (avgSentiment > 0.3) sentimentDesc = '偏正面'
    else if (avgSentiment > 0.1) sentimentDesc = '略偏正面'
    else if (avgSentiment < -0.3) sentimentDesc = '偏负面'
    else if (avgSentiment < -0.1) sentimentDesc = '略偏负面'

    const recentNewsMd = newsItems.slice(0, 5).map((n, i) =>
      `${i + 1}. **${n.title}** (重要性: ${this.importanceLabel(n.importance)}, 情感: ${n.sentiment !== null ? n.sentiment.toFixed(2) : 'N/A'})\n   ${n.summary ?? '无摘要'}`
    ).join('\n\n')

    const content = `## 📰 新闻摘要分析

**分析范围**：${newsItems.length} 条新闻
**重要性分布**：高 ${highCount} 条 | 中 ${mediumCount} 条 | 低 ${newsItems.length - highCount - mediumCount} 条
**整体情感倾向**：${sentimentDesc} (${avgSentiment.toFixed(2)})

---

### 🔴 重点关注

${recentNewsMd}

---

### 📊 综合分析

${this.generateNewsAnalysis(newsItems)}

---

### 💡 投资启示

- ${avgSentiment > 0 ? '近期市场情绪偏向正面，但需警惕短期过度乐观带来的回调风险' : '近期市场情绪偏谨慎，可关注优质标的的逢低布局机会'}
- ${highCount > 0 ? `有 ${highCount} 条高重要性新闻，建议密切关注相关标的的价格变动` : '暂无重大新闻事件，市场相对平稳'}
- 建议结合技术指标和基本面进行综合判断，避免单一事件驱动决策
${DISCLAIMER}`

    return {
      id: uuid(),
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      type: 'summary'
    }
  }

  /**
   * Explain risk metrics in natural language Chinese
   */
  explainRisk(riskData: RiskSummary): AIChatMessage {
    const content = `## 📊 风险指标解读

### 综合风险评分：**${riskData.risk_score} 分**（${this.riskLevelLabel(riskData.risk_level)}）

---

### 各项指标详解

| 指标 | 数值 | 解读 |
|------|------|------|
| **波动率** | ${(riskData.volatility * 100).toFixed(2)}% | ${this.volatilityExplanation(riskData.volatility)} |
| **最大回撤** | ${(riskData.max_drawdown * 100).toFixed(2)}% | ${this.drawdownExplanation(riskData.max_drawdown)} |
| **夏普比率** | ${riskData.sharpe_ratio.toFixed(2)} | ${this.sharpeExplanation(riskData.sharpe_ratio)} |
| **Beta系数** | ${riskData.beta.toFixed(2)} | ${this.betaExplanation(riskData.beta)} |
| **VaR(95%)** | ¥${riskData.var_95.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} | ${this.varExplanation(riskData.var_95)} |

---

### 子维度得分

| 维度 | 得分 | 评估 |
|------|------|------|
| 波动率得分 | ${riskData.volatility_score.toFixed(1)} | ${this.scoreLabel(riskData.volatility_score)} |
| 回撤得分 | ${riskData.drawdown_score.toFixed(1)} | ${this.scoreLabel(riskData.drawdown_score)} |
| 集中度得分 | ${riskData.concentration_score.toFixed(1)} | ${this.scoreLabel(riskData.concentration_score)} |
| 相关性得分 | ${riskData.correlation_score.toFixed(1)} | ${this.scoreLabel(riskData.correlation_score)} |
| 流动性得分 | ${riskData.liquidity_score.toFixed(1)} | ${this.scoreLabel(riskData.liquidity_score)} |
| 情绪得分 | ${riskData.sentiment_score.toFixed(1)} | ${this.scoreLabel(riskData.sentiment_score)} |
| 告警得分 | ${riskData.alert_score.toFixed(1)} | ${this.scoreLabel(riskData.alert_score)} |

---

### 📝 总结建议

${this.generateRiskSuggestions(riskData)}
${DISCLAIMER}`

    return {
      id: uuid(),
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      type: 'risk_explanation'
    }
  }

  /**
   * Generate markdown report by type
   * Follows spec structure: asset overview, performance, risk changes, contributors/detractors, news/events, risk points, watchlist
   */
  generateReport(type: ReportType, params?: Record<string, unknown>): AIChatMessage {
    const title = this.reportTitle(type)
    const now = new Date().toISOString()

    // Build context from DB
    const db = getDb()

    // Position data for report
    const positions = db.prepare(`
      SELECT p.*, a.symbol, a.name, a.asset_type, a.industry, a.market,
             q.price AS current_price, q.change_pct
      FROM positions p
      JOIN assets a ON p.asset_id = a.id
      LEFT JOIN (
        SELECT asset_id, price, change_pct FROM market_quotes
        WHERE id IN (SELECT MAX(id) FROM market_quotes GROUP BY asset_id)
      ) q ON p.asset_id = q.asset_id
      WHERE p.quantity != 0
    `).all() as any[]

    const totalValue = positions.reduce((s: number, p: any) => s + p.market_value, 0)
    const totalPnl = positions.reduce((s: number, p: any) => s + p.unrealized_pnl, 0)
    const topGainers = [...positions].sort((a: any, b: any) => (b.unrealized_pnl / (b.cost_amount || 1)) - (a.unrealized_pnl / (a.cost_amount || 1))).slice(0, 3)
    const topLosers = [...positions].sort((a: any, b: any) => (a.unrealized_pnl / (a.cost_amount || 1)) - (b.unrealized_pnl / (b.cost_amount || 1))).slice(0, 3)

    // Recent news (last 7 days)
    const recentNews = db.prepare(`
      SELECT * FROM news_items WHERE published_at > datetime('now', '-7 days')
      ORDER BY importance DESC, published_at DESC LIMIT 5
    `).all() as NewsWithAsset[]

    // Latest risk snapshot
    const riskSnapshot = db.prepare(`
      SELECT * FROM risk_snapshots ORDER BY calculated_at DESC LIMIT 1
    `).get() as any

    const content = `# ${title}

**生成日期**：${now.replace('T', ' ').substring(0, 16)}
**报告类型**：${this.reportTypeLabel(type)}

---

## 一、📊 资产概览

| 项目 | 数值 |
|------|------|
| 持仓数量 | ${positions.length} |
| 总市值 | ¥${totalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} |
| 总盈亏 | ¥${totalPnl.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} |
| 盈亏比例 | ${positions.reduce((s: number, p: any) => s + p.cost_amount, 0) > 0 ? ((totalPnl / positions.reduce((s: number, p: any) => s + p.cost_amount, 0)) * 100).toFixed(2) : '0.00'}% |

---

## 二、📈 业绩表现

### 最佳表现
${topGainers.length > 0 ? topGainers.map((p: any, i: number) =>
  `${i + 1}. **${p.name}** (${p.symbol}) - 盈亏 +${(p.unrealized_pnl / (p.cost_amount || 1) * 100).toFixed(2)}%, 市值 ¥${p.market_value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
).join('\n') : '暂无盈利持仓'}

### 拖累因素
${topLosers.length > 0 ? topLosers.map((p: any, i: number) =>
  `${i + 1}. **${p.name}** (${p.symbol}) - 盈亏 ${(p.unrealized_pnl / (p.cost_amount || 1) * 100).toFixed(2)}%, 市值 ¥${p.market_value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
).join('\n') : '暂无亏损持仓'}

---

## 三、🔍 风险变化

${riskSnapshot ? `
| 指标 | 当前值 | 
|------|--------|
| 风险评分 | **${riskSnapshot.risk_score}** |
| 波动率 | ${(riskSnapshot.volatility * 100).toFixed(2)}% |
| 最大回撤 | ${(riskSnapshot.max_drawdown * 100).toFixed(2)}% |
| 夏普比率 | ${riskSnapshot.sharpe_ratio.toFixed(2)} |
| VaR(95%) | ¥${riskSnapshot.var_95.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} |
| 集中度得分 | ${riskSnapshot.concentration_score.toFixed(1)} |
| 相关性得分 | ${riskSnapshot.correlation_score.toFixed(1)} |
` : '暂无风险快照数据'}

---

## 四、📰 新闻事件

${recentNews.length > 0 ? recentNews.map((n: NewsWithAsset) =>
  `- **[${this.importanceLabel(n.importance)}]** ${n.title}${n.sentiment !== null ? ` (情感: ${n.sentiment.toFixed(2)})` : ''}`
).join('\n') : '近期无重要新闻事件'}

---

## 五、⚠️ 风险点

${this.generateReportRiskPoints(positions, riskSnapshot)}

---

## 六、👀 观察清单

- ${positions.length > 5 ? '持仓数量较多（' + positions.length + '个），建议检查是否存在过度分散，可考虑集中持有优质标的' : '当前持仓数量合理，继续关注组合表现'}
- 关注${this.reportTypeLabel(type)}内的市场热点和行业轮动
- ${totalPnl < 0 ? '当前组合整体处于亏损状态，建议重新评估持仓逻辑和止损策略' : '当前组合整体盈利，建议根据风险指标适时调整仓位'}
- 定期检查告警规则是否触发，及时处理风险信号
- 保持对宏观政策、利率变化和地缘政治风险的关注
${DISCLAIMER}`

    // Note: Report persistence is handled by ReportService.
    // AIService only generates the markdown content.

    return {
      id: uuid(),
      role: 'assistant',
      content,
      timestamp: now,
      type: 'report'
    }
  }

  // ---- Private: Chat response generation ----

  private generateResponse(message: string, ctx: AIChatContext): string {
    const { portfolio_summary, risk_metrics, positions } = ctx

    // Detect question type
    if (this.matchKeywords(message, ['波动', '风险', '风险多大', '安全吗', '稳'])) {
      return this.respondRisk(ctx)
    }

    if (this.matchKeywords(message, ['持仓', '仓位', '配置', '组合', '有哪些', '列表'])) {
      return this.respondPortfolio(ctx)
    }

    if (this.matchKeywords(message, ['涨', '跌', '行情', '走势', '趋势', '技术'])) {
      return this.respondTrend(ctx)
    }

    if (this.matchKeywords(message, ['建议', '怎么操作', '买什么', '卖什么', '调仓'])) {
      return this.respondAdvice(ctx)
    }

    if (this.matchKeywords(message, ['新闻', '消息', '事件', '热点'])) {
      return this.respondNews(ctx)
    }

    if (this.matchKeywords(message, ['你好', 'hello', 'hi', '介绍', '功能'])) {
      return `您好！我是 RiskPilot AI 助手，可以帮您分析投资组合的风险状况。

当前您的投资组合概况：
- **持仓数量**：${portfolio_summary.position_count} 个标的
- **总市值**：¥${portfolio_summary.total_market_value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
- **今日盈亏**：¥${portfolio_summary.today_pnl.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} (${portfolio_summary.today_pnl_pct > 0 ? '+' : ''}${portfolio_summary.today_pnl_pct}%)
- **风险等级**：${this.riskLevelLabel(portfolio_summary.risk_level)} (${portfolio_summary.risk_score}分)

您可以问我：
- "当前风险状况如何？"
- "我的持仓有哪些？"
- "有什么投资建议？"
- "最近有什么重要新闻？"
${DISCLAIMER}`
    }

    // Default response
    return this.respondGeneral(ctx)
  }

  private respondRisk(ctx: AIChatContext): string {
    const { risk_metrics, portfolio_summary } = ctx
    const volPct = (risk_metrics.volatility * 100).toFixed(2)
    const ddPct = (risk_metrics.max_drawdown * 100).toFixed(2)
    const varAmount = risk_metrics.var_95.toLocaleString('zh-CN', { maximumFractionDigits: 0 })

    return `## 🔍 当前风险分析

**综合风险评分**：${risk_metrics.risk_score} 分（${this.riskLevelLabel(risk_metrics.risk_level)}）

### 核心指标

- **年化波动率**：${volPct}% — ${this.volatilityExplanation(risk_metrics.volatility)}
- **最大回撤**：${ddPct}% — ${this.drawdownExplanation(risk_metrics.max_drawdown)}
- **夏普比率**：${risk_metrics.sharpe_ratio.toFixed(2)} — ${this.sharpeExplanation(risk_metrics.sharpe_ratio)}
- **Beta系数**：${risk_metrics.beta.toFixed(2)} — 组合相对市场的敏感度${risk_metrics.beta > 1 ? '较高，波动性大于市场平均水平' : risk_metrics.beta > 0.5 ? '适中' : '较低，具有防御性特征'}
- **VaR (95%置信度)**：¥${varAmount} — 在正常市场条件下，单日最大可能损失约为¥${varAmount}

### 风险因子分解

当前组合风险主要来源于：
${risk_metrics.concentration_score < 50 ? '- **集中度风险较高**，部分标的权重过大，建议分散投资降低个股风险' : '- 集中度风险可控，持仓相对分散'}
${risk_metrics.correlation_score < 50 ? '- **相关性风险较高**，持仓标的走势趋同，降低了分散化效果' : '- 相关性风险较低，持仓间的差异化有助于分散风险'}
${risk_metrics.volatility_score < 50 ? '- **波动率风险偏高**，组合价格波动较大' : '- 波动率风险可控'}

> 根据当前数据，您持有 ${portfolio_summary.position_count} 个标的，总市值 ¥${portfolio_summary.total_market_value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}。${risk_metrics.risk_level === 'critical' ? '当前风险等级为高危，强烈建议立即审查仓位配置并考虑止损操作。' : risk_metrics.risk_level === 'high' ? '风险等级较高，建议适当降低仓位或增加对冲。' : '风险水平在可控范围内，继续保持监控。'}
${DISCLAIMER}`
  }

  private respondPortfolio(ctx: AIChatContext): string {
    const { portfolio_summary, positions } = ctx
    const posList = positions.slice(0, 10).map((p, i) =>
      `${i + 1}. **${p.asset.name}** (${p.asset.symbol}) | ${p.asset.asset_type} | ${p.asset.market} | 持仓 ${p.quantity}股 | 市值 ¥${p.market_value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} | 权重 ${p.weight_pct.toFixed(1)}% | 盈亏 ${p.unrealized_pnl > 0 ? '+' : ''}¥${p.unrealized_pnl.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} (${p.total_return_pct > 0 ? '+' : ''}${p.total_return_pct.toFixed(2)}%)`
    ).join('\n')

    const remaining = positions.length - 10

    return `## 📋 当前持仓概览

**总市值**：¥${portfolio_summary.total_market_value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
**持仓数量**：${portfolio_summary.position_count} 个标的
**累计盈亏**：¥${portfolio_summary.cumulative_pnl.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} (${portfolio_summary.cumulative_return_pct > 0 ? '+' : ''}${portfolio_summary.cumulative_return_pct}%)

### 持仓明细

${posList}
${remaining > 0 ? `\n*...及其他 ${remaining} 个标的*` : ''}

### 资产类型分布

${this.buildAssetTypeDistribution(positions)}

${DISCLAIMER}`
  }

  private respondTrend(ctx: AIChatContext): string {
    const { portfolio_summary, risk_metrics } = ctx

    const trendAnalysis = portfolio_summary.today_pnl > 0
      ? '今日组合表现为正收益，市场情绪偏向积极。但需注意短期波动风险，不要因短期盈利而过度乐观。'
      : portfolio_summary.today_pnl < 0
        ? '今日组合出现亏损，市场短期承压。建议审视持仓标的的基本面和技术面，确认投资逻辑是否仍然成立。'
        : '今日组合表现平稳，市场处于横盘整理状态。'

    return `## 📈 市场走势分析

${trendAnalysis}

### 技术面观察
- 组合风险评分：${risk_metrics.risk_score}分，处于${this.riskLevelLabel(risk_metrics.risk_level)}区间
- 当前波动率：${(risk_metrics.volatility * 100).toFixed(2)}%，${risk_metrics.volatility > 0.3 ? '波动较大，需警惕短期风险' : '波动水平适中'}
- 夏普比率：${risk_metrics.sharpe_ratio.toFixed(2)}，${risk_metrics.sharpe_ratio > 1 ? '风险调整后收益良好' : risk_metrics.sharpe_ratio > 0 ? '风险调整后收益一般' : '风险调整后收益为负，需关注'}

> 技术分析仅作为辅助参考，最终决策应综合基本面分析和自身风险偏好。市场走势受多种因素影响，短期波动属于正常现象。
${DISCLAIMER}`
  }

  private respondAdvice(ctx: AIChatContext): string {
    const { risk_metrics, portfolio_summary, positions } = ctx

    const suggestions: string[] = []

    if (risk_metrics.concentration_score < 40) {
      const maxWeight = Math.max(...positions.map((p) => p.weight_pct))
      if (maxWeight > 30) {
        suggestions.push(`⚠️ 单一标的权重达到 ${maxWeight.toFixed(1)}%，集中度风险较高。建议将单一个股权重控制在20%以内，以降低非系统性风险。`)
      }
    }

    if (risk_metrics.volatility > 0.3) {
      suggestions.push('📊 组合波动率偏高，可考虑增加债券型基金或货币市场工具的比例，降低整体波动率。')
    }

    if (risk_metrics.sharpe_ratio < 0.5) {
      suggestions.push('📉 夏普比率偏低，说明当前组合的风险调整后收益不理想。建议审视持仓品种，考虑替换表现不佳的标的。')
    }

    if (risk_metrics.max_drawdown > 0.2) {
      suggestions.push('🔻 最大回撤超过20%，建议设置更严格的止损策略，或增加对冲工具（如反向ETF）。')
    }

    if (positions.length < 3) {
      suggestions.push('📦 持仓数量偏少，建议适当增加标的数量（建议5-10个不同行业的标的），以实现更好的风险分散。')
    }

    if (positions.length > 15) {
      suggestions.push('📚 持仓数量较多，可能存在过度分散导致管理困难。建议聚焦核心标的，精简持仓。')
    }

    if (portfolio_summary.cumulative_pnl < 0 && Math.abs(portfolio_summary.cumulative_return_pct) > 15) {
      suggestions.push('🛑 累计亏损超过15%，建议深度复盘亏损原因，确认是否触及止损线，制定明确的退出计划。')
    }

    return `## 💡 投资建议

基于当前${portfolio_summary.position_count}个标的、市值¥${portfolio_summary.total_market_value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}的组合情况：

${suggestions.map((s) => `- ${s}`).join('\n')}

> 请注意：以上建议基于系统计算的量化指标生成，不构成任何实际操作指令。投资决策应综合考虑个人财务状况、风险承受能力和市场环境。
${DISCLAIMER}`
  }

  private respondNews(ctx: AIChatContext): string {
    const { latest_news } = ctx

    if (latest_news.length === 0) {
      return `## 📰 新闻动态\n\n当前无最新相关新闻。系统将在有新消息时及时更新。\n${DISCLAIMER}`
    }

    const highNews = latest_news.filter((n) => n.importance === 'high')
    const newsList = latest_news.slice(0, 5).map((n, i) =>
      `${i + 1}. **[${this.importanceLabel(n.importance)}]** ${n.title}\n   ${n.summary ?? ''}\n   来源: ${n.source} | 情感: ${n.sentiment !== null ? (n.sentiment > 0 ? '正面' : n.sentiment < 0 ? '负面' : '中性') : '未知'}`
    ).join('\n\n')

    return `## 📰 最新新闻动态

${highNews.length > 0 ? `⚠️ 有 **${highNews.length}** 条高重要性新闻需要关注！\n` : ''}

${newsList}

> 新闻信息仅供参考。市场反应不一定与新闻的情感倾向一致，需结合整体市场环境综合判断。个股新闻可能导致短期波动，长期来看基本面仍是决定因素。
${DISCLAIMER}`
  }

  private respondGeneral(ctx: AIChatContext): string {
    const { portfolio_summary, risk_metrics } = ctx

    return `根据当前数据，您的投资组合表现如下：

**投资组合概况**
- 持仓数量：${portfolio_summary.position_count} 个标的
- 总市值：¥${portfolio_summary.total_market_value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
- 今日盈亏：¥${portfolio_summary.today_pnl.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} (${portfolio_summary.today_pnl_pct > 0 ? '+' : ''}${portfolio_summary.today_pnl_pct}%)
- 累计盈亏：¥${portfolio_summary.cumulative_pnl.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} (${portfolio_summary.cumulative_return_pct > 0 ? '+' : ''}${portfolio_summary.cumulative_return_pct}%)

**风险状况**
- 风险评分：${risk_metrics.risk_score} 分 (${this.riskLevelLabel(risk_metrics.risk_level)})
- 年化波动率：${(risk_metrics.volatility * 100).toFixed(2)}%
- 最大回撤：${(risk_metrics.max_drawdown * 100).toFixed(2)}%

您可以继续询问持仓详情、风险分析、投资建议或新闻动态。我会根据实际数据为您提供分析参考。

> ⚠️ 请注意：我提供的数据分析基于系统内的量化指标，仅供参考，不构成投资建议。所有交易决策需您自行负责。
${DISCLAIMER}`
  }

  // ---- Private: News analysis generation ----

  private generateNewsAnalysis(newsItems: NewsWithAsset[]): string {
    const highNews = newsItems.filter((n) => n.importance === 'high')
    const positiveNews = newsItems.filter((n) => (n.sentiment ?? 0) > 0.2)
    const negativeNews = newsItems.filter((n) => (n.sentiment ?? 0) < -0.2)

    const parts: string[] = []

    if (highNews.length > 0) {
      parts.push(`近期有 **${highNews.length}** 条高重要性新闻，涉及：${highNews.map((n) => n.title).join('；')}。这些事件可能对相关标的产生较大影响，建议密切关注后续发展。`)
    }

    if (positiveNews.length > 0 || negativeNews.length > 0) {
      const balance = positiveNews.length - negativeNews.length
      if (balance > 2) parts.push('近期正面消息明显多于负面消息，市场情绪偏向乐观。但需注意过度乐观可能带来的风险积累。')
      else if (balance < -2) parts.push('近期负面消息较多，市场情绪偏谨慎。投资者可能过度反应，需理性分析基本面。')
      else parts.push('多空消息相对均衡，市场呈现观望态势。')
    }

    parts.push('建议投资者关注新闻背后反映的行业趋势和宏观经济变化，而非单一事件本身。')

    return parts.join('\n\n')
  }

  // ---- Private: Risk level explanations ----

  private volatilityExplanation(vol: number): string {
    if (vol > 0.5) return '极高波动，风险敞口很大，建议立即降低风险资产配置'
    if (vol > 0.3) return '波动率偏高，超过市场平均水平，需关注风险控制'
    if (vol > 0.2) return '波动率适中，处于合理区间'
    if (vol > 0.1) return '波动率较低，组合相对稳定'
    return '波动率很低，组合非常稳定'
  }

  private drawdownExplanation(dd: number): string {
    if (dd > 0.5) return '回撤极大，已达灾难性级别，需立即采取止损措施'
    if (dd > 0.3) return '回撤较大，超过一般承受范围，建议减仓或对冲'
    if (dd > 0.2) return '回撤偏高，需关注风险管理和仓位控制'
    if (dd > 0.1) return '回撤适中，属于正常市场波动范围'
    return '回撤较小，风险控制良好'
  }

  private sharpeExplanation(sharpe: number): string {
    if (sharpe > 3) return '夏普比率优秀，风险调整后收益非常高'
    if (sharpe > 2) return '夏普比率良好，风险调整后收益较高'
    if (sharpe > 1) return '夏普比率尚可，风险调整后收益为正'
    if (sharpe > 0) return '夏普比率偏低，风险调整后收益接近于零'
    return '夏普比率为负，风险调整后收益不理想'
  }

  private betaExplanation(beta: number): string {
    if (beta > 2) return 'Beta极高，组合波动远超市场'
    if (beta > 1.5) return 'Beta较高，组合比市场波动更大'
    if (beta > 1) return 'Beta略高于1，组合波动略大于市场'
    if (beta > 0.5) return 'Beta适中，组合与市场同步性一般'
    if (beta > 0) return 'Beta较低，组合相对独立于市场'
    return 'Beta为负，组合与市场呈反向关系'
  }

  private varExplanation(var95: number): string {
    if (var95 > 50000) return '在险价值较高，单日潜在损失较大'
    if (var95 > 10000) return '在险价值适中'
    return '在险价值较低，单日损失风险可控'
  }

  // ---- Private: Report helpers ----

  private reportTitle(type: ReportType): string {
    switch (type) {
      case 'daily': return '每日风险报告'
      case 'weekly': return '周度风险管理报告'
      case 'monthly': return '月度风险管理报告'
      case 'risk_assessment': return '风险评估报告'
      case 'asset_analysis': return '资产分析报告'
      case 'fund_comparison': return '基金对比报告'
      default: return '风险管理报告'
    }
  }

  private reportTypeLabel(type: ReportType): string {
    switch (type) {
      case 'daily': return '日报'
      case 'weekly': return '周报'
      case 'monthly': return '月报'
      case 'risk_assessment': return '风险评估'
      case 'asset_analysis': return '资产分析'
      case 'fund_comparison': return '基金对比'
      default: return type
    }
  }

  private generateReportRiskPoints(positions: any[], riskSnapshot: any): string {
    const points: string[] = []

    if (positions.length > 0) {
      const maxWeight = Math.max(...positions.map((p: any) => p.market_value / positions.reduce((s: number, r: any) => s + r.market_value, 0) * 100))
      if (maxWeight > 30) {
        points.push(`- ⚠️ **集中度风险**：最高权重标的占比 ${maxWeight.toFixed(1)}%，建议分散持仓`)
      }

      const losingPositions = positions.filter((p: any) => p.unrealized_pnl < 0)
      if (losingPositions.length > positions.length / 2) {
        points.push(`- 📉 **多数持仓亏损**：${losingPositions.length}/${positions.length} 个标的处于亏损状态，建议逐一评估持有逻辑`)
      }
    }

    if (riskSnapshot) {
      if (riskSnapshot.risk_score < 30) {
        points.push('- 🚨 **风险评分过低**（' + riskSnapshot.risk_score + '分），整体风险敞口过大')
      }
      if (riskSnapshot.concentration_score < 40) {
        points.push('- 🔴 **集中度得分偏低**，组合过度集中于少数标的或行业')
      }
    }

    if (points.length === 0) {
      points.push('- 当前无明显风险点，继续保持风险监控')
    }

    return points.join('\n')
  }

  private generateRiskSuggestions(risk: RiskSummary): string {
    const suggestions: string[] = []

    if (risk.volatility > 0.3) {
      suggestions.push('波动率偏高，建议适当降低权益类资产占比，增加固收类配置')
    }
    if (risk.max_drawdown > 0.2) {
      suggestions.push('最大回撤超过20%，建议设置并严格执行止损纪律')
    }
    if (risk.concentration_score < 40) {
      suggestions.push('集中度得分较低，建议分散投资到不同行业和市场，降低非系统性风险')
    }
    if (risk.sharpe_ratio < 1) {
      suggestions.push('夏普比率不理想，建议审视投资策略，优化组合的风险收益特征')
    }
    if (risk.correlation_score < 50) {
      suggestions.push('持仓相关性较高，建议增加负相关或低相关资产以实现有效分散化')
    }

    if (suggestions.length === 0) {
      suggestions.push('当前风险指标总体在可控范围内，建议继续保持现有风险管理措施，定期审视各项指标。')
    }

    return suggestions.map((s) => `- ${s}`).join('\n')
  }

  // ---- Private: Asset type distribution builder ----

  private buildAssetTypeDistribution(positions: any[]): string {
    const map = new Map<string, { count: number; value: number }>()
    let totalValue = 0
    for (const p of positions) {
      const type = p.asset?.asset_type ?? 'unknown'
      if (!map.has(type)) map.set(type, { count: 0, value: 0 })
      const entry = map.get(type)!
      entry.count++
      entry.value += p.market_value
      totalValue += p.market_value
    }

    return Array.from(map.entries()).map(([type, data]) =>
      `- **${type}**：${data.count} 个标的，市值 ¥${data.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} (${totalValue > 0 ? (data.value / totalValue * 100).toFixed(1) : 0}%)`
    ).join('\n')
  }

  // ---- Private: Utility helpers ----

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

  private importanceLabel(importance: string): string {
    switch (importance) {
      case 'high': return '高'
      case 'medium': return '中'
      case 'low': return '低'
      default: return importance
    }
  }

  private scoreLabel(score: number): string {
    if (score >= 80) return '优秀 ✅'
    if (score >= 60) return '良好 💪'
    if (score >= 40) return '一般 📊'
    if (score >= 20) return '较差 ⚠️'
    return '危险 🚨'
  }
}
