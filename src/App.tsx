import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_LISTEN, DEFAULT_TARGET, LANGUAGES } from './lib/languages'
import { createRecognition, isSpeechRecognitionSupported } from './lib/speech'
import { translate } from './lib/translate'
import { Privacy } from './pages/Privacy'

/** Wait after the last interim update before calling translate(). */
const INTERIM_DEBOUNCE_MS = 400
const HISTORY_MAX = 3

type Page = 'home' | 'privacy'

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

function ListenOrb({
  listening,
  disabled,
  onToggle,
}: {
  listening: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <div className="orb-dock">
      <button
        type="button"
        className={listening ? 'orb is-live' : 'orb'}
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={listening}
        aria-label={listening ? '듣기 중지' : '듣기 시작'}
      >
        <span className="ring r1" aria-hidden="true" />
        <span className="ring r2" aria-hidden="true" />
        <span className="ring r3" aria-hidden="true" />
      </button>
      <p className="orb-caption" aria-hidden="true">
        {listening ? '중지' : '듣기'}
      </p>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [listenLang, setListenLang] = useState(DEFAULT_LISTEN)
  const [targetLang, setTargetLang] = useState(DEFAULT_TARGET)
  const [listening, setListening] = useState(false)
  const [interimSource, setInterimSource] = useState('')
  const [lastSource, setLastSource] = useState('')
  const [translation, setTranslation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const supported = isSpeechRecognitionSupported()

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const wantListenRef = useRef(false)
  const listenLangRef = useRef(listenLang)
  const targetLangRef = useRef(targetLang)
  const interimTimerRef = useRef<number | null>(null)
  const interimSourceRef = useRef('')
  const scheduledTextRef = useRef('')
  // Request generation id — a slower earlier translate() must not overwrite a newer one.
  const requestGenRef = useRef(0)
  const inflightTextRef = useRef('')
  const shownSourceRef = useRef('')
  const shownTranslationRef = useRef('')
  const historyWaitRef = useRef<string | null>(null)
  const lastSavedRef = useRef({ source: '', at: 0 })
  const seqRef = useRef(0)
  const aliveRef = useRef(true)

  useEffect(() => {
    listenLangRef.current = listenLang
    targetLangRef.current = targetLang
  }, [listenLang, targetLang])

  const clearInterimTimer = useCallback(() => {
    if (interimTimerRef.current !== null) {
      window.clearTimeout(interimTimerRef.current)
      interimTimerRef.current = null
    }
  }, [])

  const commitHistory = useCallback((source: string, translated: string) => {
    const now = Date.now()
    if (lastSavedRef.current.source === source && now - lastSavedRef.current.at < 1200) return
    lastSavedRef.current = { source, at: now }
    const id = `${now}-${++seqRef.current}`
    setHistory((prev) => [{ id, source, translation: translated }, ...prev].slice(0, HISTORY_MAX))
  }, [])

  const updateDisplay = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text) return
      if (text === shownSourceRef.current && shownTranslationRef.current) return
      if (text === inflightTextRef.current) return

      const requestId = ++requestGenRef.current
      inflightTextRef.current = text

      const result = await translate(text, listenLangRef.current, targetLangRef.current)
      if (!aliveRef.current) return

      const fresh = requestId === requestGenRef.current
      if (fresh) inflightTextRef.current = ''

      if (historyWaitRef.current === text) {
        if (result.ok) commitHistory(text, result.text)
        historyWaitRef.current = null
      }

      if (!fresh) return
      if (!result.ok) {
        setError(result.message)
        return
      }

      setError(null)
      setTranslation(result.text)
      shownSourceRef.current = text
      shownTranslationRef.current = result.text
    },
    [commitHistory],
  )

  const translateFinal = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text) return

      if (text === shownSourceRef.current && shownTranslationRef.current) {
        commitHistory(text, shownTranslationRef.current)
        return
      }

      if (text === inflightTextRef.current) {
        historyWaitRef.current = text
        return
      }

      if (historyWaitRef.current === text) historyWaitRef.current = null

      const requestId = ++requestGenRef.current
      inflightTextRef.current = text

      const result = await translate(text, listenLangRef.current, targetLangRef.current)
      if (!aliveRef.current) return

      const fresh = requestId === requestGenRef.current
      if (fresh) inflightTextRef.current = ''

      if (!result.ok) {
        if (fresh) setError(result.message)
        return
      }

      commitHistory(text, result.text)
      if (!fresh) return

      setError(null)
      setTranslation(result.text)
      shownSourceRef.current = text
      shownTranslationRef.current = result.text
    },
    [commitHistory],
  )

  const scheduleInterim = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text) return
      if (text === scheduledTextRef.current && interimTimerRef.current !== null) return
      if (text === shownSourceRef.current && shownTranslationRef.current) return

      scheduledTextRef.current = text
      clearInterimTimer()
      interimTimerRef.current = window.setTimeout(() => {
        interimTimerRef.current = null
        void updateDisplay(text)
      }, INTERIM_DEBOUNCE_MS)
    },
    [clearInterimTimer, updateDisplay],
  )

  const stopListening = useCallback(() => {
    wantListenRef.current = false
    setListening(false)
    clearInterimTimer()

    const tail = interimSourceRef.current.trim()
    interimSourceRef.current = ''
    scheduledTextRef.current = ''
    setInterimSource('')

    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) {
      try {
        rec.onend = null
        rec.stop()
      } catch {
        /* ignore */
      }
    }

    if (tail) void updateDisplay(tail)
  }, [clearInterimTimer, updateDisplay])

  const startListening = useCallback(() => {
    if (!isSpeechRecognitionSupported()) return

    wantListenRef.current = false
    const prev = recognitionRef.current
    recognitionRef.current = null
    if (prev) {
      try {
        prev.onend = null
        prev.stop()
      } catch {
        /* ignore */
      }
    }

    wantListenRef.current = true
    setError(null)

    const recognition = createRecognition(
      listenLangRef.current,
      {
        onStart: () => setListening(true),
        onEnd: () => {
          if (!wantListenRef.current) setListening(false)
        },
        onInterim: (text) => {
          const next = text.trim()
          if (!next) return
          interimSourceRef.current = next
          setInterimSource(next)
          scheduleInterim(next)
        },
        onFinal: (text) => {
          const next = text.trim()
          if (!next) return
          clearInterimTimer()
          scheduledTextRef.current = ''
          interimSourceRef.current = ''
          setInterimSource('')
          setLastSource(next)
          void translateFinal(next)
        },
        onError: (message) => {
          setError(message)
          if (message.includes('권한이 거부')) {
            wantListenRef.current = false
            setListening(false)
          }
        },
      },
      () => wantListenRef.current,
    )

    if (!recognition) {
      setError('음성 인식을 시작할 수 없어요.')
      wantListenRef.current = false
      return
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      recognitionRef.current = null
      wantListenRef.current = false
      setListening(false)
      setError('음성 인식을 시작할 수 없어요. 잠시 후 다시 시도해 주세요.')
    }
  }, [clearInterimTimer, scheduleInterim, translateFinal])

  // Stop when the tab is hidden. Do not stop on window blur — that breaks mobile.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && wantListenRef.current) {
        stopListening()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [stopListening])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      wantListenRef.current = false
      if (interimTimerRef.current !== null) {
        window.clearTimeout(interimTimerRef.current)
        interimTimerRef.current = null
      }
      const rec = recognitionRef.current
      recognitionRef.current = null
      if (rec) {
        try {
          rec.onend = null
          rec.abort()
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  const toggleListen = () => {
    if (!supported) return
    if (wantListenRef.current) stopListening()
    else startListening()
  }

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

  const heard = interimSource || lastSource
  const hint = !supported
    ? 'Chrome에서만 들을 수 있어요'
    : listening
      ? '듣는 중'
      : '아래를 눌러 들으세요'

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
              <option key={lang.code} value={lang.code}>
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

      <main className="stage">
        <div className="stage-inner">
          <p
            className={translation ? heroClass(translation) : 'hero-hint'}
            aria-live="polite"
            lang={translation ? targetLang : 'ko'}
          >
            {translation || hint}
          </p>

          {heard && (
            <p className="heard" lang={listenLang}>
              <span className="sr-only">들린 말 </span>
              {heard}
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
        <ListenOrb listening={listening} disabled={!supported} onToggle={toggleListen} />
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
