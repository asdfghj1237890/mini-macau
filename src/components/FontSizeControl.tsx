import { useId } from 'react'
import { useI18n } from '../i18n'
import { FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN, FONT_SIZE_STEP, setFontSize, useFontSize } from '../fontSize'
import './fontSizeControl.css'

export function FontSizeControl() {
  const { t } = useI18n()
  const size = useFontSize()
  const id = useId()

  return <section className="mm-font-setting" aria-labelledby={`${id}-label`}>
    <div className="mm-font-setting-heading">
      <label id={`${id}-label`} htmlFor={id}>{t.fontSize}</label>
      <output htmlFor={id} className="mm-mono mm-tabular">{size}%</output>
    </div>
    <div className="mm-font-setting-controls">
      <button type="button" aria-label={t.fontSizeDecrease} disabled={size === FONT_SIZE_MIN}
        onClick={() => setFontSize(size - FONT_SIZE_STEP)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <input id={id} type="range" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step={FONT_SIZE_STEP}
        value={size} aria-valuetext={`${size}%`} onChange={event => setFontSize(Number(event.target.value))} />
      <button type="button" aria-label={t.fontSizeIncrease} disabled={size === FONT_SIZE_MAX}
        onClick={() => setFontSize(size + FONT_SIZE_STEP)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
      </button>
    </div>
    <div className="mm-font-setting-preview mm-han">澳門 <span className="mm-mono">Macau 0123</span></div>
    <div className="mm-font-setting-footer">
      <span>{t.fontSizeHint}</span>
      <button type="button" disabled={size === FONT_SIZE_DEFAULT} onClick={() => setFontSize(FONT_SIZE_DEFAULT)}>{t.fontSizeReset}</button>
    </div>
  </section>
}
