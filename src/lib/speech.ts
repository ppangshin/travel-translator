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

/**
 * Where the current sentence starts in the session result list.
 * `taken` is the transcript of `parts[index]` already sent to translation.
 * Chrome often rewrites that same index in place; a length cursor (`parts.length`)
 * skips those words. A null `taken` means the index has not been committed yet.
 */
export interface PhraseAnchor {
  index: number
  taken: string | null
}

export interface RecognitionHandlers {
  /**
   * The session's result list, item by item.
   * The UI keeps the uncommitted sentence, including a rewrite of the boundary result.
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

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

/** Join result transcripts. Does not decide which results belong to this sentence. */
export function phraseText(parts: readonly SpeechPart[], fromIndex: number): string {
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

function joinSentence(base: string, extra: string): string {
  const left = norm(base)
  const right = norm(extra)
  const leftOk = hasWords(left)
  const rightOk = hasWords(right)
  if (!leftOk && !rightOk) return ''
  if (!leftOk) return right
  if (!rightOk) return left
  return `${left} ${right}`
}

/**
 * The sentence still waiting to be translated.
 * Results before the anchor are already committed. A growth or rewrite of
 * `parts[anchor.index]` is kept — that is the same result Chrome revises.
 */
export function currentSentence(parts: readonly SpeechPart[], anchor: PhraseAnchor): string {
  const index = anchor.index > 0 ? anchor.index : 0
  if (index >= parts.length) return ''
  if (anchor.taken === null) return phraseText(parts, index)

  const head = norm(parts[index]?.transcript ?? '')
  const taken = norm(anchor.taken)
  const rest = phraseText(parts, index + 1)
  if (!head || head === taken) return rest

  const headKey = head.toLocaleLowerCase()
  const takenKey = taken.toLocaleLowerCase()
  if (taken && headKey.startsWith(takenKey)) {
    const extra =
      head.length === headKey.length && taken.length === takenKey.length
        ? head.slice(taken.length)
        : headKey.slice(takenKey.length)
    return joinSentence(extra, rest)
  }

  // Not a prefix: Chrome replaced this result. Keep the new words.
  return joinSentence(head, rest)
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
 * Do not stop the engine on a sentence pause — that cuts the speaker off.
 * The UI translates after ~1.1s of an unchanged sentence instead.
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
