import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_LISTEN, DEFAULT_TARGET, LANGUAGES } from './lib/languages'
import { createRecognition, isSpeechRecognitionSupported } from './lib/speech'
import { translate } from './lib/translate'
import { Privacy } from './pages/Privacy'

/**
 * One record control. While the mic is on, only the heard words are shown,
 * and that line keeps every word heard in this take.
 * Translation runs once, for the whole take, when recording stops.
 * Stop bumps the generation and halt() aborts the mic so a late result cannot restart it.
 */

const NOTHING_HEARD = '들린 말이 없어요.'

type Page = 'home' | 'privacy'

interface Take {
  id: string
  source: string
  sourceLang: string
  targetLang: string
  translation: string
  error: string | null
  pending: boolean
}

function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Keep the longer heard string so a short rewrite cannot throw the take away. */
function bestHeard(a: string, b: string): string {
  const x = tidy(a)
  const y = tidy(b)
  if (!hasWords(x)) return y
  if (!hasWords(y)) return x
  const xl = x.toLowerCase()
  const yl = y.toLowerCase()
  if (xl.includes(yl)) return x
  if (yl.includes(xl)) return y
  return x.length >= y.length ? x : y
}

function shortError(message: string): string {
  if (message.includes('한도') || message.includes('너무 많')) return '번역 한도'
  if (message.includes('비어')) return '번역 없음'
  return '번역 실패'
}

