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
   * Abort this take. This instance will not restart.
   * Chrome often ignores stop()/abort() while the engine is still "starting";
   * halt() aborts again from onstart so the mic cannot outlive the stopped button.
   * A final result delivered synchronously by abort() is still kept in transcript().
   */
  halt: () => void
  /** Words heard in this take so far (what the UI is showing). */
  transcript: () => string
  /** Hide words heard so far. The mic stays on; later words still accumulate. */
  forget: () => void
}

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

function wordKey(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function commonPrefixCount(prev: string, next: string): number {
  const pw = wordsOf(prev)
  const nw = wordsOf(next)
  let common = 0
  const limit = Math.min(pw.length, nw.length)
  while (common < limit && wordKey(pw[common]) === wordKey(nw[common])) common++
  return common
}

function wordsOf(text: string): string[] {
  return norm(text).split(' ').filter(Boolean)
}

/**
 * Join text already heard with the engine's latest hypothesis.
 * Chrome's result list is not a stable prefix: interims are rewritten, and
 * after a final (or an onend restart) the list often contains only the newest
 * fragment. Replacing the take with that fragment cuts the live line in half.
 */
export function mergeHeard(previous: string, incoming: string): string {
  const prev = norm(previous)
  const next = norm(incoming)
  if (!hasWords(next)) return prev
  if (!hasWords(prev)) return next

  const pl = prev.toLowerCase()
  const nl = next.toLowerCase()
  if (nl === pl) return next.length >= prev.length ? next : prev
  if (nl.startsWith(pl)) return next
  if (pl.startsWith(nl)) {
    // Modest tail revision (filler dropped). A much shorter snapshot is a
    // truncated result list, not a correction — keep what we already heard.
    if (nl.length >= pl.length * 0.7) return next
    return prev
  }
  if (nl.length >= 3 && nl.length <= pl.length * 0.85 && pl.includes(nl)) return prev

  const revised = reviseTail(prev, next)
  if (revised) return revised

  // A restarted session often re-hears the opening of the same take.
  // Don't paste that shorter echo onto the end, and don't let it replace the take.
  const opened = commonPrefixCount(prev, next)
  if (opened >= 3 && next.length <= prev.length) return prev

  const overlapped = wordOverlap(prev, next) ?? charOverlap(prev, next)
  if (overlapped) return overlapped

  return norm(`${prev} ${next}`)
}

/** Same utterance, last word rewritten ("like" → "love", "cab" → "car"). */
function reviseTail(prev: string, next: string): string | null {
  const pw = wordsOf(prev)
  const nw = wordsOf(next)
  if (pw.length < 2 || nw.length < 2) return null
  let common = 0
  const limit = Math.min(pw.length, nw.length)
  while (common < limit && wordKey(pw[common]) === wordKey(nw[common])) common++
  if (common < 2) return null
  // Only the last word or two of the stored hypothesis changed.
  if (common >= pw.length - 1) {
    if (next.length >= prev.length * 0.7 || nw.length >= pw.length) return next
  }
  if (common >= 3 && common >= limit * 0.6) {
    const shorter = Math.min(prev.length, next.length)
    const longer = Math.max(prev.length, next.length)
    if (shorter >= longer * 0.6) return next.length >= prev.length * 0.7 ? next : prev
  }
  return null
}

function wordOverlap(prev: string, next: string): string | null {
  const pw = wordsOf(prev)
  const nw = wordsOf(next)
  const pk = pw.map(wordKey)
  const nk = nw.map(wordKey)
  const max = Math.min(pk.length, nk.length)
  for (let count = max; count >= 1; count--) {
    let ok = true
    for (let i = 0; i < count; i++) {
      const left = pk[pk.length - count + i]
      const right = nk[i]
      if (!left || left !== right) {
        ok = false
        break
      }
    }
    if (!ok) continue
    const keyLen = nk.slice(0, count).join('').length
    if (count < 2 && keyLen < 2) continue
    const rest = nw.slice(count).join(' ')
    return norm(rest ? `${prev} ${rest}` : prev)
  }
  return null
}

function charOverlap(prev: string, next: string): string | null {
  const pl = prev.toLowerCase()
  const nl = next.toLowerCase()
  const max = Math.min(pl.length, nl.length) - 1
  for (let len = max; len >= 4; len--) {
    if (pl.endsWith(nl.slice(0, len))) return norm(prev + next.slice(len))
  }
  return null
}

function stripLead(text: string): string {
  return text.replace(/^[\s.,!?;:'"“”‘’()[\]（）\-–—，。！？、…·]+/u, '').trim()
}

export interface TakeAccumulator {
  absorb(sessionView: string): string
  forget(): void
  text(): string
}

/** Full take. Later hypotheses are merged in; they never replace earlier words. */
export function createTakeAccumulator(): TakeAccumulator {
  let shown = ''
  let hidden = ''

  const visible = (): string => {
    const full = norm(shown)
    const hide = norm(hidden)
    if (!hide) return full
    if (!full) return ''
    const fl = full.toLowerCase()
    const hl = hide.toLowerCase()
    if (fl === hl || hl.startsWith(fl)) return ''
    if (fl.startsWith(hl)) return stripLead(full.slice(hide.length))
    hidden = ''
    return full
  }

  return {
    absorb(sessionView: string): string {
      const next = norm(sessionView)
      if (hasWords(next)) shown = mergeHeard(shown, next)
      return visible()
    },
    forget() {
      hidden = norm(shown)
    },
    text(): string {
      return visible()
    },
  }
}

/** Join result transcripts of one engine session. */
function phraseText(parts: readonly SpeechPart[]): string {
  let full = ''
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i]?.transcript ?? ''
    if (!chunk) continue
    if (full && !/\s$/.test(full) && !/^\s/.test(chunk)) full += ' '
    full += chunk
  }
  return norm(full)
}

function readResult(list: SpeechRecognitionResultList, index: number): SpeechRecognitionResult | undefined {
  if (index < 0 || index >= list.length) return undefined
  const direct = list[index]
  if (direct && typeof direct.isFinal === 'boolean') return direct
  try {
    return list.item(index)
  } catch {
    return direct
  }
}

function snapshot(event: SpeechRecognitionEvent): SpeechPart[] {
  const parts: SpeechPart[] = []
  const list = event.results
  for (let i = 0; i < list.length; i++) {
    const result = readResult(list, i)
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
 * sessions stay on the same transcript — the result list of a new session is
 * merged, not swapped in over the take.
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

  const heard = createTakeAccumulator()
  let halted = false
  let acceptResults = true
  let lastEmitted = ''
  let restartTimer: number | null = null
  let restartFails = 0

  const clearRestart = () => {
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer)
      restartTimer = null
    }
  }

  const publish = () => {
    if (halted || !shouldRun()) return
    const text = heard.text()
    if (!text || text === lastEmitted) return
    lastEmitted = text
    handlers.onTranscript(text)
  }

  const scheduleRestart = () => {
    if (halted || !shouldRun()) return
    clearRestart()
    // A gap lets Chrome leave the "ended" state. start() inside onend often throws.
    restartTimer = window.setTimeout(() => {
      restartTimer = null
      if (halted || !shouldRun()) return
      try {
        recognition.start()
        restartFails = 0
      } catch {
        restartFails += 1
        if (halted || !shouldRun() || restartFails >= 4) {
          if (!halted && shouldRun()) {
            handlers.onError('음성 인식이 중간에 끊겼습니다. 중지하면 지금까지 들은 말을 번역합니다.')
          }
          return
        }
        scheduleRestart()
      }
    }, 150)
  }

  recognition.onstart = () => {
    if (halted || !shouldRun()) {
      forceAbort(recognition)
      return
    }
    restartFails = 0
    handlers.onStart()
  }

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    // halt() sets halted before abort(), but acceptResults stays true until
    // abort() returns so a synchronous final is kept in transcript().
    if (!acceptResults) return
    const view = phraseText(snapshot(event))
    if (hasWords(view)) heard.absorb(view)
    publish()
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
    if (halted || !shouldRun()) return
    scheduleRestart()
  }

  return {
    start() {
      if (halted) return
      recognition.start()
    },
    halt() {
      halted = true
      clearRestart()
      forceAbort(recognition)
      acceptResults = false
      clearRestart()
    },
    transcript() {
      return heard.text()
    },
    forget() {
      heard.forget()
      lastEmitted = ''
    },
  }
}
