import { useCallback, useEffect, useRef, useState } from 'react'
import { ConsentScreen } from './components/ConsentScreen'
import { History, type HistoryItem } from './components/History'
import { LanguagePicker } from './components/LanguagePicker'
import { ListenControls } from './components/ListenControls'
import { TranslationDisplay } from './components/TranslationDisplay'
import { DEFAULT_LISTEN, DEFAULT_TARGET } from './lib/languages'
import { createRecognition, isSpeechRecognitionSupported } from './lib/speech'
import { translate } from './lib/translate'
import { Privacy } from './pages/Privacy'

const CONSENT_KEY = 'travel-translator-consent-v1'
const HISTORY_MAX = 20

type Page = 'home' | 'privacy'

function readConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const [consented, setConsented] = useState(readConsent)
  const [page, setPage] = useState<Page>('home')

  const [listenLang, setListenLang] = useState(DEFAULT_LISTEN)
  const [targetLang, setTargetLang] = useState(DEFAULT_TARGET)

  const [listening, setListening] = useState(false)
  const [interimSource, setInterimSource] = useState('')
  const [lastSource, setLastSource] = useState('')
  const [translation, setTranslation] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const wantListenRef = useRef(false)
  const translatingRef = useRef(false)
  const queueRef = useRef<string[]>([])
  const listenLangRef = useRef(listenLang)
  const targetLangRef = useRef(targetLang)

  listenLangRef.current = listenLang
  targetLangRef.current = targetLang

  const supported = isSpeechRecognitionSupported()

  const stopListening = useCallback(() => {
    wantListenRef.current = false
    setListening(false)
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
  }, [])

  const processQueue = useCallback(async () => {
    if (translatingRef.current) return
    translatingRef.current = true

    while (queueRef.current.length > 0) {
      const text = queueRef.current.shift()!
      setStatus('번역 중…')
      setError(null)
      const result = await translate(text, listenLangRef.current, targetLangRef.current)
      if (result.ok) {
        setTranslation(result.text)
        setLastSource(text)
        setStatus(null)
        setHistory((prev) => {
          const next: HistoryItem[] = [
            { id: `${Date.now()}-${Math.random()}`, source: text, translation: result.text, at: Date.now() },
            ...prev,
          ]
          return next.slice(0, HISTORY_MAX)
        })
      } else {
        setError(result.message)
        setStatus(null)
      }
    }

    translatingRef.current = false
  }, [])

  const startListening = useCallback(() => {
    if (!supported) return
    stopListening()

    wantListenRef.current = true
    setError(null)
    setStatus(null)

    const recognition = createRecognition(
      listenLangRef.current,
      {
        onStart: () => setListening(true),
        onEnd: () => {
          if (!wantListenRef.current) setListening(false)
        },
        onInterim: (text) => setInterimSource(text),
        onFinal: (text) => {
          setInterimSource('')
          setLastSource(text)
          queueRef.current.push(text)
          void processQueue()
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
      setError('음성 인식을 시작할 수 없습니다.')
      wantListenRef.current = false
      return
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      setError('음성 인식을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.')
      wantListenRef.current = false
      setListening(false)
    }
  }, [supported, stopListening, processQueue])

  // Auto-stop when tab hidden / window blur
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && wantListenRef.current) {
        stopListening()
        setStatus('탭이 숨겨져 듣기를 중지했습니다.')
      }
    }
    const onBlur = () => {
      if (wantListenRef.current) {
        stopListening()
        setStatus('창 포커스가 사라져 듣기를 중지했습니다.')
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
    }
  }, [stopListening])

  // Cleanup on unmount
  useEffect(() => () => stopListening(), [stopListening])

  const acceptConsent = () => {
    try {
      localStorage.setItem(CONSENT_KEY, '1')
    } catch {
      /* ignore */
    }
    setConsented(true)
  }

  if (!consented) {
    return <ConsentScreen onAccept={acceptConsent} />
  }

  if (page === 'privacy') {
    return <Privacy onBack={() => setPage('home')} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1 className="app-title">여행 통역</h1>
          <p className="app-tagline">상대 말 → 큰 글씨 번역</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPage('privacy')}>
          개인정보·법적 안내
        </button>
      </header>

      <main className="app-main">
        <div className="lang-row">
          <LanguagePicker
            id="listen-lang"
            label="듣는 언어"
            value={listenLang}
            onChange={setListenLang}
            disabled={listening}
          />
          <LanguagePicker
            id="target-lang"
            label="번역할 언어"
            value={targetLang}
            onChange={setTargetLang}
            disabled={listening}
          />
        </div>

        <ListenControls
          listening={listening}
          supported={supported}
          onStart={startListening}
          onStop={stopListening}
        />

        <TranslationDisplay
          translation={translation}
          interimSource={interimSource}
          lastSource={lastSource}
          status={status}
          error={error}
        />

        <History items={history} onClear={() => setHistory([])} />
      </main>

      <footer className="app-footer">
        <p>오디오 미저장 · 계정/광고 없음 · Chrome 권장</p>
      </footer>
    </div>
  )
}
