/** Web Speech API helpers — structured for more languages later */

export function getSpeechRecognitionConstructor(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null
}

export interface RecognitionHandlers {
  /** Full transcript of the current recognition session (finals + interim). */
  onLine: (sessionText: string) => void
  onError: (message: string) => void
  onStart: () => void
  onEnd: () => void
}

/**
 * Continuous SpeechRecognition with interimResults.
 * Caller owns start/stop. Unexpected end restarts only while `shouldRun` is true.
 * Do not stop() on a timer — that cuts the speaker off. The UI debounces a stable line instead.
 */
export function createRecognition(
  lang: string,
  handlers: RecognitionHandlers,
  shouldRun: () => boolean,
): SpeechRecognition | null {
  const Ctor = getSpeechRecognitionConstructor()
  if (!Ctor) return null

  const recognition = new Ctor()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = lang
  recognition.maxAlternatives = 1

  recognition.onstart = () => handlers.onStart()

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    // Whole session, not only resultIndex, so the heard line is the current hypothesis.
    let full = ''
    for (let i = 0; i < event.results.length; i++) {
      full += event.results[i][0]?.transcript ?? ''
    }
    const text = full.replace(/\s+/g, ' ').trim()
    if (text) handlers.onLine(text)
  }

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
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
    if (shouldRun()) {
      try {
        recognition.start()
      } catch {
        // Ignored — may already be starting
      }
    }
  }

  return recognition
}
