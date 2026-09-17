interface TranslationDisplayProps {
  translation: string
  interimSource: string
  lastSource: string
  status: string | null
  error: string | null
}

export function TranslationDisplay({
  translation,
  interimSource,
  lastSource,
  status,
  error,
}: TranslationDisplayProps) {
  return (
    <section className="translation-panel" aria-label="번역 결과">
      <h2 className="sr-only">번역</h2>
      <div className="translation-text" aria-live="polite">
        {translation || (
          <span className="placeholder">번역이 여기에 크게 표시됩니다</span>
        )}
      </div>

      {(interimSource || lastSource) && (
        <p className="source-line">
          <span className="source-label">원문</span>{' '}
          {interimSource ? (
            <em className="interim">{interimSource}</em>
          ) : (
            <span>{lastSource}</span>
          )}
        </p>
      )}

      {status && !error && <p className="status-line">{status}</p>}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
