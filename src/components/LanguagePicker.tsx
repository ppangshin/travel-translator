import { LANGUAGES } from '../lib/languages'

interface LanguagePickerProps {
  id: string
  label: string
  value: string
  onChange: (code: string) => void
  disabled?: boolean
}

export function LanguagePicker({ id, label, value, onChange, disabled }: LanguagePickerProps) {
  return (
    <label className="lang-picker" htmlFor={id}>
      <span className="lang-picker-label">{label}</span>
      <select
        id={id}
        className="lang-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.labelKo} ({lang.labelEn})
          </option>
        ))}
      </select>
    </label>
  )
}
