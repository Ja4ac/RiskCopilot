import React from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePortfolioPage } from '@/features/portfolio/usePortfolioPage'
import { TradeModal } from '@/features/portfolio/TradeModal'
import { FundPurchaseModal } from '@/features/portfolio/FundPurchaseModal'
import { TradeTable } from '@/features/portfolio/TradeTable'

// ─── Main Page ─────────────────────────────────────────────────
export function PositionsPage() {
  const page = usePortfolioPage()

  if (page.loading && page.trades.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Skeleton height={48} />
          <Skeleton height={40} />
          <Skeleton height={300} />
        </div>
      </div>
    )
  }

  if (page.error && page.trades.length === 0) {
    return (
      <div className="alert-item severe" style={{ margin: 24 }}>
        <b>交易数据加载失败</b>
        <p>{page.error}</p>
        <button className="primary-button" onClick={page.refreshPortfolio} style={{ marginTop: 12 }}>
          重试
        </button>
      </div>
    )
  }

  return (
    <div>
      {page.statusMsg && (
        <div
          className={`alert-item ${page.statusMsg.includes('失败') ? 'severe' : ''}`}
          style={{ marginBottom: 14 }}
        >
          <b>{page.statusMsg}</b>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }} />
        <button className="icon-button" title="在线获取全部数据（逐支请求，股票间隔5s，基金间隔10s，防止被屏蔽）" onClick={page.handleForceRefresh}>
          强制刷新
        </button>
        <button className="icon-button" title="仅从本地数据库刷新" onClick={page.refreshPortfolio}>
          刷新
        </button>
        <button className="primary-button" onClick={page.openAddFund}>
          添加基金
        </button>
        <button className="primary-button" onClick={page.openAddTrade}>
          添加股票
        </button>
      </div>

      <TradeTable
        trades={page.trades}
        positions={page.positions}
        summary={page.summary}
        onEdit={page.handleEditTrade}
        onVoid={page.handleVoidTrade}
      />

      <TradeModal
        key={page.editingTrade ? page.editingTrade.id : `new-trade-${page.addModalCounter.current}`}
        visible={page.showModal}
        onClose={page.closeTradeModal}
        onSave={page.editingTrade ? page.handleUpdateTrade : page.handleAddTrade}
        saving={page.saving}
        trade={page.editingTrade}
        mode={page.editingTrade ? 'edit' : 'add'}
      />

      <FundPurchaseModal
        key={page.editingFundTrade ? page.editingFundTrade.id : `new-fund-${page.addModalCounter.current}`}
        visible={page.showFundModal}
        onClose={page.closeFundModal}
        onSave={page.editingFundTrade ? page.handleUpdateFund : page.handleAddFund}
        saving={page.saving}
        editingTrade={page.editingFundTrade ? {
          symbol: page.editingFundTrade.asset?.symbol,
          name: page.editingFundTrade.asset?.name,
          amount: Math.round(page.editingFundTrade.quantity * page.editingFundTrade.price * 100) / 100,
          trade_time: page.editingFundTrade.trade_time,
          side: page.editingFundTrade.side,
        } : null}
        mode={page.editingFundTrade ? 'edit' : 'add'}
      />
    </div>
  )
}
