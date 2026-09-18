/** Web Speech API helpers — structured for more languages later */

export function getSpeechRecognitionConstructor(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null
}

/** One entry in the current recognition session's result list. */
export interface SpeechPart {
  transcript: string
  isFinal: boolean
}

export interface RecognitionHandlers {
  /**
   * The session's result list, item by item.
   * The UI keeps only the slice after the last committed phrase.
   */
  onParts: (parts: SpeechPart[]) => void
  onError: (message: string) => void
  onStart: () => void
  onEnd: () => void
}

export interface RecognitionController {
  /** Call from a user gesture so the browser allows the microphone. */
  start: () => void
  /**
   * End this session now. Results that arrive afterward are dropped.
   * This instance will not auto-restart.
   */
  halt: () => void
}

/**
 * Transcript of results[fromIndex..]. That slice is one phrase once earlier
 * results have been consumed. Never falls back to the whole session.
 */
export function phraseText(parts: readonly SpeechPart[], fromIndex: number): string {
  let full = ''
  const start = fromIndex > 0 ? fromIndex : 0
  for (let i = start; i < parts.length; i++) {
    const chunk = parts[i]?.transcript ?? ''
    if (!chunk) continue
    if (full && !/\s$/.test(full) && !/^\s/.test(chunk)) full += ' '
    full += chunk
  }
  return full.replace(/\s+/g, ' ').trim()
}

function snapshot(event: SpeechRecognitionEvent): SpeechPart[] {
  const parts: SpeechPart[] = []
  const list = event.results
  for (let i = 0; i < list.length; i++) {
    const result = list[i]
    parts.push({
      transcript: result?.[0]?.transcript ?? '',
      isFinal: Boolean(result?.isFinal),
    })
  }
  return parts
}

/** abort() while Chrome is still starting is often ignored and does not throw. */
function forceAbort(recognition: SpeechRecognition) {
  try {
    recognition.abort()
  } catch {
    try {
      recognition.stop()
    } catch {
      /* not started */
    }
  }
}

/**
 * Continuous recognition with interim results.
 * Unexpected end restarts only while `shouldRun` is true and halt() was not called.
 * Do not stop the engine on a pause timer — that cuts the speaker off.
 * The UI slices a phrase after ~600ms of silence instead.
 *
 * Chrome ignores stop()/abort() in the "starting" state, then delivers onstart
 * and keeps the mic. halt() prefers abort(), and onstart aborts again if the
 * session was already given up so the mic cannot outlive the muted UI.
 */
export function createRecognition(
  lang: string,
  handlers: RecognitionHandlers,
  shouldRun: () => boolean,
): RecognitionController | null {
  const Ctor = getSpeechRecognitionConstructor()
  if (!Ctor) return null

  const recognition = new Ctor()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = lang
  recognition.maxAlternatives = 1

  let halted = false
  const givenUp = () => halted || !shouldRun()

  recognition.onstart = () => {
    if (givenUp()) {
      forceAbort(recognition)
      return
    }
    handlers.onStart()
  }

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    if (givenUp()) return
    const parts = snapshot(event)
    if (parts.length === 0) return
    handlers.onParts(parts)
  }

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (halted) return
    const err = event.error
    if (err === 'aborted' || err === 'no-speech') return
    if (err === 'not-allowed') {
      handlers.onError('마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.')
      return
    }
    if (err === 'network') {
      handlers.onError('음성 인식 네트워크 오류가 발생했습니다.')
      return
    }
    handlers.onError(`음성 인식 오류: ${err}`)
  }

  recognition.onend = () => {
    handlers.onEnd()
    if (givenUp()) return
    try {
      recognition.start()
    } catch {
      // Already starting, or halt() landed during end.
    }
  }

  return {
    start() {
      if (halted) return
      recognition.start()
    },
    halt() {
      halted = true
      forceAbort(recognition)
    },
  }
}
