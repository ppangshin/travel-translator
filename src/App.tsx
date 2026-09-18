import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LISTEN, DEFAULT_TARGET, LANGUAGES } from './lib/languages'
import { createRecognition, isSpeechRecognitionSupported } from './lib/speech'
import { translate } from './lib/translate'
import { Privacy } from './pages/Privacy'

/**
 * Translate only after the heard line has been unchanged for this long.
 * Not on every interim tick, and not by restarting recognition.
 */
const PAUSE_MS = 600
const HISTORY_MAX = 3

type Page = 'home' | 'privacy'
type HeroMode = 'idle' | 'heard' | 'ko'

interface HistoryItem {
  id: string
  source: string
  translation: string
}

function heroClass(text: string): string {
  const n = Array.from(text).length
  if (n > 70) return 'hero hero-xs'
  if (n > 26) return 'hero hero-sm'
  return 'hero'
}

/**
 * Portion of the session said after the last pause-translation.
 * A missing word boundary means the engine revised the word ("to" → "today"),
 * so the whole session is the current line again.
 */
function tailAfter(session: string, committed: string): string {
  if (!committed) return session
  if (session === committed) return ''
  if (session.startsWith(committed)) {
    const rest = session.slice(committed.length)
    if (/^\s/.test(rest)) return rest.trim()
  }
  return session
}

