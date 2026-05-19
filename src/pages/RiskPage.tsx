import { useEffect, useMemo, useState } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useRiskStore } from '@/stores/risk.store'
import { useAppStore } from '@/stores/app.store'
import { Panel } from '@/components/ui/Panel'
import { MetricCard } from '@/components/ui/MetricCard'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { Skeleton } from '@/components/ui/Skeleton'
import type { StressTestResult } from '@shared/types/database'

echarts.use([BarChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

export function RiskPage() {
  const {
    summary, exposure, correlation, stressResults,
    loading, error, fetchSummary, fetchExposure, fetchCorrelation, runStressTest,
  } = useRiskStore()
  const dataSourceStatus = useAppStore((s) => s.dataSourceStatus)
  const hasPositions = dataSourceStatus?.has_positions ?? false
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>(['market_crash'])

  useEffect(() => {
    fetchSummary()
    fetchExposure()
    fetchCorrelation()
  }, [])

  const toggleScenario = (id: string) => {
    setSelectedScenarios((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    )
  }

  const handleRunStressTest = () => {
    if (selectedScenarios.length > 0) runStressTest(selectedScenarios)
  }

  const riskScore = summary?.risk_score ?? 0
  const riskLevel = summary?.risk_level ?? 'medium'

  // ── Exposure bar chart ───────────────────────────────────────
  const exposureOption = useMemo(() => {
    const data =
      exposure.length > 0
        ? exposure.map((e) => ({ name: e.category, value: e.weight_pct }))
        : []
    return {
      tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
      grid: { left: 100, right: 40, top: 10, bottom: 30 },
      xAxis: { type: 'value' as const, axisLabel: { formatter: '{value}%' as const } },
      yAxis: {
        type: 'category' as const,
        data: data.map((d) => d.name),
        inverse: true,
      },
      series: [
        {
          type: 'bar',
          data: data.map((d) => ({
            value: d.value,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 1, y2: 0,
                colorStops: [
                  { offset: 0, color: '#119468' },
                  { offset: 0.6, color: '#c99a05' },
                  { offset: 1, color: '#d33f3f' },
                ],
              },
              borderRadius: [0, 4, 4, 0],
            },
          })),
          barWidth: 20,
        },
      ],
    }
  }, [exposure])

  // ── Correlation heatmap ──────────────────────────────────────
  const correlationOption = useMemo(() => {
    const names = correlation.length > 0
      ? Array.from(
          new Set(correlation.flatMap((c) => [c.asset_a_name, c.asset_b_name])),
        ).slice(0, 6)
      : []
    const matrix: number[][] = names.map((na) =>
      names.map((nb) => {
        if (na === nb) return 1
        const pair = correlation.find(
          (c) =>
            (c.asset_a_name === na && c.asset_b_name === nb) ||
            (c.asset_a_name === nb && c.asset_b_name === na),
        )
        return pair ? pair.correlation : 0
      }),
    )
    const heatData: [number, number, number][] = []
    names.forEach((_, i) =>
      names.forEach((_, j) =>
        heatData.push([j, i, +matrix[i][j].toFixed(2)]),
      ),
    )
    return {
      tooltip: { position: 'top' as const },
      grid: { left: 100, right: 20, top: 10, bottom: 30 },
      xAxis: {
        type: 'category' as const,
        data: names,
        axisLabel: { rotate: 30, fontSize: 10 },
      },
      yAxis: { type: 'category' as const, data: names, inverse: true },
      visualMap: {
        min: -1,
        max: 1,
        calculable: true,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: 0,
        inRange: { color: ['#d33f3f', '#eef2f5', '#119468'] },
      },
      series: [
        {
          type: 'heatmap',
          data: heatData,
          label: {
            show: true,
            formatter: (p: any) => (p.value[2] * 100).toFixed(0) + '%',
            fontSize: 10,
          },
        },
      ],
    }
  }, [correlation])

  // ── Main render ──────────────────────────────────────────────
  if (loading && !summary) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Skeleton height={48} />
          <div className="kpi-grid">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={118} />)}
          </div>
          <Skeleton height={320} />
        </div>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="alert-item severe" style={{ margin: 24 }}>
        <b>风险数据加载失败</b>
        <p>{error}</p>
        <button
          className="primary-button"
          onClick={() => { fetchSummary(); fetchExposure(); fetchCorrelation() }}
          style={{ marginTop: 12 }}
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div>
      {!hasPositions && (
        <div className="alert-item severe" style={{ marginBottom: 14 }}>
          <b>风险分析需要持仓数据</b>
          <p>
            当前没有任何持仓记录。请先在「持仓管理」页面导入交易记录或手动添加持仓，
            系统将自动计算组合风险指标。
          </p>
        </div>
      )}

      {error && (
        <div className="alert-item severe" style={{ marginBottom: 14 }}>
          <b>加载错误</b>
          <p>{error}</p>
        </div>
      )}

      {/* Risk metric cards row 1 */}
      <div className="kpi-grid">
        <MetricCard
          label="年化波动率"
          value={summary ? `${(summary.volatility * 100).toFixed(1)}%` : '---'}
          loading={loading}
          tooltip="组合收益率的标准差年化值，衡量资产价格波动的剧烈程度"
        />
        <MetricCard
          label="最大回撤"
          value={summary ? `${(summary.max_drawdown * 100).toFixed(1)}%` : '---'}
          variant={
            riskLevel === 'high' || riskLevel === 'critical' ? 'risk-high' : 'default'
          }
          loading={loading}
          tooltip="历史上从高点到低点的最大亏损幅度，反映极端风险"
        />
        <MetricCard
          label="夏普比率"
          value={summary ? summary.sharpe_ratio.toFixed(2) : '---'}
          loading={loading}
          tooltip="每承受一单位风险所获得的超额收益，数值越高风险调整收益越好"
        />
        <MetricCard
          label="Beta系数"
          value={summary ? summary.beta.toFixed(2) : '---'}
          loading={loading}
          tooltip="相对于市场整体波动的敏感程度，Beta>1表示波动大于市场"
        />
      </div>

      {/* Risk metric cards row 2 */}
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <MetricCard
          label="VaR (95%)"
          value={summary ? `¥${summary.var_95.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : '---'}
          loading={loading}
          tooltip="在95%置信水平下，未来一段时间内的最大可能亏损金额"
        />
        <MetricCard
          label="集中度"
          value={summary ? String(summary.concentration_score) : '---'}
          variant={
            summary && summary.concentration_score > 70 ? 'risk-high' : 'default'
          }
          loading={loading}
          tooltip="持仓资金在不同资产间的分散程度，分数越低表示越集中"
        />
        <MetricCard
          label="相关性"
          value={summary ? String(summary.correlation_score) : '---'}
          loading={loading}
          tooltip="各持仓资产价格变动的联动程度，分数越低表示分散效果越好"
        />
        <MetricCard
          label="舆情得分"
          value={summary ? String(summary.sentiment_score) : '---'}
          loading={loading}
          tooltip="基于持仓相关新闻情感分析的综合评分，反映市场情绪"
        />
      </div>

      <div className="workspace-grid">
        <div className="left-column">
          {/* Industry exposure */}
          <Panel title="行业风险敞口" subtitle="各行业持仓占比分布" tooltip="展示您持仓在不同行业的资金分布比例，帮助识别行业集中风险">
            {loading && exposure.length === 0 ? (
              <Skeleton height={300} />
            ) : error && exposure.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--red)' }}>
                敞口数据加载失败
              </div>
            ) : exposure.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
                暂无行业敞口数据
              </div>
            ) : (
              <ReactEChartsCore echarts={echarts} option={exposureOption} style={{ height: 300, width: '100%' }} />
            )}
          </Panel>

          {/* Correlation matrix */}
          <Panel title="持仓相关性矩阵" tooltip="展示各持仓资产之间的价格联动程度，相关性越高意味着风险分散效果越差">
            {loading && correlation.length === 0 ? (
              <Skeleton height={320} />
            ) : error && correlation.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--red)' }}>
                相关性数据加载失败
              </div>
            ) : correlation.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
                暂无相关性数据
              </div>
            ) : (
              <ReactEChartsCore
                echarts={echarts}
                option={correlationOption}
                style={{ height: 320, width: '100%' }}
              />
            )}
          </Panel>
        </div>

        <div className="right-column">
          {/* Risk score panel */}
          <Panel title="风险评分">
            {!summary ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
                暂无风险数据
              </div>
            ) : (
              <>
                <ScoreRing score={riskScore} label="风险分" level={riskLevel} />
                <div className="risk-bars">
                  {[
                    { label: '波动率', value: summary.volatility_score },
                    { label: '回撤', value: summary.drawdown_score },
                    { label: '集中度', value: summary.concentration_score },
                    { label: '相关性', value: summary.correlation_score },
                    { label: '流动性', value: summary.liquidity_score },
                  ].map((r) => (
                    <div key={r.label} className="risk-row">
                      <span>{r.label}</span>
                      <div>
                        <i style={{ width: `${r.value}%` }} />
                      </div>
                      <b>{r.value}</b>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>

          {/* Stress test panel */}
          <Panel title="压力测试" subtitle="选择场景并运行">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {[
                { id: 'market_crash', name: '2008 金融危机', desc: '市场下跌30%' },
                { id: 'tech_selloff', name: '2015 A股异常波动', desc: '市场下跌25%' },
                { id: 'rate_hike', name: '2020 疫情暴跌', desc: '市场下跌15%' },
                { id: 'moderate_decline', name: '2022 加息冲击', desc: '市场下跌20%' },
              ].map((sc) => (
                <button
                  key={sc.id}
                  className="text-button"
                  onClick={() => toggleScenario(sc.id)}
                  style={{
                    background: selectedScenarios.includes(sc.id)
                      ? 'var(--blue)'
                      : undefined,
                    color: selectedScenarios.includes(sc.id) ? '#fff' : undefined,
                  }}
                >
                  {sc.name}
                </button>
              ))}
            </div>
            <button
              className="primary-button"
              onClick={handleRunStressTest}
              disabled={selectedScenarios.length === 0 || loading}
              style={{ marginBottom: 14 }}
            >
              {loading ? '运行中...' : '执行压力测试'}
            </button>

            {stressResults.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="holding-table">
                  <thead>
                    <tr>
                      <th>场景</th>
                      <th>预估损失</th>
                      <th>损失比例</th>
                      <th>新组合价值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stressResults.map((r: StressTestResult) => (
                      <tr key={r.scenario_id}>
                        <td><strong>{r.scenario_name}</strong></td>
                        <td className="loss">
                          ¥{Math.abs(r.estimated_loss_amount).toLocaleString('zh-CN', { minimumFractionDigits: 0 })}
                        </td>
                        <td className="loss">
                          {(r.estimated_loss_pct).toFixed(2)}%
                        </td>
                        <td>
                          ¥{r.new_portfolio_value.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stressResults[0]?.suggestions?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <b style={{ fontSize: 13 }}>建议:</b>
                    <ul
                      style={{
                        marginTop: 6, paddingLeft: 20,
                        color: 'var(--muted)', fontSize: 13,
                      }}
                    >
                      {stressResults[0].suggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: 24, textAlign: 'center',
                  color: 'var(--muted)', fontSize: 13,
                }}
              >
                选择压力测试场景后点击执行
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
