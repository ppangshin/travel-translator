import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LISTEN, DEFAULT_TARGET, LANGUAGES } from './lib/languages'
import { createRecognition, isSpeechRecognitionSupported } from './lib/speech'
import { translate } from './lib/translate'
import { Privacy } from './pages/Privacy'

/**
 * Record, then translate once.
 * The mic stays on until the same button is tapped again. Nothing is sent to
 * translate() during the take — no pause timer, no auto-commit. Stop bumps the
 * generation, aborts the mic, and translates that take's full transcript once.
 */
const HISTORY_MAX = 2
const NOTHING_HEARD = '들린 말이 없어요.'

type Page = 'home' | 'privacy'

interface HistoryItem {
  id: string
  translation: string
}

function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
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
  const [translating, setTranslating] = useState(false)
  const [heard, setHeard] = useState('')
  const [translation, setTranslation] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const supported = isSpeechRecognitionSupported()

  const recognitionRef = useRef<ReturnType<typeof createRecognition>>(null)
  const wantListenRef = useRef(false)
  /** Bumped on every start and stop. Late results from an older generation cannot update or restart the mic. */
  const generationRef = useRef(0)
  /** Bumped when a new take starts so a late translation cannot overwrite it. */
  const takeIdRef = useRef(0)
  const listenLangRef = useRef(listenLang)
  const targetLangRef = useRef(targetLang)
  const translationRef = useRef('')
  const transcriptRef = useRef('')
  const seqRef = useRef(0)
  const aliveRef = useRef(true)
  const stopRef = useRef<() => void>(() => {})

  function rememberPrevious(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const id = `${Date.now()}-${++seqRef.current}`
    setHistory((prev) => {
      if (prev[0]?.translation === trimmed) return prev
      return [{ id, translation: trimmed }, ...prev].slice(0, HISTORY_MAX)
    })
  }

  async function finishTake(raw: string, takeId: number) {
    if (!aliveRef.current || takeId !== takeIdRef.current) return
    const text = raw.trim()
    if (!hasWords(text)) {
      setTranslating(false)
      setError(null)
      translationRef.current = ''
      setTranslation('')
      transcriptRef.current = ''
      setHeard('')
      setNotice(NOTHING_HEARD)
      return
    }

    setNotice(null)
    setError(null)
    setTranslating(true)
    transcriptRef.current = text
    setHeard(text)

    const from = listenLangRef.current
    const to = targetLangRef.current
    const result = await translate(text, from, to)
    if (!aliveRef.current || takeId !== takeIdRef.current) return
    setTranslating(false)
    if (!result.ok) {
      setError(result.message)
      setHeard(text)
      translationRef.current = ''
      setTranslation('')
      return
    }
    setError(null)
    transcriptRef.current = ''
    setHeard('')
    translationRef.current = result.text
    setTranslation(result.text)
  }

  function stopListening() {
    if (!wantListenRef.current && recognitionRef.current === null) return
    const rec = recognitionRef.current
    const text = (rec?.transcript() || transcriptRef.current).trim()
    const takeId = takeIdRef.current
    // Generation first: a result already queued, or onend's restart, no longer matches.
    generationRef.current += 1
    wantListenRef.current = false
    recognitionRef.current = null
    setRecording(false)
    rec?.halt()
    void finishTake(text, takeId)
  }

  function startListening(): boolean {
    if (!isSpeechRecognitionSupported()) return false

    const prev = recognitionRef.current
    recognitionRef.current = null
    if (prev) {
      generationRef.current += 1
      wantListenRef.current = false
      prev.halt()
    }

    const generation = ++generationRef.current
    wantListenRef.current = true
    transcriptRef.current = ''

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
          transcriptRef.current = transcript
          setHeard(transcript)
        },
        onError: (message) => {
          if (!aliveRef.current) return
          if (generationRef.current !== generation) return
          setError(message)
          if (message.includes('권한이 거부')) {
            wantListenRef.current = false
            generationRef.current += 1
            setRecording(false)
            const current = recognitionRef.current
            recognitionRef.current = null
            current?.halt()
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

    takeIdRef.current += 1
    const prevKo = translationRef.current.trim()
    if (prevKo) rememberPrevious(prevKo)
    translationRef.current = ''
    setTranslation('')
    setNotice(null)
    setError(null)
    setTranslating(false)
    setRecording(true)
    setHeard(transcriptRef.current)
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

  let big = ''
  let bigLang = 'ko'
  let quiet = true
  if (recording) {
    if (heard) {
      big = heard
      bigLang = listenLang
      quiet = false
    } else {
      big = '녹음 중'
    }
  } else if (translating) {
    if (heard) {
      big = heard
      bigLang = listenLang
      quiet = false
    } else {
      big = '번역 중'
    }
  } else if (translation) {
    big = translation
    bigLang = targetLang
    quiet = false
  } else if (heard) {
    big = heard
    bigLang = listenLang
    quiet = false
  } else if (notice) {
    big = notice
  } else if (!supported) {
    big = 'Chrome에서만 들을 수 있어요'
  } else if (!error) {
    big = '녹음한 뒤 한 번만 번역해요'
  }

  const buttonLabel = recording ? '중지' : '녹음'

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

      <main className="stage">
        <div className="stage-inner">
          {big && (
            <>
              {!quiet && !recording && translation && (
                <p className="kicker">번역</p>
              )}
              {recording && heard && <p className="kicker">듣는 중</p>}
              <p
                className={quiet ? 'result result-wait' : 'result'}
                aria-live={recording ? 'off' : 'polite'}
                lang={bigLang}
              >
                {big}
              </p>
            </>
          )}

          {translating && heard && <p className="stage-note">번역 중</p>}

          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
        </div>
      </main>

      {!recording && history.length > 0 && (
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
        {recording && (
          <p id="rec-state" className="rec-state">
            녹음 중 · 중지하면 번역돼요
          </p>
        )}
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
