import React, { useEffect, useMemo, useState } from 'react'
import { useNewsStore } from '@/stores/news.store'
import { Panel } from '@/components/ui/Panel'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Tag } from '@/components/ui/Tag'
import { Skeleton } from '@/components/ui/Skeleton'
import type { Importance } from '@shared/types/database'

const IMPORTANCE_TABS = [
  { label: '全部', value: 'all' },
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' },
]

const IMPORTANCE_TAG: Record<
  string,
  { variant: 'danger' | 'warning' | 'ok'; label: string }
> = {
  high: { variant: 'danger', label: '高' },
  medium: { variant: 'warning', label: '中' },
  low: { variant: 'ok', label: '低' },
}

const SENTIMENT_TAG: Record<
  string,
  { variant: 'danger' | 'warning' | 'ok'; label: string }
> = {
  negative: { variant: 'danger', label: '负面' },
  neutral: { variant: 'warning', label: '中性' },
  positive: { variant: 'ok', label: '正面' },
}

export function NewsPage() {
  const { items, loading, error, fetchNews } = useNewsStore()
  const [importanceFilter, setImportanceFilter] = useState<string>('all')
  const [sentimentFilter, setSentimentFilter] = useState('')
  const [search, setSearch] = useState('')
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [refreshLoading, setRefreshLoading] = useState(false)
  const pageSize = 10

  // Initial load
  useEffect(() => {
    fetchNews()
  }, [])

  // Handle importance filter change — fetch from backend
  const handleImportanceChange = (v: string) => {
    setImportanceFilter(v)
    setPage(1)
    const importance = v === 'all' ? undefined : (v as Importance)
    fetchNews({ importance })
  }

  // Handle search with debounce
  const handleSearchChange = (value: string) => {
    setSearch(value)
    if (searchTimeout) clearTimeout(searchTimeout)
    const timeout = setTimeout(() => {
      if (value.trim()) {
        fetchNews({})
      } else {
        const imp = importanceFilter === 'all' ? undefined : (importanceFilter as Importance)
        fetchNews({ importance: imp })
      }
    }, 500)
    setSearchTimeout(timeout)
  }

  // Handle refresh
  const handleRefresh = async () => {
    setRefreshLoading(true)
    const importance = importanceFilter === 'all' ? undefined : (importanceFilter as Importance)
    try {
      await fetchNews({ importance })
    } finally {
      setRefreshLoading(false)
    }
  }

  // Client-side filtering for sentiment and search keyword
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Sentiment filter
      if (sentimentFilter) {
        const s = item.sentiment ?? 0
        if (sentimentFilter === 'negative' && s >= -0.3) return false
        if (sentimentFilter === 'neutral' && (s >= 0.3 || s <= -0.3)) return false
        if (sentimentFilter === 'positive' && s <= 0.3) return false
      }
      // Search filter
      if (search) {
        const q = search.toLowerCase()
        const title = (item.title || '').toLowerCase()
        const summary = (item.summary || '').toLowerCase()
        if (!title.includes(q) && !summary.includes(q)) return false
      }
      return true
    })
  }, [items, sentimentFilter, search])

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredItems.slice(start, start + pageSize)
  }, [filteredItems, page])

  const totalPages = Math.ceil(filteredItems.length / pageSize)

  if (loading && items.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={80} />
          ))}
        </div>
      </div>
    )
  }

  if (error && items.length === 0) {
    return (
      <div className="alert-item severe" style={{ margin: 24 }}>
        <b>舆情数据加载失败</b>
        <p>{error}</p>
        <button className="primary-button" onClick={handleRefresh} style={{ marginTop: 12 }}>
          重试
        </button>
      </div>
    )
  }

  return (
    <div>
      <Panel
        title="舆情中心"
        subtitle={`共 ${filteredItems.length} 条资讯`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="搜索标题或摘要..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{
                height: 30, border: '1px solid var(--line)', borderRadius: 8,
                padding: '0 10px', fontSize: 13, background: 'var(--surface)', width: 180,
              }}
            />
            <SegmentedControl
              options={IMPORTANCE_TABS}
              selected={importanceFilter}
              onChange={handleImportanceChange}
            />
            <button
              className="icon-button"
              onClick={handleRefresh}
              disabled={refreshLoading}
            >
              {refreshLoading ? '刷新中...' : '刷新'}
            </button>
          </div>
        }
      >
        {/* Sentiment filter chips */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[
            { label: '全部情感', value: '' },
            { label: '负面', value: 'negative' },
            { label: '中性', value: 'neutral' },
            { label: '正面', value: 'positive' },
          ].map((t) => (
            <button
              key={t.value}
              className="text-button"
              style={{
                background: sentimentFilter === t.value ? 'var(--blue)' : undefined,
                color: sentimentFilter === t.value ? '#fff' : undefined,
              }}
              onClick={() => setSentimentFilter(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="alert-item severe" style={{ marginBottom: 14 }}>
            <b>加载错误</b>
            <p>{error}</p>
          </div>
        )}

        {/* News list */}
        {pagedItems.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            <p style={{ fontSize: 16, marginBottom: 8 }}>暂无舆情数据</p>
            <p style={{ fontSize: 13 }}>
              系统将自动抓取与持仓相关的新闻资讯
            </p>
          </div>
        ) : (
          <div className="alert-list">
            {pagedItems.map((item) => {
              const imp = IMPORTANCE_TAG[item.importance] || IMPORTANCE_TAG.medium
              const s = item.sentiment ?? 0
              const sentKey =
                s > 0.3 ? 'positive' : s < -0.3 ? 'negative' : 'neutral'
              const sent = SENTIMENT_TAG[sentKey] || SENTIMENT_TAG.neutral
              const isExpanded = expandedId === item.id
              const pubDate = new Date(item.published_at).toLocaleDateString(
                'zh-CN',
                { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
              )

              return (
                <div
                  key={item.id}
                  className={`alert-item ${item.importance === 'high' ? 'severe' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5,
                    }}
                  >
                    <Tag variant={imp.variant}>{imp.label}</Tag>
                    <Tag variant={sent.variant}>{sent.label}</Tag>
                    <span
                      style={{
                        fontSize: 12, color: 'var(--muted)', marginLeft: 'auto',
                      }}
                    >
                      {pubDate} · {item.source}
                    </span>
                  </div>
                  <b style={{ fontSize: 14 }}>{item.title}</b>
                  {isExpanded && (
                    <div
                      style={{
                        marginTop: 10, padding: 12,
                        background: 'var(--surface)', borderRadius: 8,
                      }}
                    >
                      <p style={{ color: 'var(--ink)', lineHeight: 1.8 }}>
                        {item.summary || '暂无摘要'}
                      </p>
                      {item.linked_assets &&
                        item.linked_assets.length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                              关联标的:{' '}
                            </span>
                            {item.linked_assets.map((a) => (
                              <Tag key={a.asset_id} variant="ok">
                                {a.asset_name || a.asset_symbol}
                              </Tag>
                            ))}
                          </div>
                        )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16,
            }}
          >
            <button
              className="icon-button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <span
              style={{
                alignSelf: 'center', fontSize: 13, color: 'var(--muted)',
              }}
            >
              第 {page} / {totalPages} 页
            </span>
            <button
              className="icon-button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </Panel>
    </div>
  )
}
