export interface HistoryItem {
  id: string
  source: string
  translation: string
  at: number
}

interface HistoryProps {
  items: HistoryItem[]
  onClear: () => void
}

export function History({ items, onClear }: HistoryProps) {
  if (items.length === 0) return null

  return (
    <section className="history" aria-label="최근 번역">
      <div className="history-header">
        <h2 className="history-title">최근 기록</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          지우기
        </button>
      </div>
      <ul className="history-list">
        {items.map((item) => (
          <li key={item.id} className="history-item">
            <p className="history-translation">{item.translation}</p>
            <p className="history-source">{item.source}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
