export type LanguageCode = string

export interface Language {
  /** BCP-47 for SpeechRecognition */
  code: LanguageCode
  /** ISO 639-1 for translation APIs */
  translateCode: string
  /** Korean label for UI */
  labelKo: string
  /** English label */
  labelEn: string
}

/** Common travel languages — easy to extend later */
export const LANGUAGES: Language[] = [
  { code: 'en-US', translateCode: 'en', labelKo: '영어', labelEn: 'English' },
  { code: 'ko-KR', translateCode: 'ko', labelKo: '한국어', labelEn: 'Korean' },
  { code: 'ja-JP', translateCode: 'ja', labelKo: '일본어', labelEn: 'Japanese' },
  { code: 'zh-CN', translateCode: 'zh-CN', labelKo: '중국어(간체)', labelEn: 'Chinese (Simplified)' },
  { code: 'zh-TW', translateCode: 'zh-TW', labelKo: '중국어(번체)', labelEn: 'Chinese (Traditional)' },
  { code: 'es-ES', translateCode: 'es', labelKo: '스페인어', labelEn: 'Spanish' },
  { code: 'fr-FR', translateCode: 'fr', labelKo: '프랑스어', labelEn: 'French' },
  { code: 'de-DE', translateCode: 'de', labelKo: '독일어', labelEn: 'German' },
  { code: 'vi-VN', translateCode: 'vi', labelKo: '베트남어', labelEn: 'Vietnamese' },
  { code: 'th-TH', translateCode: 'th', labelKo: '태국어', labelEn: 'Thai' },
  { code: 'id-ID', translateCode: 'id', labelKo: '인도네시아어', labelEn: 'Indonesian' },
  { code: 'pt-BR', translateCode: 'pt', labelKo: '포르투갈어', labelEn: 'Portuguese' },
  { code: 'ru-RU', translateCode: 'ru', labelKo: '러시아어', labelEn: 'Russian' },
  { code: 'ar-SA', translateCode: 'ar', labelKo: '아랍어', labelEn: 'Arabic' },
  { code: 'hi-IN', translateCode: 'hi', labelKo: '힌디어', labelEn: 'Hindi' },
  { code: 'it-IT', translateCode: 'it', labelKo: '이탈리아어', labelEn: 'Italian' },
]

export const DEFAULT_LISTEN = 'en-US'
export const DEFAULT_TARGET = 'ko-KR'

export function getLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code)
}

export function getTranslateCode(speechCode: string): string {
  return getLanguage(speechCode)?.translateCode ?? speechCode.split('-')[0]
}
