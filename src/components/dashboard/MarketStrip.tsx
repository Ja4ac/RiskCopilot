import { useAppStore } from '@/stores/app.store'

export function MarketStrip() {
  const marketIndices = useAppStore((s) => s.marketIndices)

  if (marketIndices.length === 0) {
    return (
      <div className="market-strip">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton" style={{ height: 12, width: 48, marginBottom: 6, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 18, width: 72, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="market-strip">
      {marketIndices.map((item) => (
        <div key={item.name}>
          <span>{item.name}</span>
          <b className={item.changeClass}>
            {item.price}
            {item.change && (
              <small style={{ marginLeft: 6, fontSize: 12 }}>{item.change}</small>
            )}
          </b>
        </div>
      ))}
    </div>
  )
}
