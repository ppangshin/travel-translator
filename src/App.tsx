import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LISTEN, DEFAULT_TARGET, LANGUAGES } from './lib/languages'
import { createRecognition, isSpeechRecognitionSupported, phraseText } from './lib/speech'
import type { RecognitionController, SpeechPart } from './lib/speech'
import { translate } from './lib/translate'
import { Privacy } from './pages/Privacy'

/**
 * A phrase ends when the heard line has been still for this long, or on mute.
 * Not on every interim tick, and not by restarting recognition.
 */
const PAUSE_MS = 600
const HISTORY_MAX = 2

type Page = 'home' | 'privacy'

interface HistoryItem {
  id: string
  translation: string
}

function OrbMark({ live, muted }: { live: boolean; muted?: boolean }) {
  const className = live ? 'orb is-live' : muted ? 'orb is-muted' : 'orb'
  return (
    <span className={className} aria-hidden="true">
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
  const [armed, setArmed] = useState(false)
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const [settledSource, setSettledSource] = useState('')
  const [translation, setTranslation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const supported = isSpeechRecognitionSupported()

  const recognitionRef = useRef<RecognitionController | null>(null)
  const wantListenRef = useRef(false)
  /** Bumped on every start and stop. Results from an older epoch are dropped. */
  const listenEpochRef = useRef(0)
  const listenLangRef = useRef(listenLang)
  const targetLangRef = useRef(targetLang)
  const heardRef = useRef('')
  const settledSourceRef = useRef('')
  const settledTranslationRef = useRef('')
  // Bumped when the heard line changes so a slower earlier translate() cannot paint over a newer line.
  const requestGenRef = useRef(0)
  const pendingLineRef = useRef('')
  /**
   * Phrases committed on a pause/mute, translated in order.
   * A later result can return first; it waits so the screen does not skip a phrase.
   */
  const slotsRef = useRef<Map<number, { source: string; status: 'pending' | 'ready' | 'skip'; text: string }>>(
    new Map(),
  )
  const nextSlotRef = useRef(1)
  const slotSeqRef = useRef(0)
  const pauseTimerRef = useRef<number | null>(null)
  const partsRef = useRef<SpeechPart[]>([])
  /** Results before this index already belong to earlier phrases in this session. */
  const consumedRef = useRef(0)
  const sessionIdRef = useRef(0)
  const seqRef = useRef(0)
  const aliveRef = useRef(true)
  const handlePartsRef = useRef<(parts: SpeechPart[]) => void>(() => {})
  const stopRef = useRef<() => void>(() => {})

  useEffect(() => {
    listenLangRef.current = listenLang
    targetLangRef.current = targetLang
  }, [listenLang, targetLang])

  function clearPause() {
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current)
      pauseTimerRef.current = null
    }
  }

  function rememberPrevious(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const id = `${Date.now()}-${++seqRef.current}`
    setHistory((prev) => {
      if (prev[0]?.translation === trimmed) return prev
      return [{ id, translation: trimmed }, ...prev].slice(0, HISTORY_MAX)
    })
  }

  /** Current Korean stays on the big line. The line it replaces moves to history. */
  function adoptTranslation(source: string, text: string) {
    const prevText = settledTranslationRef.current
    if (prevText && prevText !== text) rememberPrevious(prevText)
    settledSourceRef.current = source
    settledTranslationRef.current = text
    setSettledSource(source)
    setTranslation(text)
    setError(null)
  }

  function openSlot(source: string): number {
    const id = ++slotSeqRef.current
    slotsRef.current.set(id, { source, status: 'pending', text: '' })
    return id
  }

  function flushSlots() {
    let id = nextSlotRef.current
    while (true) {
      const slot = slotsRef.current.get(id)
      if (!slot || slot.status === 'pending') return
      slotsRef.current.delete(id)
      nextSlotRef.current = id + 1
      if (
        slot.status === 'ready' &&
        slot.text &&
        !(slot.source === settledSourceRef.current && slot.text === settledTranslationRef.current)
      ) {
        adoptTranslation(slot.source, slot.text)
      }
      id = nextSlotRef.current
    }
  }

  function finishSlot(id: number, status: 'ready' | 'skip', translated = '') {
    const slot = slotsRef.current.get(id)
    if (!slot || slot.status !== 'pending') return
    slot.status = status
    slot.text = translated
    flushSlots()
  }

  async function translateSlot(text: string, slotId: number) {
    const result = await translate(text, listenLangRef.current, targetLangRef.current)
    if (!aliveRef.current) return
    if (!result.ok) {
      if (heardRef.current === text) setError(result.message)
      finishSlot(slotId, 'skip')
      return
    }
    finishSlot(slotId, 'ready', result.text)
  }

  /** Queue one finished phrase. Later phrases wait so a slow reply cannot skip this one. */
  function commitLine(line: string, gen: number) {
    const text = line.trim()
    if (!text) return
    if (gen !== requestGenRef.current) return
    if (text === settledSourceRef.current && settledTranslationRef.current) return
    const slotId = openSlot(text)
    void translateSlot(text, slotId)
  }

  function schedulePause(line: string) {
    if (pendingLineRef.current === line && pauseTimerRef.current !== null) return

    clearPause()
    pendingLineRef.current = line
    const gen = requestGenRef.current
    const boundary = partsRef.current.length
    const sessionId = sessionIdRef.current
    pauseTimerRef.current = window.setTimeout(() => {
      pauseTimerRef.current = null
      // Only this session's cursor. A Chrome restart has a fresh result list.
      if (sessionIdRef.current === sessionId && consumedRef.current < boundary) {
        consumedRef.current = boundary
      }
      commitLine(line, gen)
    }, PAUSE_MS)
  }

  function presentLine(line: string) {
    if (line !== heardRef.current) {
      heardRef.current = line
      setHeard(line)
      requestGenRef.current += 1
    }
    schedulePause(line)
  }

  function handleParts(parts: SpeechPart[]) {
    if (!wantListenRef.current) return
    partsRef.current = parts
    const line = phraseText(parts, consumedRef.current)
    if (!line) return
    presentLine(line)
  }

  function stopListening() {
    const line = heardRef.current.trim()
    const gen = requestGenRef.current
    const boundary = partsRef.current.length
    const sessionId = sessionIdRef.current
    const needsTail =
      Boolean(line) && !(line === settledSourceRef.current && settledTranslationRef.current)

    // Epoch first: a result already queued, or onend's restart, no longer matches.
    listenEpochRef.current += 1
    wantListenRef.current = false
    setListening(false)
    clearPause()

    const rec = recognitionRef.current
    recognitionRef.current = null
    rec?.halt()

    if (sessionIdRef.current === sessionId && consumedRef.current < boundary) {
      consumedRef.current = boundary
    }

    // Mute is not how you ask for a translation; this only keeps a trailing phrase.
    if (needsTail) commitLine(line, gen)
  }

  function startListening(): boolean {
    if (!isSpeechRecognitionSupported()) return false

    const prev = recognitionRef.current
    recognitionRef.current = null
    prev?.halt()

    const epoch = ++listenEpochRef.current
    wantListenRef.current = true
    sessionIdRef.current += 1
    consumedRef.current = 0
    partsRef.current = []
    setError(null)

    const controller = createRecognition(
      listenLangRef.current,
      {
        onStart: () => {
          if (!aliveRef.current) return
          if (listenEpochRef.current !== epoch || !wantListenRef.current) return
          setListening(true)
          sessionIdRef.current += 1
          consumedRef.current = 0
          partsRef.current = []
        },
        onEnd: () => {
          if (!aliveRef.current) return
          if (listenEpochRef.current !== epoch) return
          if (!wantListenRef.current) setListening(false)
        },
        onParts: (parts) => {
          if (!aliveRef.current) return
          if (listenEpochRef.current !== epoch || !wantListenRef.current) return
          handlePartsRef.current(parts)
        },
        onError: (message) => {
          if (!aliveRef.current) return
          if (listenEpochRef.current !== epoch) return
          setError(message)
          if (message.includes('권한이 거부')) {
            wantListenRef.current = false
            listenEpochRef.current += 1
            setListening(false)
            setArmed(false)
            const current = recognitionRef.current
            recognitionRef.current = null
            current?.halt()
          }
        },
      },
      () => wantListenRef.current && listenEpochRef.current === epoch,
    )

    if (!controller) {
      wantListenRef.current = false
      listenEpochRef.current += 1
      setListening(false)
      setError('음성 인식을 시작할 수 없어요.')
      return false
    }

    recognitionRef.current = controller
    try {
      // Must stay inside the tap handler so the browser allows the mic.
      controller.start()
      setListening(true)
      return true
    } catch {
      recognitionRef.current = null
      wantListenRef.current = false
      listenEpochRef.current += 1
      controller.halt()
      setListening(false)
      setError('음성 인식을 시작할 수 없어요. 잠시 후 다시 시도해 주세요.')
      return false
    }
  }

  /**
   * The mic gesture. Browsers will not open the mic without it.
   * The same control stops listening — the orb is large enough to hit while traveling.
   */
  function onMicGesture() {
    if (wantListenRef.current) {
      stopListening()
      return
    }
    if (!isSpeechRecognitionSupported()) return
    const ok = startListening()
    if (ok) setArmed(true)
  }

  useEffect(() => {
    handlePartsRef.current = handleParts
    stopRef.current = stopListening
  })

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && wantListenRef.current) {
        stopRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      wantListenRef.current = false
      listenEpochRef.current += 1
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current)
        pauseTimerRef.current = null
      }
      const rec = recognitionRef.current
      recognitionRef.current = null
      rec?.halt()
    }
  }, [])

  const swapLanguages = () => {
    if (wantListenRef.current) return
    setListenLang(targetLang)
    setTargetLang(listenLang)
  }

  const openPrivacy = () => {
    stopListening()
    setPage('privacy')
  }

  const clearHistory = () => {
    setHistory([])
  }

  if (page === 'privacy') {
    return <Privacy onBack={() => setPage('home')} />
  }

  const hasTranslation = translation.length > 0
  const sourceLive = heard.length > 0 && heard !== settledSource
  const sourceText = sourceLive ? heard : settledSource
  const headline = hasTranslation ? translation : listening ? '듣는 중' : '음소거됨'

  return (
    <div className="screen">
      <h1 className="sr-only">여행 통역</h1>

      <header className={listening ? 'langbar is-locked' : 'langbar'}>
        <label className="lang-slot">
          <span className="sr-only">듣는 언어</span>
          <select
            aria-label="듣는 언어"
            value={listenLang}
            disabled={listening}
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
            disabled={listening}
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
          disabled={listening}
          aria-label="언어 바꾸기"
        >
          ⇄
        </button>
      </header>

      {!armed ? (
        <button type="button" className="arm" onClick={onMicGesture} disabled={!supported}>
          <span className="arm-copy">
            <span className={supported ? 'arm-hint' : 'hero-hint'}>
              {supported ? '화면을 눌러 듣기' : 'Chrome에서만 들을 수 있어요'}
            </span>
            {supported && (
              <span className="arm-sub" aria-hidden="true">
                말이 멈추면 번역돼요
              </span>
            )}
          </span>
          <OrbMark live={false} />
          {error && (
            <span className="err" role="alert">
              {error}
            </span>
          )}
        </button>
      ) : (
        <>
          <main className="stage">
            <div className="stage-inner">
              <p
                className={hasTranslation ? 'result' : 'result result-wait'}
                aria-live="polite"
                lang={hasTranslation ? targetLang : 'ko'}
              >
                {headline}
              </p>

              {sourceText && (
                <p className="source-line" lang={listenLang}>
                  <span className="sr-only">들린 말 </span>
                  {sourceText}
                </p>
              )}

              {error && (
                <p className="err" role="alert">
                  {error}
                </p>
              )}
            </div>
          </main>

          {history.length > 0 && (
            <section className="recent" aria-label="최근 번역">
              <ul>
                {history.map((item) => (
                  <li key={item.id}>{item.translation}</li>
                ))}
              </ul>
              <button type="button" className="text-btn" onClick={clearHistory}>
                지우기
              </button>
            </section>
          )}

          <div className="dock">
            <button
              type="button"
              className="orb-hit"
              onClick={onMicGesture}
              aria-pressed={listening}
              aria-label={listening ? '음소거' : '다시 듣기'}
            >
              <OrbMark live={listening} muted={!listening} />
              <span className="orb-caption" aria-hidden="true">
                {listening ? '듣는 중' : '다시 듣기'}
              </span>
            </button>
          </div>
        </>
      )}

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
