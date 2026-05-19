import { useMemo } from 'react'
import { useRiskStore } from '@/stores/risk.store'
import { AllocationDonut } from './AllocationDonut'
import type { AllocationSegment } from './AllocationDonut'
import { Panel } from '../ui/Panel'

const TYPE_COLORS: Record<string, { color: string; className: string }> = {
  stock: { color: '#2f65d9', className: 'stock' },
  fund: { color: '#078f8c', className: 'fund' },
  etf: { color: '#119468', className: 'etf' },
  lof: { color: '#c99a05', className: 'cash' },
}

const TYPE_LABELS: Record<string, string> = {
  stock: '股票',
  fund: '基金',
  etf: 'ETF',
  lof: 'LOF',
}

export function AllocationPanel() {
  const exposure = useRiskStore((s) => s.exposure)
  const loading = useRiskStore((s) => s.loading)
  const error = useRiskStore((s) => s.error)

  const segments: AllocationSegment[] = useMemo(() => {
    const assetExposure = exposure.filter((e) => e.category_type === 'asset_type')
    if (assetExposure.length === 0) return []

    return assetExposure.map((e) => {
      const typeInfo = TYPE_COLORS[e.category] ?? { color: '#c99a05', className: 'cash' }
      return {
        name: TYPE_LABELS[e.category] ?? e.category,
        value: Math.round(e.weight_pct),
        color: typeInfo.color,
        className: typeInfo.className,
      }
    })
  }, [exposure])

  if (error && exposure.length === 0) {
    return (
      <Panel title="资产配置" actions={<button className="text-button">调仓模拟</button>}>
        <div style={{ color: 'var(--red)', fontSize: 13, padding: 20, textAlign: 'center' }}>
          加载失败：{error}
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="资产配置" actions={<button className="text-button">调仓模拟</button>}>
      <AllocationDonut segments={segments} loading={loading && exposure.length === 0} />
    </Panel>
  )
}
