/** Web Speech API helpers — structured for more languages later */

export function getSpeechRecognitionConstructor(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null
}

export interface RecognitionHandlers {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onStart: () => void
  onEnd: () => void
}

/**
 * Create a continuous SpeechRecognition instance.
 * Caller owns start/stop; we restart on unexpected end while `shouldRun` is true.
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
    // Walk the whole list so the unfinished phrase is the full current line,
    // not only the slice after resultIndex.
    let interim = ''
    let newlyFinal = ''
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i]
      const transcript = result[0]?.transcript ?? ''
      if (result.isFinal) {
        if (i >= event.resultIndex) newlyFinal += transcript
      } else {
        interim += transcript
      }
    }
    const finalTrimmed = newlyFinal.trim()
    const interimTrimmed = interim.trim()
    if (finalTrimmed) handlers.onFinal(finalTrimmed)
    if (interimTrimmed) handlers.onInterim(interimTrimmed)
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
    // Auto-restart for continuous listening if still supposed to run
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
