// ============================================================
// ReportService — report generation, storage, retrieval
// Uses ai.service, risk.service, portfolio.service, news.service
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../db'
import type { Report, ReportType, AIChatContext } from '../../shared/types/database'
import type { IpcGenerateReportPayload } from '../../shared/types/ipc'
import { AIService } from './ai.service'
import { RiskService } from './risk.service'
import { getPositionService } from './portfolio'
import { NewsService } from './news.service'

export class ReportService {
  private aiService: AIService
  private riskService: RiskService
  private newsService: NewsService

  constructor() {
    this.aiService = new AIService()
    this.riskService = new RiskService()
    this.newsService = new NewsService()
  }

  /**
   * Generate a new report of the specified type with AI-generated content.
   * Single-pass: builds context, generates content, and persists in one call.
   */
  generateReport(type: ReportType, params?: Record<string, unknown>, content?: string): Report {
    const db = getDb()
    const now = new Date().toISOString()

    // Build context from real data
    const context = this.buildContext()

    // Use provided content or fall back to legacy AI service
    const reportContent = content ?? this.aiService.generateReport(type, params).content

    // Generate title
    const title = this.generateTitle(type, context)

    // Store context as JSON for later reference
    const sourceContextJson = JSON.stringify({
      portfolio_summary: context.portfolio_summary,
      risk_metrics: context.risk_metrics,
      positions_count: context.positions.length,
      news_count: context.latest_news.length,
      params: params || {},
      generated_at: now,
    })

    const report: Report = {
      id: uuid(),
      report_type: type,
      title,
      content_markdown: reportContent,
      source_context_json: sourceContextJson,
      created_at: now
    }

    db.prepare(`
      INSERT INTO reports (id, report_type, title, content_markdown, source_context_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(report.id, report.report_type, report.title, report.content_markdown, report.source_context_json, report.created_at)

    return report
  }

  /**
   * Get list of all reports (metadata only, without full content)
   */
  getReportList(): { id: string; report_type: ReportType; title: string; created_at: string }[] {
    const db = getDb()
    return db.prepare(`
      SELECT id, report_type, title, created_at FROM reports
      ORDER BY created_at DESC
    `).all() as { id: string; report_type: ReportType; title: string; created_at: string }[]
  }

  /**
   * Get a single report by ID (with full content)
   */
  getReport(reportId: string): Report | null {
    const db = getDb()
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId) as Report | undefined
    return report || null
  }

  /**
   * Delete a report
   */
  deleteReport(reportId: string): void {
    const db = getDb()
    const result = db.prepare('DELETE FROM reports WHERE id = ?').run(reportId)
    if (result.changes === 0) {
      throw new Error(`未找到报告: ${reportId}`)
    }
  }

  // ---- Private helpers ----

  private buildContext(): AIChatContext {
    const positions = getPositionService().getPositionsWithDetails()
    const summary = getPositionService().getSummary()
    const riskMetrics = this.riskService.getSummary()
    const newsResult = this.newsService.getNews({ limit: 30 })

    return {
      portfolio_summary: summary,
      risk_metrics: riskMetrics,
      positions,
      latest_news: newsResult.items
    }
  }

  private generateTitle(type: ReportType, context: AIChatContext): string {
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const dateStr = now.split(' ')[0] || now

    const typeLabels: Record<ReportType, string> = {
      'daily': '日报',
      'weekly': '周报',
      'monthly': '月报',
      'risk_assessment': '风险评估',
      'asset_analysis': '资产分析',
      'fund_comparison': '基金对比'
    }

    const label = typeLabels[type] || '报告'
    const riskLevel = context.risk_metrics?.risk_level
    const riskTags: Record<string, string> = {
      low: '低风险',
      medium: '中风险',
      high: '高风险',
      critical: '危险'
    }
    const riskTag = riskLevel ? `[${riskTags[riskLevel] || riskLevel}]` : ''

    return `RiskPilot ${label} ${riskTag} - ${dateStr}`
  }
}