function OrbMark({ live, muted }: { live: boolean; muted?: boolean }) {
  const className = live ? 'orb is-live' : muted ? 'orb is-muted' : 'orb'
  return (
    <div className={className} aria-hidden="true">
      <span className="ring r1" />
      <span className="ring r2" />
      <span className="ring r3" />
    </div>
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
  const [heroMode, setHeroMode] = useState<HeroMode>('idle')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const supported = isSpeechRecognitionSupported()

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const wantListenRef = useRef(false)
  const listenLangRef = useRef(listenLang)
  const targetLangRef = useRef(targetLang)
  const heardRef = useRef('')
  const sessionRef = useRef('')
  const committedSessionRef = useRef('')
  const settledSourceRef = useRef('')
  const settledTranslationRef = useRef('')
  // Bumped when the heard line changes so a slower earlier translate() cannot paint over a newer line.
  const requestGenRef = useRef(0)
  const inflightRef = useRef('')
  const inflightGenRef = useRef(0)
  const pendingLineRef = useRef('')
  const pauseTimerRef = useRef<number | null>(null)
  const lastSavedRef = useRef({ source: '', at: 0 })
  const seqRef = useRef(0)
  const aliveRef = useRef(true)
  const handleSessionRef = useRef<(session: string) => void>(() => {})
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

  function commitHistory(source: string, translated: string) {
    const now = Date.now()
    if (lastSavedRef.current.source === source && now - lastSavedRef.current.at < 1200) return
    lastSavedRef.current = { source, at: now }
    const id = `${now}-${++seqRef.current}`
    setHistory((prev) => [{ id, source, translation: translated }, ...prev].slice(0, HISTORY_MAX))
  }

  async function translatePaused(line: string, gen: number, sessionAt: string) {
    const text = line.trim()
    if (!text) return
    if (gen !== requestGenRef.current) return
    if (text === settledSourceRef.current && settledTranslationRef.current) {
      if (heardRef.current === text) setHeroMode('ko')
      return
    }
    if (inflightRef.current === text && inflightGenRef.current === gen) return

    inflightRef.current = text
    inflightGenRef.current = gen

    const result = await translate(text, listenLangRef.current, targetLangRef.current)
    if (!aliveRef.current) return
    if (inflightRef.current === text) inflightRef.current = ''

    // Stale: the speaker already moved on, or a newer request owns the screen.
    if (gen !== requestGenRef.current) return
    if (heardRef.current !== text) return
    if (!result.ok) {
      setError(result.message)
      return
    }

    if (sessionRef.current === sessionAt) committedSessionRef.current = sessionAt
    settledSourceRef.current = text
    settledTranslationRef.current = result.text
    setSettledSource(text)
    setTranslation(result.text)
    setHeroMode('ko')
    setError(null)
    commitHistory(text, result.text)
  }

  function schedulePause(line: string) {
    if (
      line === settledSourceRef.current &&
      settledTranslationRef.current &&
      heardRef.current === line
    ) {
      setHeroMode('ko')
      return
    }
    if (pendingLineRef.current === line && pauseTimerRef.current !== null) return

    clearPause()
    pendingLineRef.current = line
    const gen = requestGenRef.current
    const sessionAt = sessionRef.current
    pauseTimerRef.current = window.setTimeout(() => {
      pauseTimerRef.current = null
      void translatePaused(line, gen, sessionAt)
    }, PAUSE_MS)
  }

  function presentLine(line: string) {
    if (
      line === heardRef.current &&
      line === settledSourceRef.current &&
      settledTranslationRef.current
    ) {
      setHeroMode('ko')
      return
    }

    if (line !== heardRef.current) {
      heardRef.current = line
      setHeard(line)
      setHeroMode('heard')
      requestGenRef.current += 1
    }
    schedulePause(line)
  }

  function handleSession(raw: string) {
    if (!wantListenRef.current) return
    const session = raw.replace(/\s+/g, ' ').trim()
    if (!session) return
    sessionRef.current = session

    const committed = committedSessionRef.current
    if (committed && session !== committed && !session.startsWith(committed)) {
      committedSessionRef.current = ''
    }

    const line = tailAfter(session, committedSessionRef.current)
    if (!line) return
    presentLine(line)
  }

  function stopListening() {
    const line = heardRef.current.trim()
    const gen = requestGenRef.current
    const sessionAt = sessionRef.current
    const needsTail =
      Boolean(line) && !(line === settledSourceRef.current && settledTranslationRef.current)

    wantListenRef.current = false
    setListening(false)
    clearPause()

    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) {
      try {
        rec.onend = null
        rec.onresult = null
        rec.onerror = null
        rec.stop()
      } catch {
        /* ignore */
      }
    }

    // Mute is not how you ask for a translation; this only keeps a trailing phrase.
    if (needsTail) void translatePaused(line, gen, sessionAt)
  }

  function startListening(): boolean {
    if (!isSpeechRecognitionSupported()) return false

    const prev = recognitionRef.current
    recognitionRef.current = null
    if (prev) {
      try {
        prev.onend = null
        prev.onresult = null
        prev.onerror = null
        prev.stop()
      } catch {
        /* ignore */
      }
    }

    wantListenRef.current = true
    sessionRef.current = ''
    committedSessionRef.current = ''
    setError(null)

    const recognition = createRecognition(
      listenLangRef.current,
      {
        onStart: () => {
          if (!wantListenRef.current) return
          setListening(true)
          sessionRef.current = ''
          committedSessionRef.current = ''
        },
        onEnd: () => {
          if (!wantListenRef.current) setListening(false)
        },
        onLine: (session) => {
          handleSessionRef.current(session)
        },
        onError: (message) => {
          setError(message)
          if (message.includes('권한이 거부')) {
            wantListenRef.current = false
            setListening(false)
            setArmed(false)
          }
        },
      },
      () => wantListenRef.current,
    )

    if (!recognition) {
      setError('음성 인식을 시작할 수 없어요.')
      wantListenRef.current = false
      setListening(false)
      return false
    }

    recognitionRef.current = recognition
    try {
      // Must stay inside the tap handler so the browser allows the mic.
      recognition.start()
      setListening(true)
      return true
    } catch {
      recognitionRef.current = null
      wantListenRef.current = false
      setListening(false)
      setError('음성 인식을 시작할 수 없어요. 잠시 후 다시 시도해 주세요.')
      return false
    }
  }

  /**
   * The one mic gesture. Browsers will not open the mic without it.
   * After this, listening stays on until mute. The orb is not a record toggle.
   */
  function startFromGesture() {
    if (!isSpeechRecognitionSupported()) return
    if (wantListenRef.current) return
    const ok = startListening()
    setArmed(ok)
  }

  useEffect(() => {
    handleSessionRef.current = handleSession
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
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current)
        pauseTimerRef.current = null
      }
      const rec = recognitionRef.current
      recognitionRef.current = null
      if (rec) {
        try {
          rec.onend = null
          rec.onresult = null
          rec.abort()
        } catch {
          /* ignore */
        }
      }
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
    lastSavedRef.current = { source: '', at: 0 }
    setHistory([])
  }

  if (page === 'privacy') {
    return <Privacy onBack={() => setPage('home')} />
  }

  const showingHeard = heroMode === 'heard' && heard.length > 0
  const showingKo = heroMode === 'ko' && translation.length > 0
  const heroText = showingHeard
    ? heard
    : showingKo
      ? translation
      : listening
        ? '듣는 중'
        : '음소거됨'
  const heroClassName = showingHeard
    ? `${heroClass(heard)} is-pending`
    : showingKo
      ? heroClass(translation)
      : 'hero-hint'

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
        <button
          type="button"
          className="arm"
          onClick={startFromGesture}
          disabled={!supported}
        >
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
                className={heroClassName}
                aria-live="polite"
                lang={showingHeard ? listenLang : showingKo ? targetLang : 'ko'}
              >
                {heroText}
              </p>

              {showingKo && settledSource && (
                <p className="heard" lang={listenLang}>
                  <span className="sr-only">들린 말 </span>
                  {settledSource}
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
              <div className="recent-head">
                <span className="recent-label">최근</span>
                <button type="button" className="text-btn" onClick={clearHistory}>
                  지우기
                </button>
              </div>
              <ul>
                {history.map((item) => (
                  <li key={item.id}>
                    <p className="recent-tr">{item.translation}</p>
                    <p className="recent-src">{item.source}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="dock">
            <div className="orb-dock">
              <OrbMark live={listening} muted={!listening} />
              <p className="orb-caption" aria-hidden="true">
                {listening ? '듣는 중' : '음소거됨'}
              </p>
              <button
                type="button"
                className="mute"
                onClick={listening ? stopListening : startFromGesture}
              >
                {listening ? '음소거' : '다시 듣기'}
              </button>
            </div>
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
