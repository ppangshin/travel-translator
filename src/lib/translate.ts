import { getTranslateCode } from './languages'

export type TranslateResult =
  | { ok: true; text: string; provider: string }
  | { ok: false; error: 'rate_limit' | 'network' | 'empty' | 'api'; message: string }

const cache = new Map<string, string>()
const CACHE_MAX = 200

function cacheKey(text: string, from: string, to: string): string {
  return `${from}|${to}|${text}`
}

function remember(key: string, value: string) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, value)
}

/**
 * Translate text. Free client-side providers by default (MyMemory, then LibreTranslate public).
 * Set VITE_TRANSLATE_API_URL (+ optional VITE_TRANSLATE_API_KEY) for a future paid/custom API.
 * Never sends audio — text only.
 */
export async function translate(
  text: string,
  fromSpeechCode: string,
  toSpeechCode: string,
): Promise<TranslateResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, error: 'empty', message: '번역할 텍스트가 없습니다.' }
  }

  const from = getTranslateCode(fromSpeechCode)
  const to = getTranslateCode(toSpeechCode)

  if (from === to) {
    return { ok: true, text: trimmed, provider: 'passthrough' }
  }

  const key = cacheKey(trimmed, from, to)
  const hit = cache.get(key)
  if (hit) return { ok: true, text: hit, provider: 'cache' }

  const customUrl = import.meta.env.VITE_TRANSLATE_API_URL
  if (customUrl) {
    return translateViaCustomApi(trimmed, from, to, customUrl, key)
  }

  const myMemory = await translateViaMyMemory(trimmed, from, to, key)
  if (myMemory.ok) return myMemory

  // Fallback if MyMemory rate-limits or fails
  if (myMemory.error === 'rate_limit' || myMemory.error === 'network' || myMemory.error === 'api') {
    const libre = await translateViaLibreTranslate(trimmed, from, to, key)
    if (libre.ok) return libre
    // Prefer rate_limit message if that was the primary issue
    if (myMemory.error === 'rate_limit') return myMemory
    return libre
  }

  return myMemory
}

async function translateViaCustomApi(
  text: string,
  from: string,
  to: string,
  url: string,
  key: string,
): Promise<TranslateResult> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const apiKey = import.meta.env.VITE_TRANSLATE_API_KEY
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ q: text, source: from, target: to, format: 'text' }),
    })

    if (res.status === 429) {
      return {
        ok: false,
        error: 'rate_limit',
        message: '번역 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      }
    }
    if (!res.ok) {
      return { ok: false, error: 'api', message: `번역 API 오류 (${res.status})` }
    }

    const data = (await res.json()) as { translatedText?: string; text?: string }
    const out = (data.translatedText ?? data.text ?? '').trim()
    if (!out) return { ok: false, error: 'empty', message: '번역 결과가 비어 있습니다.' }
    remember(key, out)
    return { ok: true, text: out, provider: 'custom' }
  } catch {
    return { ok: false, error: 'network', message: '네트워크 오류로 번역에 실패했습니다.' }
  }
}

async function translateViaMyMemory(
  text: string,
  from: string,
  to: string,
  key: string,
): Promise<TranslateResult> {
  try {
    // MyMemory free tier; keep query short
    const q = text.slice(0, 450)
    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}` +
      `&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`

    const res = await fetch(url)
    if (res.status === 429) {
      return {
        ok: false,
        error: 'rate_limit',
        message: '무료 번역 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
      }
    }
    if (!res.ok) {
      return { ok: false, error: 'api', message: `번역 서비스 오류 (${res.status})` }
    }

    const data = (await res.json()) as {
      responseStatus?: number
      responseData?: { translatedText?: string }
      quotaFinished?: boolean
      exception_code?: string
    }

    if (data.quotaFinished || data.responseStatus === 429) {
      return {
        ok: false,
        error: 'rate_limit',
        message: '무료 번역 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
      }
    }

    const out = data.responseData?.translatedText?.trim() ?? ''
    // MyMemory sometimes echoes "MYMEMORY WARNING: ..."
    if (!out || out.toUpperCase().includes('MYMEMORY WARNING')) {
      return {
        ok: false,
        error: 'rate_limit',
        message: '무료 번역 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
      }
    }

    remember(key, out)
    return { ok: true, text: out, provider: 'mymemory' }
  } catch {
    return { ok: false, error: 'network', message: '네트워크 오류로 번역에 실패했습니다.' }
  }
}

async function translateViaLibreTranslate(
  text: string,
  from: string,
  to: string,
  key: string,
): Promise<TranslateResult> {
  try {
    // Public instance — may be slow or unavailable; used as fallback only
    const res = await fetch('https://libretranslate.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text.slice(0, 1000),
        source: from === 'zh-CN' || from === 'zh-TW' ? 'zh' : from,
        target: to === 'zh-CN' || to === 'zh-TW' ? 'zh' : to,
        format: 'text',
      }),
    })

    if (res.status === 429) {
      return {
        ok: false,
        error: 'rate_limit',
        message: '무료 번역 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
      }
    }
    if (!res.ok) {
      return { ok: false, error: 'api', message: `대체 번역 서비스 오류 (${res.status})` }
    }

    const data = (await res.json()) as { translatedText?: string }
    const out = data.translatedText?.trim() ?? ''
    if (!out) return { ok: false, error: 'empty', message: '번역 결과가 비어 있습니다.' }
    remember(key, out)
    return { ok: true, text: out, provider: 'libretranslate' }
  } catch {
    return { ok: false, error: 'network', message: '네트워크 오류로 번역에 실패했습니다.' }
  }
}

export function clearTranslateCache() {
  cache.clear()
}
