import { useEffect, useState, useMemo } from 'react'
import { useReportsStore } from '@/stores/reports.store'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import { Panel } from '@/components/ui/Panel'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Tag } from '@/components/ui/Tag'
import { Skeleton } from '@/components/ui/Skeleton'
import type { Report, ReportType } from '@shared/types/database'

const REPORT_TABS = [
  { label: '全部', value: '' },
  { label: '日报', value: 'daily' },
  { label: '周报', value: 'weekly' },
  { label: '月报', value: 'monthly' },
  { label: '风险评估', value: 'risk_assessment' },
  { label: '资产分析', value: 'asset_analysis' },
]

const TYPE_LABELS: Record<string, string> = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报',
  risk_assessment: '风险评估',
  asset_analysis: '资产分析',
  fund_comparison: '基金对比',
}

const TYPE_VARIANT: Record<string, 'ok' | 'warning' | 'danger'> = {
  daily: 'ok',
  weekly: 'warning',
  monthly: 'warning',
  risk_assessment: 'danger',
  asset_analysis: 'ok',
  fund_comparison: 'ok',
}

export function ReportsPage() {
  const {
    reports, selectedReport, loading, error,
    fetchReports, fetchReport, setSelectedReport,
  } = useReportsStore()
  const [activeType, setActiveType] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatingType, setGeneratingType] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  // Initial load
  useEffect(() => {
    fetchReports()
  }, [])

  // Clear status after 3s
  useEffect(() => {
    if (!statusMsg) return
    const t = setTimeout(() => setStatusMsg(null), 3000)
    return () => clearTimeout(t)
  }, [statusMsg])

  // Filter reports by type
  const filteredReports = useMemo(() => {
    if (!activeType) return reports
    return reports.filter((r) => r.report_type === activeType)
  }, [reports, activeType])

  // Handle type filter change
  const handleTypeChange = (v: string) => {
    setActiveType(v)
  }

  // View report detail
  const handleView = async (reportId: string) => {
    await fetchReport(reportId)
  }

  // Generate report
  const handleGenerate = async (type: string) => {
    setGenerating(true)
    setGeneratingType(type)
    try {
      await ipcInvoke(IPC_CHANNELS.AI_GENERATE_REPORT, {
        report_type: type as ReportType,
      })
      setStatusMsg('报告生成请求已发送')
      // Refresh list after a short delay for backend to process
      setTimeout(() => fetchReports(), 1500)
    } catch (e: any) {
      setStatusMsg(`生成失败: ${e.message || String(e)}`)
    } finally {
      setGenerating(false)
      setGeneratingType(null)
    }
  }

  // Delete report
  const handleDelete = async (reportId: string) => {
    if (!confirm('确认删除该报告？')) return
    try {
      await ipcInvoke(IPC_CHANNELS.REPORT_DELETE, reportId)
      setStatusMsg('报告已删除')
      if (selectedReport?.id === reportId) {
        setSelectedReport(null)
      }
      fetchReports()
    } catch (e: any) {
      setStatusMsg(`删除失败: ${e.message || String(e)}`)
    }
  }

  // Export report
  const handleExport = async (report: Report) => {
    try {
      await ipcInvoke(IPC_CHANNELS.APP_EXPORT_FILE, {
        defaultName: `${report.title}.md`,
        content: report.content_markdown,
      })
      setStatusMsg('导出成功')
    } catch (e: any) {
      setStatusMsg(`导出失败: ${e.message || String(e)}`)
    }
  }

  return (
    <div>
      {statusMsg && (
        <div
          className={`alert-item ${statusMsg.includes('失败') ? 'severe' : ''}`}
          style={{ marginBottom: 14 }}
        >
          <b>{statusMsg}</b>
        </div>
      )}

      <div className="workspace-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 420px' }}>
        {/* Left column: Report list */}
        <div className="left-column">
          <Panel
            title="报告列表"
            subtitle={`共 ${filteredReports.length} 份报告`}
            actions={
              <SegmentedControl
                options={REPORT_TABS.map((t) => ({
                  label: t.label,
                  value: t.value,
                }))}
                selected={activeType}
                onChange={handleTypeChange}
              />
            }
          >
            {loading && reports.length === 0 ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} height={60} />
                ))}
              </div>
            ) : error && reports.length === 0 ? (
              <div className="alert-item severe">
                <b>报告数据加载失败</b>
                <p>{error}</p>
                <button
                  className="primary-button"
                  onClick={fetchReports}
                  style={{ marginTop: 8 }}
                >
                  重试
                </button>
              </div>
            ) : filteredReports.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
                <p style={{ fontSize: 16, marginBottom: 8 }}>暂无报告</p>
                <p style={{ fontSize: 13 }}>
                  点击右侧「生成报告」创建新的分析报告
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {filteredReports.map((r) => (
                  <div
                    key={r.id}
                    className="alert-item"
                    style={{
                      cursor: 'pointer',
                      borderLeftColor:
                        selectedReport?.id === r.id
                          ? 'var(--blue)'
                          : undefined,
                    }}
                    onClick={() => handleView(r.id)}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <Tag
                        variant={
                          TYPE_VARIANT[r.report_type] || 'ok'
                        }
                      >
                        {TYPE_LABELS[r.report_type] || r.report_type}
                      </Tag>
                      <b style={{ fontSize: 13, flex: 1 }}>{r.title}</b>
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--muted)',
                          marginLeft: 'auto',
                        }}
                      >
                        {new Date(r.created_at).toLocaleDateString('zh-CN')}
                      </span>
                      <button
                        className="text-button"
                        style={{
                          fontSize: 11,
                          color: 'var(--red)',
                          marginLeft: 4,
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(r.id)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Right column: Report detail + generate */}
        <div className="right-column">
          {/* Report detail viewer */}
          <Panel
            title={selectedReport ? '报告内容' : '报告详情'}
            subtitle={
              selectedReport
                ? selectedReport.title
                : '请选择一份报告查看'
            }
            actions={
              selectedReport ? (
                <button
                  className="text-button"
                  onClick={() => handleExport(selectedReport)}
                >
                  导出
                </button>
              ) : undefined
            }
          >
            {selectedReport ? (
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: '#314151',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 500,
                  overflowY: 'auto',
                  padding: 8,
                }}
              >
                {selectedReport.content_markdown}
              </div>
            ) : (
              <div
                style={{
                  padding: 40,
                  textAlign: 'center',
                  color: 'var(--muted)',
                }}
              >
                <p>点击左侧报告查看详情</p>
              </div>
            )}
          </Panel>

          {/* Generate report panel */}
          <Panel title="生成报告" subtitle="选择报告类型自动生成">
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                {
                  type: 'daily',
                  label: '日报',
                  desc: '当日市场总结与组合表现',
                },
                {
                  type: 'weekly',
                  label: '周报',
                  desc: '本周回顾与下周展望',
                },
                {
                  type: 'monthly',
                  label: '月报',
                  desc: '月度投资绩效分析',
                },
                {
                  type: 'risk_assessment',
                  label: '风险评估报告',
                  desc: '组合风险全面评估',
                },
              ].map((item) => (
                <div
                  key={item.type}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 12,
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    background: 'var(--surface-soft)',
                  }}
                >
                  <div>
                    <b style={{ fontSize: 13 }}>{item.label}</b>
                    <p
                      style={{
                        color: 'var(--muted)',
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      {item.desc}
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => handleGenerate(item.type)}
                    disabled={generating}
                    style={{
                      height: 32,
                      fontSize: 12,
                      padding: '0 12px',
                    }}
                  >
                    {generating && generatingType === item.type
                      ? '生成中...'
                      : '生成'}
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
