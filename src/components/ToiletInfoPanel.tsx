import { useI18n } from '../i18n'
import type { Toilet } from '../types'
import { TOILET_COLORS, pickToiletText, toiletVariant } from '../toilets'

interface Props {
  toilet: Toilet
  onClose: () => void
}

// Provenance links: the IAM site and the data.gov.mo landing page for the
// 公共廁所 dataset (the 無障礙公廁 set is folded into the `accessible` flag).
const IAM_URL = 'https://www.iam.gov.mo/'
const DATASET_URL = 'https://data.gov.mo/Detail?id=f6a9892d-7e16-49f0-bcd3-573d670cefe5'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-muted) shrink-0 pt-[2px]">
        {label}
      </span>
      <span className="text-[10px] text-(--mm-fg)/80 text-right mm-han min-w-0">{value}</span>
    </div>
  )
}

export function ToiletInfoPanel({ toilet, onClose }: Props) {
  const { lang, t } = useI18n()

  // Header accent = the marker colour this toilet is drawn with, so the panel
  // and the pin the user just clicked read as the same object. Arbitrary hex,
  // hence inline styles rather than Tailwind classes.
  const variant = toiletVariant(toilet)
  const color = TOILET_COLORS[variant]

  // All text comes from the trilingual IAM fields — English readers get the
  // English form (see pickToiletText); the panel never renders raw HTML.
  const title = pickToiletText(toilet.name, lang)
  const address = pickToiletText(toilet.address, lang)
  const openHours = pickToiletText(toilet.openHours, lang)
  const phone = pickToiletText(toilet.phone, lang)

  // Only the flags that actually apply are shown — an absent barrier-free or
  // family cubicle is silence, not a greyed-out chip.
  const chips: string[] = []
  if (toilet.accessible) chips.push(t.toiletAccessible)
  if (toilet.family) chips.push(t.toiletFamily)
  if (toilet.closed) chips.push(t.toiletClosed)

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-fg)/10 rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className="flex items-stretch border-b border-(--mm-fg)/10">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-(--mm-fg)/10"
               style={{ backgroundColor: `${color}14` }}>
            <div className="w-1 h-7 shrink-0" style={{ backgroundColor: color }} />
            <div>
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-secondary)">
                {t.toiletLabel}
              </div>
              <div className="mm-mono text-[13px] font-bold text-(--mm-fg) leading-tight">
                WC
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="text-[14px] font-bold text-(--mm-fg) truncate mm-han" title={title}>
              {title}
            </div>
            {toilet.closed && (
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.2em] text-(--mm-text-muted) truncate">
                {t.toiletClosed}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-3 text-(--mm-text-muted) hover:text-(--mm-fg) hover:bg-(--mm-fg)/5 border-l border-(--mm-fg)/10
                       mm-mono text-[13px] transition-colors"
            aria-label={t.cancel}
          >
            ✕
          </button>
        </div>

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          {toilet.code && <Row label={t.toiletCode} value={toilet.code} />}
          {address && <Row label={t.toiletAddress} value={address} />}
          {openHours && <Row label={t.toiletOpenHours} value={openHours} />}
          {/* The upstream phone field can be blank — hide the row entirely
              rather than showing an empty one. */}
          {phone && <Row label={t.toiletPhone} value={phone} />}
        </div>

        {/* Facility chips — only the ones that apply */}
        {chips.length > 0 && (
          <div className="px-3 pb-2 flex flex-wrap gap-1">
            {chips.map(label => (
              <span
                key={label}
                className="mm-han text-[9px] leading-none px-1.5 py-[3px] border
                           border-(--mm-fg)/20 bg-(--mm-fg)/[0.06] text-(--mm-fg)/80"
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {/* Footer: provenance, plus the IAM photo when the record has one */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between gap-2">
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-(--mm-text-muted) uppercase">
            {t.toiletSource}
          </span>
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-wider text-(--mm-text-muted) truncate">
            {toilet.photo && (
              <>
                <a
                  href={toilet.photo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-(--mm-teal-1) transition-colors"
                >
                  {t.toiletPhoto}
                </a>
                <span className="text-(--mm-fg)/25 mx-[3px]">·</span>
              </>
            )}
            <a
              href={IAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-(--mm-teal-1) transition-colors"
            >
              市政署 (IAM)
            </a>
            {' · '}
            <a
              href={DATASET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-(--mm-teal-1) transition-colors"
            >
              data.gov.mo
            </a>
          </span>
        </div>
      </div>
    </div>
  )
}
