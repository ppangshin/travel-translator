import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_LISTEN, DEFAULT_TARGET, LANGUAGES } from './lib/languages'
import { createRecognition, isSpeechRecognitionSupported } from './lib/speech'
import { translate } from './lib/translate'
import { Privacy } from './pages/Privacy'

/**
 * One record control. Interim words stay a quiet source line.
 * When that phrase has been still for ~1.1s, it becomes one translation line
 * and is translated once. The mic stays on; the next words start a new line.
 * Stop bumps the generation, halt() aborts the mic, and commits leftover words.
 */

const STILL_MS = 1100
const NOTHING_HEARD = '들린 말이 없어요.'

type Page = 'home' | 'privacy'

interface Line {
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

function stripLead(text: string): string {
  return text.replace(/^[\s.,!?。．！？、，…·:;"'“”‘’()[\]（）\-–—]+/u, '').trim()
}

/**
 * Words after the last committed transcript snapshot.
 * Speech grows by appending; a rewrite that is not a prefix is not re-sent.
 */
function uncommitted(full: string, base: string): string {
  const f = tidy(full)
  const b = tidy(base)
  if (!f || f === b) return ''
  if (!b) return stripLead(f)
  if (f.startsWith(b)) return stripLead(f.slice(b.length))
  // Chrome often capitalizes or adds punctuation after a pause.
  if (f.toLowerCase().startsWith(b.toLowerCase())) return stripLead(f.slice(b.length))
  let i = 0
  const fl = f.toLowerCase()
  const bl = b.toLowerCase()
  const n = Math.min(fl.length, bl.length)
  while (i < n && fl[i] === bl[i]) i++
  if (i >= Math.floor(b.length * 0.7) && f.length > i) return stripLead(f.slice(i))
  return ''
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
  const [lines, setLines] = useState<Line[]>([])
  const [draft, setDraft] = useState('')
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
  /** Transcript snapshot already turned into lines. */
  const baseRef = useRef('')
  const linesRef = useRef<Line[]>([])
  const pauseTimerRef = useRef<number | null>(null)
  const seqRef = useRef(0)
  const aliveRef = useRef(true)
  const stopRef = useRef<() => void>(() => {})
  const sheetRef = useRef<HTMLDivElement>(null)

  function clearPause() {
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current)
      pauseTimerRef.current = null
    }
  }

  function commitPhrase(fullSnapshot: string, emptyNotice = false) {
    const snapshot = tidy(fullSnapshot)
    const text = uncommitted(snapshot, baseRef.current)
    baseRef.current = snapshot
    setDraft('')
    if (!hasWords(text)) {
      if (emptyNotice && linesRef.current.length === 0) setNotice(NOTHING_HEARD)
      else if (linesRef.current.length > 0) setNotice(null)
      return
    }

    const id = String(++seqRef.current)
    const from = listenLangRef.current
    const to = targetLangRef.current
    const line: Line = {
      id,
      source: text,
      sourceLang: from,
      targetLang: to,
      translation: '',
      error: null,
      pending: true,
    }
    linesRef.current = [...linesRef.current, line]
    setLines(linesRef.current)
    setNotice(null)
    void translateLine(id, text, from, to)
  }

  function armStill(generation: number) {
    clearPause()
    const snapshot = transcriptRef.current
    pauseTimerRef.current = window.setTimeout(() => {
      pauseTimerRef.current = null
      if (!aliveRef.current) return
      if (generationRef.current !== generation || !wantListenRef.current) return
      if (transcriptRef.current !== snapshot) return
      commitPhrase(snapshot)
    }, STILL_MS)
  }

  async function translateLine(id: string, text: string, from: string, to: string) {
    const result = await translate(text, from, to)
    if (!aliveRef.current) return
    if (!linesRef.current.some((line) => line.id === id)) return
    linesRef.current = linesRef.current.map((line) => {
      if (line.id !== id) return line
      if (!result.ok) {
        return { ...line, pending: false, translation: '', error: shortError(result.message) }
      }
      return { ...line, pending: false, error: null, translation: result.text }
    })
    setLines(linesRef.current)
  }

  function stopListening() {
    if (!wantListenRef.current && recognitionRef.current === null) return
    const rec = recognitionRef.current
    const text = tidy(rec?.transcript() || transcriptRef.current)
    clearPause()
    // Generation first: a result already queued, or onend's restart, no longer matches.
    generationRef.current += 1
    wantListenRef.current = false
    recognitionRef.current = null
    setRecording(false)
    rec?.halt()
    transcriptRef.current = text
    commitPhrase(text, true)
  }

  function startListening(): boolean {
    if (!isSpeechRecognitionSupported()) return false

    const prev = recognitionRef.current
    recognitionRef.current = null
    if (prev) {
      const leftover = tidy(prev.transcript() || transcriptRef.current)
      clearPause()
      generationRef.current += 1
      wantListenRef.current = false
      prev.halt()
      transcriptRef.current = leftover
      if (hasWords(uncommitted(leftover, baseRef.current))) commitPhrase(leftover)
    }

    clearPause()
    const generation = ++generationRef.current
    wantListenRef.current = true
    transcriptRef.current = ''
    baseRef.current = ''

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
          if (transcript === transcriptRef.current) return
          transcriptRef.current = transcript
          const phrase = uncommitted(transcript, baseRef.current)
          // Do not translate interim words. A still phrase commits once.
          if (!hasWords(phrase)) {
            const t = tidy(transcript)
            const b = tidy(baseRef.current)
            if (b && t.toLowerCase().startsWith(b.toLowerCase())) baseRef.current = t
            setDraft('')
            clearPause()
            return
          }
          setDraft(phrase)
          armStill(generation)
        },
        onError: (message) => {
          if (!aliveRef.current) return
          if (generationRef.current !== generation) return
          setError(message)
          if (message.includes('권한이 거부')) {
            const heard = tidy(transcriptRef.current)
            clearPause()
            wantListenRef.current = false
            generationRef.current += 1
            setRecording(false)
            const current = recognitionRef.current
            recognitionRef.current = null
            current?.halt()
            transcriptRef.current = heard
            if (hasWords(uncommitted(heard, baseRef.current))) commitPhrase(heard)
            else {
              baseRef.current = heard
              setDraft('')
            }
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

    setNotice(null)
    setError(null)
    setDraft('')
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
    clearPause()
    baseRef.current = tidy(transcriptRef.current)
    linesRef.current = []
    setLines([])
    setDraft('')
    setNotice(null)
    setError(null)
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
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current)
        pauseTimerRef.current = null
      }
      const rec = recognitionRef.current
      recognitionRef.current = null
      rec?.halt()
    }
  }, [])

  useLayoutEffect(() => {
    const el = sheetRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines, draft, error, notice, recording, page])

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

  const canClear = lines.length > 0 || hasWords(draft) || Boolean(notice)
  const showIdle = lines.length === 0 && !recording && !error && !hasWords(draft)
  const idleHint = !supported
    ? 'Chrome에서만 들을 수 있어요'
    : (notice ?? '녹음하면 문장마다 번역해요')
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

      {canClear && (
        <div className="clear-row">
          <button type="button" className="text-btn clear-btn" onClick={clearLines}>
            지우기
          </button>
        </div>
      )}

      <div className="sheet" ref={sheetRef} role="main" aria-label="번역">
        <div className="sheet-inner">
          {showIdle && <p className="hint">{idleHint}</p>}

          <div className="lines">
            {lines.map((line) => (
              <article key={line.id} className="line">
                <p className="src" lang={line.sourceLang}>
                  {line.source}
                </p>
                {line.pending && <p className="pending">번역 중</p>}
                {!line.pending && line.translation && (
                  <p className="tr" lang={line.targetLang}>
                    {line.translation}
                  </p>
                )}
                {line.error && (
                  <p className="line-err" role="alert">
                    {line.error}
                  </p>
                )}
              </article>
            ))}
          </div>

          {recording && (
            <p className={draft ? 'draft' : 'draft is-wait'} lang={listenLang} aria-live="off">
              {draft || '듣는 중'}
            </p>
          )}

          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="dock">
        <p id="rec-state" className="rec-state" aria-hidden={recording ? undefined : true}>
          {recording ? '말이 끊기면 번역' : '\u00a0'}
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
