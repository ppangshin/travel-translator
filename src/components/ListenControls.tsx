interface ListenControlsProps {
  listening: boolean
  supported: boolean
  onStart: () => void
  onStop: () => void
}

export function ListenControls({ listening, supported, onStart, onStop }: ListenControlsProps) {
  if (!supported) {
    return (
      <div className="listen-controls">
        <p className="error-banner" role="alert">
          이 브라우저는 음성 인식을 지원하지 않습니다. Chrome(권장)을 사용해 주세요.
        </p>
      </div>
    )
  }

  return (
    <div className="listen-controls">
      <div className={`listen-indicator ${listening ? 'is-on' : 'is-off'}`} aria-live="polite">
        <span className="listen-dot" aria-hidden="true" />
        <span className="listen-label">{listening ? '듣는 중' : '대기 중'}</span>
      </div>

      {listening ? (
        <button type="button" className="btn btn-danger btn-lg" onClick={onStop}>
          듣기 중지
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-lg" onClick={onStart}>
          듣기 시작
        </button>
      )}
    </div>
  )
}