function OrbMark({ live }: { live: boolean }) {
  return (
    <span className={live ? 'orb is-live' : 'orb'} aria-hidden="true">
      <span className="ring r1" />
      <span className="ring r2" />
      <span className="ring r3" />
    </span>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [listenLang, setListenLang] = useState(DEFAULT_LISTEN)
  const [targetLang, setTargetLang] = useState(DEFAULT_TARGET)
  const [recording, setRecording] = useState(false)
  const [current, setCurrent] = useState<Take | null>(null)
  const [history, setHistory] = useState<Take[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [live, setLive] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supported = isSpeechRecognitionSupported()

  const recognitionRef = useRef<ReturnType<typeof createRecognition>>(null)
  const wantListenRef = useRef(false)
  /** Bumped on every start and stop. Late results from an older generation cannot update or restart the mic. */
  const generationRef = useRef(0)
  const listenLangRef = useRef(listenLang)
  const targetLangRef = useRef(targetLang)
  const transcriptRef = useRef('')
  const currentRef = useRef<Take | null>(null)
  const historyRef = useRef<Take[]>([])
  const seqRef = useRef(0)
  const aliveRef = useRef(true)
  const stopRef = useRef<() => void>(() => {})
  const boxRef = useRef<HTMLDivElement>(null)

  function publishTakes() {
    setCurrent(currentRef.current)
    setHistory(historyRef.current)
  }

  function archiveCurrent() {
    const prev = currentRef.current
    if (!prev || !hasWords(prev.source)) return
    historyRef.current = [prev, ...historyRef.current]
    currentRef.current = null
  }

  function patchTake(id: string, patch: (take: Take) => Take) {
    let found = false
    if (currentRef.current?.id === id) {
      currentRef.current = patch(currentRef.current)
      found = true
    }
    const nextHistory = historyRef.current.map((take) => {
      if (take.id !== id) return take
      found = true
      return patch(take)
    })
    if (!found) return
    historyRef.current = nextHistory
    publishTakes()
  }

  async function translateTake(id: string, text: string, from: string, to: string) {
    const result = await translate(text, from, to)
    if (!aliveRef.current) return
    patchTake(id, (take) => {
      if (!result.ok) {
        return { ...take, pending: false, translation: '', error: shortError(result.message) }
      }
      return { ...take, pending: false, error: null, translation: result.text }
    })
  }

  /** Save the whole take and translate it once. Never called while the mic is still the active take. */
  function finishTake(raw: string) {
    const text = tidy(raw)
    transcriptRef.current = text
    setLive('')
    if (!hasWords(text)) {
      setNotice(NOTHING_HEARD)
      publishTakes()
      return
    }
    archiveCurrent()
    const id = String(++seqRef.current)
    const from = listenLangRef.current
    const to = targetLangRef.current
    const take: Take = {
      id,
      source: text,
      sourceLang: from,
      targetLang: to,
      translation: '',
      error: null,
      pending: true,
    }
    currentRef.current = take
    setNotice(null)
    publishTakes()
    void translateTake(id, text, from, to)
  }

  function heardNow(rec: { transcript: () => string } | null, before = ''): string {
    return tidy(bestHeard(rec?.transcript() ?? '', bestHeard(before, transcriptRef.current)))
  }

  function stopListening() {
    if (!wantListenRef.current && recognitionRef.current === null) return
    const rec = recognitionRef.current
    const before = rec?.transcript() ?? transcriptRef.current
    // Generation first: a result already queued, or onend's restart, no longer matches.
    generationRef.current += 1
    wantListenRef.current = false
    recognitionRef.current = null
    setRecording(false)
    rec?.halt()
    const text = heardNow(rec, before)
    transcriptRef.current = text
    finishTake(text)
  }

  function startListening(): boolean {
    if (!isSpeechRecognitionSupported()) return false

    const prev = recognitionRef.current
    recognitionRef.current = null
    if (prev) {
      const before = prev.transcript() || transcriptRef.current
      generationRef.current += 1
      wantListenRef.current = false
      prev.halt()
      const leftover = heardNow(prev, before)
      if (hasWords(leftover)) finishTake(leftover)
    }

    const generation = ++generationRef.current
    wantListenRef.current = true
    transcriptRef.current = ''
    setLive('')
    setNotice(null)
    setError(null)

    const controller = createRecognition(
      listenLangRef.current,
      {
        onStart: () => {
          if (!aliveRef.current) return
          if (generationRef.current !== generation || !wantListenRef.current) return
          setRecording(true)
        },
        onEnd: () => {
          if (!aliveRef.current) return
          if (generationRef.current !== generation) return
          if (!wantListenRef.current) setRecording(false)
        },
        onTranscript: (transcript) => {
          if (!aliveRef.current) return
          if (generationRef.current !== generation || !wantListenRef.current) return
          const text = tidy(transcript)
          if (!text || text === transcriptRef.current) return
          transcriptRef.current = text
          // Heard words only. Translation waits for stop.
          setLive(text)
        },
        onError: (message) => {
          if (!aliveRef.current) return
          if (generationRef.current !== generation) return
          setError(message)
          if (message.includes('권한이 거부')) {
            const currentRec = recognitionRef.current
            const before = currentRec?.transcript() ?? transcriptRef.current
            wantListenRef.current = false
            generationRef.current += 1
            recognitionRef.current = null
            setRecording(false)
            currentRec?.halt()
            const text = heardNow(currentRec, before)
            transcriptRef.current = text
            if (hasWords(text)) finishTake(text)
            else setLive('')
          }
        },
      },
      () => wantListenRef.current && generationRef.current === generation,
    )

    if (!controller) {
      wantListenRef.current = false
      generationRef.current += 1
      setRecording(false)
      setError('음성 인식을 시작할 수 없어요.')
      return false
    }

    recognitionRef.current = controller
    try {
      // Must stay inside the tap handler so the browser allows the mic.
      controller.start()
    } catch {
      recognitionRef.current = null
      wantListenRef.current = false
      generationRef.current += 1
      controller.halt()
      setRecording(false)
      setError('음성 인식을 시작할 수 없어요. 잠시 후 다시 시도해 주세요.')
      return false
    }

    // Mic is on. This box is the new live line; the previous result moves to history.
    archiveCurrent()
    publishTakes()
    setRecording(true)
    return true
  }

  function onMicGesture() {
    if (wantListenRef.current) {
      stopListening()
      return
    }
    if (!isSpeechRecognitionSupported()) return
    startListening()
  }

  function clearLines() {
    historyRef.current = []
    currentRef.current = null
    setHistory([])
    setCurrent(null)
    setNotice(null)
    setError(null)
    if (wantListenRef.current && recognitionRef.current) {
      recognitionRef.current.forget()
      const shown = tidy(recognitionRef.current.transcript())
      transcriptRef.current = shown
      setLive(shown)
      return
    }
    transcriptRef.current = ''
    setLive('')
  }

  useEffect(() => {
    listenLangRef.current = listenLang
    targetLangRef.current = targetLang
    stopRef.current = stopListening
  })

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      wantListenRef.current = false
      generationRef.current += 1
      const rec = recognitionRef.current
      recognitionRef.current = null
      rec?.halt()
    }
  }, [])

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    if (!recording) {
      el.scrollTop = 0
      return
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [live, recording, current])

  const swapLanguages = () => {
    if (wantListenRef.current) return
    setListenLang(targetLang)
    setTargetLang(listenLang)
  }

  const openPrivacy = () => {
    stopListening()
    setPage('privacy')
  }

  if (page === 'privacy') {
    return <Privacy onBack={() => setPage('home')} />
  }

  const canClear = history.length > 0 || current !== null || hasWords(live) || Boolean(notice) || Boolean(error)
  const buttonLabel = recording ? '중지' : '녹음'
  const idleHint = !supported ? 'Chrome에서만 들을 수 있어요' : (notice ?? '녹음하고 멈추면 번역해요')

  return (
    <div className="screen">
      <h1 className="sr-only">여행 통역</h1>

      <header className={recording ? 'langbar is-locked' : 'langbar'}>
        <label className="lang-slot">
          <span className="sr-only">듣는 언어</span>
          <select
            aria-label="듣는 언어"
            value={listenLang}
            disabled={recording}
            onChange={(e) => setListenLang(e.target.value)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.labelKo}
              </option>
            ))}
          </select>
        </label>

        <span className="lang-to" aria-hidden="true">
          →
        </span>

        <label className="lang-slot">
          <span className="sr-only">번역 언어</span>
          <select
            aria-label="번역 언어"
            value={targetLang}
            disabled={recording}
            onChange={(e) => setTargetLang(e.target.value)}
          >
            {LANGUAGES.map((lang) => (
              <option key={`to-${lang.code}`} value={lang.code}>
                {lang.labelKo}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="swap"
          onClick={swapLanguages}
          disabled={recording}
          aria-label="언어 바꾸기"
        >
          ⇄
        </button>
      </header>

      {canClear && (
        <div className="clear-row">
          <button type="button" className="text-btn clear-btn" onClick={clearLines}>
            지우기
          </button>
        </div>
      )}

      <div className="result-box" ref={boxRef} role="region" aria-label="번역">
        {!recording && !current && <p className="hint">{idleHint}</p>}

        {recording && (
          <p className={hasWords(live) ? 'src' : 'src is-wait'} lang={listenLang} aria-live="off">
            {hasWords(live) ? live : '듣는 중'}
          </p>
        )}

        {!recording && current && (
          <div className="take">
            <p className="src" lang={current.sourceLang}>
              {current.source}
            </p>
            {current.pending ? <p className="pending">번역 중</p> : null}
            {!current.pending && current.translation ? (
              <p className="tr" lang={current.targetLang}>
                {current.translation}
              </p>
            ) : null}
            {current.error ? (
              <p className="line-err" role="alert">
                {current.error}
              </p>
            ) : null}
          </div>
        )}

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="history">
        {historyOpen && (
          <div id="history-panel" className="history-panel" role="region" aria-label="히스토리">
            {history.length === 0 ? (
              <p className="history-empty">아직 없어요.</p>
            ) : (
              history.map((item) => (
                <article key={item.id} className="hist-item">
                  <p className="hist-en" lang={item.sourceLang}>
                    {item.source}
                  </p>
                  {item.pending ? <p className="hist-ko is-wait">번역 중</p> : null}
                  {!item.pending && item.translation ? (
                    <p className="hist-ko" lang={item.targetLang}>
                      {item.translation}
                    </p>
                  ) : null}
                  {item.error ? <p className="hist-err">{item.error}</p> : null}
                </article>
              ))
            )}
          </div>
        )}
        <button
          type="button"
          className="history-btn"
          aria-expanded={historyOpen}
          aria-controls="history-panel"
          onClick={() => setHistoryOpen((open) => !open)}
        >
          히스토리
        </button>
      </div>

      <div className="dock">
        <p id="rec-state" className="rec-state" aria-hidden={recording ? undefined : true}>
          {recording ? '멈추면 번역' : '\u00a0'}
        </p>
        <button
          type="button"
          className="orb-hit"
          onClick={onMicGesture}
          disabled={!supported}
          aria-pressed={recording}
          aria-label={buttonLabel}
          aria-describedby={recording ? 'rec-state' : undefined}
        >
          <OrbMark live={recording} />
          <span className="orb-caption">{buttonLabel}</span>
        </button>
      </div>

      <footer className="foot">
        <p>
          오디오 미저장 · 법률 자문 아님
          <button type="button" className="foot-link" onClick={openPrivacy}>
            개인정보 / 안내
          </button>
        </p>
      </footer>
    </div>
  )
}
