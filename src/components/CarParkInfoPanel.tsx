import { useI18n } from '../i18n'
import type { CarPark, CarParkVacancy } from '../types'
import { CAR_PARK_COLOR, pickCarParkText } from '../carParks'
import { macauHours, macauMinutes } from '../macauTime'

interface Props {
  carPark: CarPark
  // The live row for this park, when one has been fetched. `polling` is the
  // live-only rule from useCarParkVacancy: false means whatever is in `vacancy`
  // is frozen, so the panel refuses to show numbers and says why instead.
  vacancy?: CarParkVacancy | null
  polling?: boolean
  onClose: () => void
}

// Provenance links: DSAT and the data.gov.mo landing page of the static
// car-park dataset (the vacancy dataset is a sibling of it).
const DSAT_URL = 'https://www.dsat.gov.mo/'
const DATASET_URL = 'https://data.gov.mo/Detail?id=ac55c2f1-780a-4dc8-875f-851b2203b706'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-muted) shrink-0 pt-[2px]">
        {label}
      </span>
      <span className="text-[10px] text-(--mm-fg)/80 text-right mm-han min-w-0 whitespace-pre-line">
        {value}
      </span>
    </div>
  )
}

// One price block. The pipeline already turned the upstream `##` separators
// into newlines, so `whitespace-pre-line` is all the formatting needed.
function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[10px] text-(--mm-text-muted) shrink-0 mm-han">{label}</span>
      <span className="text-[10px] text-(--mm-fg)/80 text-right mm-han min-w-0 whitespace-pre-line">
        {value}
      </span>
    </div>
  )
}

function VacancyCell({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-(--mm-text-muted) mm-han truncate">{label}</span>
      <span className="mm-mono mm-tabular text-[11px] text-(--mm-blue-1) shrink-0">{value}</span>
    </div>
  )
}

export function CarParkInfoPanel({ carPark, vacancy, polling = false, onClose }: Props) {
  const { lang, t } = useI18n()

  // DSAT publishes no real English names — `pickCarParkText` falls back
  // en → pt → zh, so an English reader gets the Portuguese form rather than
  // Chinese. The panel never renders raw HTML.
  const name = pickCarParkText(carPark.name, lang)
  const location = pickCarParkText(carPark.location, lang)
  const entrance = pickCarParkText(carPark.entrance, lang)
  const zone = pickCarParkText(carPark.zone, lang)
  const parish = pickCarParkText(carPark.parish, lang)
  const fees = {
    light: pickCarParkText(carPark.fees?.light, lang),
    heavy: pickCarParkText(carPark.fees?.heavy, lang),
    moto: pickCarParkText(carPark.fees?.moto, lang),
    remark: pickCarParkText(carPark.fees?.remark, lang),
  }
  const hasFees = Boolean(fees.light || fees.heavy || fees.moto || fees.remark)

  // Vacancy block, four states:
  //   not polling      → the clock is not at the present, numbers would be a lie
  //   maintenance="1"  → DSAT suspended publication for this park
  //   no row yet       → polling, first response not in
  //   otherwise        → the counts the park actually reports
  const paused = Boolean(vacancy?.maintenance)
  const stamp = vacancy?.timeParsed ?? null
  const updated = stamp
    ? `${String(macauHours(stamp)).padStart(2, '0')}:${String(macauMinutes(stamp)).padStart(2, '0')}`
    : null

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-fg)/10 rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) overflow-hidden mm-fade max-h-[70vh] overflow-y-auto">
        {/* Header signboard — the accent is the marker colour. */}
        <div className="flex items-stretch border-b border-(--mm-fg)/10">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-(--mm-fg)/10"
               style={{ backgroundColor: `${CAR_PARK_COLOR}14` }}>
            <div className="w-1 h-7 shrink-0" style={{ backgroundColor: CAR_PARK_COLOR }} />
            <div>
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-secondary)">
                {t.carParkLabel}
              </div>
              <div className="mm-mono text-[13px] font-bold text-(--mm-fg) leading-tight">P</div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="text-[14px] font-bold text-(--mm-fg) truncate mm-han" title={name}>
              {name}
            </div>
            {(zone || parish) && (
              <div className="text-[10px] text-(--mm-text-muted) truncate mm-han">
                {[zone, parish].filter(Boolean).join(' · ')}
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
          {location && <Row label={t.carParkLocation} value={location} />}
          {entrance && <Row label={t.carParkEntrance} value={entrance} />}
          <Row
            label={t.carParkHeightLimit}
            value={carPark.heightLimitM === null ? '—' : `${carPark.heightLimitM.toFixed(2)} m`}
          />
          {carPark.phone && <Row label={t.carParkPhone} value={carPark.phone} />}
        </div>

        {/* Fees */}
        {hasFees && (
          <div className="px-3 py-2 border-t border-(--mm-fg)/8 space-y-1">
            <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-muted)">
              {t.carParkFees}
            </div>
            {fees.light && <FeeRow label={t.carParkFeeLight} value={fees.light} />}
            {fees.heavy && <FeeRow label={t.carParkFeeHeavy} value={fees.heavy} />}
            {fees.moto && <FeeRow label={t.carParkFeeMoto} value={fees.moto} />}
            {fees.remark && (
              <div className="pt-1 text-[9px] leading-[1.35] text-(--mm-text-muted) mm-han whitespace-pre-line">
                {fees.remark}
              </div>
            )}
          </div>
        )}

        {/* Live vacancy */}
        <div className="px-3 py-2 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-muted)">
              {t.carParkVacancy}
            </span>
            {polling && !paused && updated && (
              <span className="mm-mono text-[8px] tracking-wider text-(--mm-text-muted)">
                {t.carParkVacancyUpdated} {updated}
              </span>
            )}
          </div>
          {!polling ? (
            <div className="pt-1 text-[10px] text-(--mm-text-muted) mm-han">
              {t.carParkVacancyOnlyAtRealtime}
            </div>
          ) : paused ? (
            <div className="pt-1 text-[10px] text-(--mm-amber-1)/70 mm-han">
              {t.carParkVacancyPaused}
            </div>
          ) : !vacancy ? (
            <div className="pt-1 mm-mono text-[11px] text-(--mm-text-muted)">…</div>
          ) : (
            <div className="pt-1 space-y-0.5">
              <VacancyCell label={t.carParkVacancyCar} value={vacancy.car} />
              <VacancyCell label={t.carParkVacancyMoto} value={vacancy.moto} />
              <VacancyCell label={t.carParkVacancyECar} value={vacancy.eCar} />
              <VacancyCell label={t.carParkVacancyEMoto} value={vacancy.eMoto} />
              <VacancyCell label={t.carParkVacancyDisabled} value={vacancy.disabled} />
            </div>
          )}
        </div>

        {/* Footer: provenance */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between gap-2">
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-(--mm-text-muted) uppercase">
            {t.carParkSource}
          </span>
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-wider text-(--mm-text-muted) truncate">
            <a
              href={DSAT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-(--mm-blue-1) transition-colors"
            >
              交通事務局 (DSAT)
            </a>
            {' · '}
            <a
              href={DATASET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-(--mm-blue-1) transition-colors"
            >
              data.gov.mo
            </a>
          </span>
        </div>
      </div>
    </div>
  )
}
