import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LISTEN, DEFAULT_TARGET, LANGUAGES } from './lib/languages'
import { createRecognition, currentSentence, isSpeechRecognitionSupported } from './lib/speech'
import type { PhraseAnchor, RecognitionController, SpeechPart } from './lib/speech'
import { translate } from './lib/translate'
import { Privacy } from './pages/Privacy'

/**
 * A sentence ends when the heard line has been still for this long, or on mute.
 * Long enough that a mid-word interim tick is not its own translation.
 * Not on every interim result, and not by restarting recognition.
 */
const PAUSE_MS = 1100
const HISTORY_MAX = 2
const RETRY_MAX_MS = 8000

type Page = 'home' | 'privacy'

interface HistoryItem {
  id: string
  translation: string
}

interface Slot {
  id: number
  source: string
  status: 'pending' | 'ready'
  text: string
  inflight: boolean
  attempts: number
  retryTimer: number | null
}

function emptyAnchor(): PhraseAnchor {
  return { index: 0, taken: null }
}

function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
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
  // Bumped when the heard line changes so a slower earlier pause cannot commit a stale line.
  const requestGenRef = useRef(0)
  const pendingLineRef = useRef('')
  /**
   * Sentences committed on a pause/mute, translated in order.
   * A failure stays pending and is retried — it is not skipped.
   */
  const slotsRef = useRef<Map<number, Slot>>(new Map())
  const nextSlotRef = useRef(1)
  const slotSeqRef = useRef(0)
  const pauseTimerRef = useRef<number | null>(null)
  const partsRef = useRef<SpeechPart[]>([])
  /**
   * Parks on the last result Chrome may still rewrite, plus the transcript
   * already sent. Not `parts.length`, which drops an in-place revision.
   */
  const anchorRef = useRef<PhraseAnchor>(emptyAnchor())
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

  function sealAnchor(sessionId: number) {
    if (sessionIdRef.current !== sessionId) return
    const parts = partsRef.current
    if (parts.length === 0) return
    const last = parts.length - 1
    anchorRef.current = {
      index: last,
      taken: (parts[last]?.transcript ?? '').replace(/\s+/g, ' ').trim(),
    }
  }

  function openSlot(source: string): number {
    const id = ++slotSeqRef.current
    slotsRef.current.set(id, {
      id,
      source,
      status: 'pending',
      text: '',
      inflight: false,
      attempts: 0,
      retryTimer: null,
    })
    return id
  }

  function findPending(source: string): Slot | undefined {
    for (const slot of slotsRef.current.values()) {
      if (slot.status === 'pending' && slot.source === source) return slot
    }
    return undefined
  }

  function headSlot(): Slot | undefined {
    let id = nextSlotRef.current
    while (id <= slotSeqRef.current) {
      const slot = slotsRef.current.get(id)
      if (slot) return slot
      id += 1
    }
    return undefined
  }

  function flushSlots() {
    let id = nextSlotRef.current
    while (id <= slotSeqRef.current) {
      const slot = slotsRef.current.get(id)
      if (!slot) {
        id += 1
        nextSlotRef.current = id
        continue
      }
      if (slot.status === 'pending') return
      if (slot.retryTimer !== null) {
        window.clearTimeout(slot.retryTimer)
        slot.retryTimer = null
      }
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

  function scheduleRetry(slotId: number) {
    const slot = slotsRef.current.get(slotId)
    if (!slot || slot.status !== 'pending' || slot.inflight) return
    if (slot.retryTimer !== null) return
    slot.attempts += 1
    const delay = Math.min(PAUSE_MS * slot.attempts, RETRY_MAX_MS)
    slot.retryTimer = window.setTimeout(() => {
      const current = slotsRef.current.get(slotId)
      if (!current) return
      current.retryTimer = null
      if (!aliveRef.current || current.status !== 'pending') return
      void runTranslate(slotId)
    }, delay)
  }

  function nudgeHead() {
    const head = headSlot()
    if (!head || head.status !== 'pending' || head.inflight) return
    if (head.retryTimer !== null) {
      window.clearTimeout(head.retryTimer)
      head.retryTimer = null
    }
    void runTranslate(head.id)
  }

  function showFailedSentence(slotId: number, text: string, message: string) {
    setError(message)
    const live = currentSentence(partsRef.current, anchorRef.current).trim()
    // While the next sentence is already being said, keep that quiet line.
    if (live) return
    for (const slot of slotsRef.current.values()) {
      if (slot.id > slotId) return
    }
    // Nothing newer: the failed sentence stays readable, and the next pause retries it.
    heardRef.current = text
    setHeard(text)
  }

  async function runTranslate(slotId: number) {
    const slot = slotsRef.current.get(slotId)
    if (!slot || slot.status !== 'pending' || slot.inflight) return
    slot.inflight = true
    if (slot.retryTimer !== null) {
      window.clearTimeout(slot.retryTimer)
      slot.retryTimer = null
    }
    const text = slot.source
    const result = await translate(text, listenLangRef.current, targetLangRef.current)
    if (!aliveRef.current) return
    const current = slotsRef.current.get(slotId)
    if (!current || current.status !== 'pending') return
    current.inflight = false
    if (!result.ok) {
      showFailedSentence(slotId, text, result.message)
      scheduleRetry(slotId)
      return
    }
    current.status = 'ready'
    current.text = result.text
    flushSlots()
  }

  /**
   * Queue one finished sentence. Later sentences wait so a slow reply cannot skip this one.
   * The anchor moves onto the result Chrome may still revise, not past it.
   */
  function commitSentence(text: string, gen: number, sessionId: number) {
    const trimmed = text.trim()
    if (!trimmed || !hasWords(trimmed)) return
    if (gen !== requestGenRef.current) return

    if (trimmed === settledSourceRef.current && settledTranslationRef.current) {
      sealAnchor(sessionId)
      return
    }

    const existing = findPending(trimmed)
    if (existing) {
      sealAnchor(sessionId)
      if (!existing.inflight && existing.retryTimer === null) scheduleRetry(existing.id)
      nudgeHead()
      return
    }

    sealAnchor(sessionId)
    const id = openSlot(trimmed)
    void runTranslate(id)
    nudgeHead()
  }

  function schedulePause(line: string) {
    if (pendingLineRef.current === line && pauseTimerRef.current !== null) return

    clearPause()
    pendingLineRef.current = line
    const gen = requestGenRef.current
    const sessionId = sessionIdRef.current
    pauseTimerRef.current = window.setTimeout(() => {
      pauseTimerRef.current = null
      if (gen !== requestGenRef.current) return
      const sameSession = sessionIdRef.current === sessionId
      const live = sameSession ? currentSentence(partsRef.current, anchorRef.current).trim() : ''
      const sentence = sameSession && live ? live : line
      commitSentence(sentence, gen, sessionId)
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
    // A restarted session has a fresh list. Don't read it through the old anchor.
    if (anchorRef.current.index >= parts.length) {
      anchorRef.current = emptyAnchor()
    }
    partsRef.current = parts
    const line = currentSentence(parts, anchorRef.current).trim()
    if (!line) return
    presentLine(line)
  }

  function stopListening() {
    const live = currentSentence(partsRef.current, anchorRef.current).trim()
    const gen = requestGenRef.current
    const sessionId = sessionIdRef.current

    // Epoch first: a result already queued, or onend's restart, no longer matches.
    listenEpochRef.current += 1
    wantListenRef.current = false
    setListening(false)
    clearPause()

    const rec = recognitionRef.current
    recognitionRef.current = null
    rec?.halt()

    // Mute keeps the trailing sentence. It does not abort recognition on a mere pause.
    if (live) commitSentence(live, gen, sessionId)
    else nudgeHead()
  }

  function startListening(): boolean {
    if (!isSpeechRecognitionSupported()) return false

    const prev = recognitionRef.current
    recognitionRef.current = null
    prev?.halt()

    const epoch = ++listenEpochRef.current
    wantListenRef.current = true
    sessionIdRef.current += 1
    anchorRef.current = emptyAnchor()
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
          anchorRef.current = emptyAnchor()
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
    // Same Map for the lifetime of this mount; read it here so cleanup does not touch the ref.
    const slots = slotsRef.current
    return () => {
      aliveRef.current = false
      wantListenRef.current = false
      listenEpochRef.current += 1
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current)
        pauseTimerRef.current = null
      }
      for (const slot of slots.values()) {
        if (slot.retryTimer !== null) {
          window.clearTimeout(slot.retryTimer)
          slot.retryTimer = null
        }
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
