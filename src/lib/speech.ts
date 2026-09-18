/** Web Speech API — one recording take until halt(). A pause does not stop the mic. */

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
   * Full transcript of this take so far, interim words included.
   * An engine restart inside the same take does not drop earlier words.
   * Not a cue to translate every update. halt() aborts the mic.
   */
  onTranscript: (transcript: string) => void
  onError: (message: string) => void
  onStart: () => void
  onEnd: () => void
}

export interface RecognitionController {
  /** Call from a user gesture so the browser allows the microphone. */
  start: () => void
  /**
   * Abort this take. Later results are dropped and this instance will not restart.
   * Chrome often ignores stop()/abort() while the engine is still "starting";
   * halt() aborts again from onstart so the mic cannot outlive the stopped button.
   */
  halt: () => void
  /** Words heard in this take so far. Read this before halt() when the user stops. */
  transcript: () => string
}

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Join result transcripts of one engine session. */
function phraseText(parts: readonly SpeechPart[], fromIndex: number): string {
  let full = ''
  const start = fromIndex > 0 ? fromIndex : 0
  for (let i = start; i < parts.length; i++) {
    const chunk = parts[i]?.transcript ?? ''
    if (!chunk) continue
    if (full && !/\s$/.test(full) && !/^\s/.test(chunk)) full += ' '
    full += chunk
  }
  return norm(full)
}

function sessionTranscript(parts: readonly SpeechPart[]): string {
  return phraseText(parts, 0)
}

function joinTranscript(left: string, right: string): string {
  const a = norm(left)
  const b = norm(right)
  if (!a) return b
  if (!b) return a
  return `${a} ${b}`
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
 * One user take: continuous recognition with interim results, until halt().
 * A pause does not stop the mic.
 * If the engine ends on its own, it restarts only while `shouldRun` is still
 * true (the caller's generation) and halt() was not called. Words from those
 * sessions stay on the same transcript.
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
  let sealed = ''
  let live = ''
  const givenUp = () => halted || !shouldRun()
  const current = () => joinTranscript(sealed, live)

  const sealSession = () => {
    const chunk = norm(live)
    live = ''
    if (!chunk) return
    sealed = joinTranscript(sealed, chunk)
  }

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
    live = sessionTranscript(parts)
    const text = current()
    if (!text) return
    handlers.onTranscript(text)
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
    // Keep words before a restart replaces the result list.
    sealSession()
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
    transcript() {
      return current()
    },
  }
}
