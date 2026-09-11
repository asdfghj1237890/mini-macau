import cityCatalog from 'virtual:city-catalog'
import { cityLayerStatus, type CityLayer, type CityDataStatus } from '../cityData'
import { useState, useMemo, useEffect, type ReactNode } from 'react'
import type { TransitData, SimulationClock, SchoolLevel, PublicHousingType } from '../types'
import { useI18n, localName, type Translations } from '../i18n'
import { getRouteGroup, GROUP_ORDER, GROUP_LABEL_KEYS, type GroupKey } from '../routeGroups'
import {
  SCHOOL_ERAS,
  SCHOOL_LEVEL_COLOR,
  SCHOOL_LEVEL_ORDER,
  countSchoolsByLevel,
  schoolLevelLabel,
  schoolRamp,
  type SchoolLevelSet,
} from '../schools'
import {
  PUBLIC_HOUSING_DECADES,
  PUBLIC_HOUSING_TYPE_COLOR,
  PUBLIC_HOUSING_TYPE_ORDER,
  countPublicHousingByType,
  publicHousingRamp,
  publicHousingTypeLabel,
  type PublicHousingTypeSet,
} from '../publicHousing'
import { waterLegendRows, type WaterLegendRow } from '../water'
import { powerLegendRows, type PowerLegendRow } from '../power'
import { grandPrixLegendRows, type GrandPrixLegendRow } from '../grandPrix'
import { useTheme } from '../theme'
import { BusIcon, CloseIcon, LrtIcon } from './TransitIcons'
import { CityLayerList, type LayerDetail } from './CityLayerList'
import { MobileLayerSheet, MobileCityIndex, MobileCityDetail, type MobileLayerCategory, type MobileLayerTab } from './MobileLayerSheet'
import { MobileLayerIcon } from './MobileLayerIcon'
import { MobileServiceTickets } from './MobileServiceTickets'
import { MobileBusRegister } from './MobileBusRegister'
import { MobileLrtConsole } from './MobileLrtConsole'
import {
  WASTE_LAYER_TYPES,
  countWasteByType,
  visibleWasteCount,
  wasteIncinerator,
  wasteLegendRows,
  type WasteLayerType,
  type WasteTypeSet,
} from '../waste'

// A level's five era stops as one gradient strip, oldest (darkest) on the
// left. This is the shade key: each level row below the SCHOOLS row wears its
// own family, so a reader can match a block on the map to both its teaching
// stage AND the era it was founded from the legend alone. Same shape as the
// housing ramp below, because it answers the same question.
function schoolRampGradient(level: SchoolLevel): string {
  const stops = schoolRamp(level)
  const step = 100 / stops.length
  return `linear-gradient(90deg, ${
    stops.map((color, i) => `${color} ${i * step}% ${(i + 1) * step}%`).join(', ')
  })`
}

// Static English caption naming the two ends of that ramp, in the same mono
// decoration slot as the housing decades (digits, so it reads the same in all
// three UI languages). SCHOOL_ERAS[0] is the "before 1900" bucket, so the low
// end is written as a bound rather than as a decade.
const SCHOOL_ERA_CAPTION =
  `<${SCHOOL_ERAS[1]} → ${SCHOOL_ERAS[SCHOOL_ERAS.length - 1]}s`

// A housing type's five decade stops as one gradient strip, oldest (darkest)
// on the left. This is the shade key: each type row below the HOUSING row
// wears its own family, so a reader can match a block on the map to both
// its type AND its decade from the legend alone.
function publicHousingRampGradient(type: PublicHousingType): string {
  const stops = publicHousingRamp(type)
  const step = 100 / stops.length
  return `linear-gradient(90deg, ${
    stops.map((color, i) => `${color} ${i * step}% ${(i + 1) * step}%`).join(', ')
  })`
}

// Hover text for a type row. The label truncates for the longest EN/PT wording
// ("Habitação económica"), so the full name is always worth repeating; the
// `other` row adds the programmes it stands for on a second line, because
// "Other public housing" names none of them.
function publicHousingTypeTitle(t: Translations, type: PublicHousingType): string {
  const label = publicHousingTypeLabel(t, type)
  return type === 'other' ? `${label}\n${t.publicHousingOtherHint}` : label
}

// Static English caption naming the two ends of that ramp, in the same mono
// decoration slot as the school eras (the range is digits, so it reads
// the same in all three UI languages).
const PUBLIC_HOUSING_DECADE_CAPTION =
  `${PUBLIC_HOUSING_DECADES[0]}s → ${PUBLIC_HOUSING_DECADES[PUBLIC_HOUSING_DECADES.length - 1]}s`

// 12px chequered flag for the GRAND PRIX row, stroked like its siblings.
function GrandPrixIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 14.5V2.5" />
      <path d="M3.5 3h9l-1.5 3 1.5 3h-9" />
      <path d="M6.5 3v6M9.5 3v6" strokeWidth="1.1" opacity="0.65" />
    </svg>
  )
}

// ---- WATER legend key -----------------------------------------------------
// A Cities-Skylines style 圖例: every mark the water overlay puts on the map,
// named. Static and non-interactive — nothing here toggles anything, so it is
// plain <div>s, not buttons, and it sits in its own block so the five-column
// grid of the rows above and below is untouched.

// 12px droplet, filled for a mapped facility and outline-only for the hollow
// "approximate" plate — the same distinction the markers themselves draw.
function KeyDroplet({ color, hollow }: { color: string; hollow: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16"
         fill={hollow ? 'none' : color} stroke={color}
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.75c2.6 3 4.25 5.05 4.25 7.1a4.25 4.25 0 0 1-8.5 0c0-2.05 1.65-4.1 4.25-7.1z" />
    </svg>
  )
}

// 12px disc with an inward arrow — the inlet marker at legend scale.
function KeyInlet({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill={color} />
      <path d="M3.5 8h5M11.5 8l-3.6-2.4v4.8z" fill="#ffffff" stroke="#ffffff"
            strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// The swatch for one key row. A 12px box either way, so every label starts at
// the same x whether its glyph is a square, a droplet or a line sample.
function KeyGlyph({ row }: { row: WaterLegendRow }) {
  const box = 'inline-flex items-center justify-center w-[12px] h-[12px] shrink-0'
  if (row.glyph === 'droplet' || row.glyph === 'dropletHollow') {
    return (
      <span className={box} style={{ color: row.color }}>
        <KeyDroplet color={row.color} hollow={row.glyph === 'dropletHollow'} />
      </span>
    )
  }
  if (row.glyph === 'inlet') {
    return <span className={box}><KeyInlet color={row.color} /></span>
  }
  if (row.glyph === 'pulse') {
    // The wave: a short bright bar with the same soft glow it has on the map.
    return (
      <span className="inline-flex items-center w-[16px] h-[12px] shrink-0">
        <span
          className="inline-block w-[16px] h-[3px] rounded-full"
          style={{ backgroundColor: row.color, boxShadow: `0 0 4px ${row.color}` }}
        />
      </span>
    )
  }
  if (row.glyph === 'line') {
    // 16×2 px sample; the dashed variant repeats the same 4/3 rhythm as the
    // map's dasharray so the two read as the same style. `thin` is the
    // distribution network, drawn 1 px and faded exactly as it is on the map,
    // so it cannot be mistaken for the treated-water main above it.
    return (
      <span className="inline-flex items-center w-[16px] h-[12px] shrink-0">
        <span
          className={`inline-block w-[16px] ${row.thin ? 'h-[1px] opacity-70' : 'h-[2px]'}`}
          style={row.dashed
            ? { backgroundImage: `repeating-linear-gradient(to right, ${row.color} 0 4px, transparent 4px 7px)` }
            : { backgroundColor: row.color }}
        />
      </span>
    )
  }
  // `squareFill` is the reservoir surface: the same translucent fill and thin
  // rim the map draws it with, rather than a solid block.
  return (
    <span className={box}>
      <span
        className="inline-block w-[8px] h-[8px]"
        style={row.glyph === 'squareFill'
          ? { backgroundColor: `${row.color}59`, boxShadow: `inset 0 0 0 1px ${row.color}` }
          : { backgroundColor: row.color }}
      />
    </span>
  )
}

// The step number of a chain row: a 12px dark disc with a white rim, the same
// mark the map draws at the corner of that facility's plate.
function StageBadge({ n, label }: { n: number; label: string }) {
  return (
    <span
      className="relative z-10 inline-flex items-center justify-center w-[12px] h-[12px] shrink-0
                 rounded-full bg-(--mm-panel) border border-(--mm-fg)/70 mm-mono text-ui-7 leading-none text-(--mm-fg)"
      title={label}
      aria-label={label}
    >
      {n}
    </span>
  )
}

// A key in two parts, shared by WATER and POWER. First the CHAIN: one numbered
// row per stage in the order the supply travels — and the order the wave on
// the map lights them — joined by a vertical rule so it reads as a sequence,
// not a list. Consecutive rows that share a step (POWER's three sources) show
// the badge once, on the first of them, so a step reads as one number even
// when it is several kinds. Then the style rows (pipe or voltage samples, the
// wave, the hollow plate), which explain a mark without being a step; they
// keep an empty badge column so every glyph and label sits on the same x as
// the chain above. `glyph` draws the overlay's own swatch for a row.
interface ChainRow {
  id: string
  label: string
  stage: number
}

function KeyChain<R extends ChainRow>({ rows, glyph, caption, stageLabel }: {
  rows: R[]
  glyph: (row: R) => ReactNode
  caption: string
  stageLabel: (n: number) => string
}) {
  const chain = rows.filter(row => row.stage > 0)
  const styles = rows.filter(row => row.stage === 0)
  const label = (row: R) => (
    <span className="mm-key-label text-ui-10 leading-[1.2] flex-1 min-w-0 text-left truncate text-(--mm-text-secondary)"
          title={row.label}>
      {row.label}
    </span>
  )
  return (
    <div className="pb-1.5">
      <div className="relative">
        {/* The rule runs badge-centre to badge-centre: pl-8 (32px) + half a
            12px badge, and inset by half a row's height at both ends. */}
        {chain.length > 1 && (
          <span aria-hidden="true"
                className="absolute left-[37.5px] top-[9px] bottom-[9px] w-px bg-(--mm-fg)/20" />
        )}
        {chain.map((row, i) => (
          <div key={row.id} className="w-full flex items-center gap-2 py-[2px] pl-8 pr-3">
            {i === 0 || chain[i - 1].stage !== row.stage
              ? <StageBadge n={row.stage} label={stageLabel(row.stage)} />
              : <span aria-hidden="true" className="inline-block w-[12px] shrink-0" />}
            {glyph(row)}
            {label(row)}
          </div>
        ))}
      </div>
      {styles.map(row => (
        <div key={row.id} className="w-full flex items-center gap-2 py-[2px] pl-8 pr-3">
          <span aria-hidden="true" className="inline-block w-[12px] shrink-0" />
          {glyph(row)}
          {label(row)}
        </div>
      ))}
      <div className="mm-key-caption pl-8 pr-3 pt-[2px] mm-mono text-ui-7 tracking-[0.18em] text-(--mm-text-subtle) uppercase">
        {caption}
      </div>
    </div>
  )
}

// The WATER key. `network` decides which rows appear (see waterLegendRows).
function WaterKey({ network, caption }: { network: TransitData['waterNetwork']; caption: string }) {
  const { t } = useI18n()
  const dark = useTheme() === 'dark'
  return (
    <KeyChain
      rows={waterLegendRows(t, network, dark)}
      glyph={row => <KeyGlyph row={row} />}
      caption={caption}
      stageLabel={t.waterStage}
    />
  )
}

// ---- POWER legend key -----------------------------------------------------
// The electricity overlay's own 圖例, built the same way as the water one from
// `powerLegendRows` — so the voltage rows only appear for voltages the file
// actually carries, and the inlet row only when the network has import nodes.

// 12px bolt, filled for a mapped station and outline-only for the hollow
// "approximate" plate — the same distinction the markers themselves draw.
function KeyBolt({ color, hollow }: { color: string; hollow: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16"
         fill={hollow ? 'none' : color} stroke={color}
         strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.3 1.6L4.9 8.4h2.6l-1 6 4.6-7h-2.6z" />
    </svg>
  )
}

// The swatch for one POWER key row. Same 12px box as the water glyphs, so both
// keys line their labels up at the same x.
function PowerKeyGlyph({ row }: { row: PowerLegendRow }) {
  const box = 'inline-flex items-center justify-center w-[12px] h-[12px] shrink-0'
  if (row.glyph === 'bolt' || row.glyph === 'boltHollow') {
    return (
      <span className={box} style={{ color: row.color }}>
        <KeyBolt color={row.color} hollow={row.glyph === 'boltHollow'} />
      </span>
    )
  }
  if (row.glyph === 'inlet') {
    return <span className={box}><KeyInlet color={row.color} /></span>
  }
  if (row.glyph === 'pulse') {
    // The wave: a short bright bar with the same soft glow it has on the map.
    return (
      <span className="inline-flex items-center w-[16px] h-[12px] shrink-0">
        <span
          className="inline-block w-[16px] h-[3px] rounded-full"
          style={{ backgroundColor: row.color, boxShadow: `0 0 4px ${row.color}` }}
        />
      </span>
    )
  }
  if (row.glyph === 'line') {
    // 16×2 px sample, or 1 px and faded for the distribution mesh — drawn
    // exactly as the map draws it, so it cannot be mistaken for the 66 kV row
    // above it. No dashed variant: nothing in this overlay is dashed.
    return (
      <span className="inline-flex items-center w-[16px] h-[12px] shrink-0">
        <span
          className={`inline-block w-[16px] ${row.thin ? 'h-[1px] opacity-70' : 'h-[2px]'}`}
          style={{ backgroundColor: row.color }}
        />
      </span>
    )
  }
  return (
    <span className={box}>
      <span className="inline-block w-[8px] h-[8px]" style={{ backgroundColor: row.color }} />
    </span>
  )
}

// The POWER key, the same chain-then-styles block as the water one. `network`
// decides which voltage rows appear (see powerLegendRows).
function PowerKey({ network, caption }: { network: TransitData['powerNetwork']; caption: string }) {
  const { t } = useI18n()
  const dark = useTheme() === 'dark'
  return (
    <KeyChain
      rows={powerLegendRows(t, network, dark)}
      glyph={row => <PowerKeyGlyph row={row} />}
      caption={caption}
      stageLabel={t.powerStage}
    />
  )
}

// The swatch for one GRAND PRIX key row. Same 12px box as the other keys.
function GrandPrixKeyGlyph({ row }: { row: GrandPrixLegendRow }) {
  const box = 'inline-flex items-center justify-center w-[12px] h-[12px] shrink-0'
  if (row.glyph === 'flag') {
    return <span className={box} style={{ color: row.color }}><GrandPrixIcon /></span>
  }
  if (row.glyph === 'corner') {
    return (
      <span className={box}>
        <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ backgroundColor: row.color }} />
      </span>
    )
  }
  if (row.glyph === 'wake') {
    // The wake: bright at the car's end, fading behind it.
    return (
      <span className="inline-flex items-center w-[16px] h-[12px] shrink-0">
        <span
          className="inline-block w-[16px] h-[3px] rounded-full"
          style={{
            backgroundImage: `linear-gradient(90deg, transparent, ${row.color})`,
            boxShadow: `0 0 4px ${row.color}`,
          }}
        />
      </span>
    )
  }
  if (row.glyph === 'track') {
    return (
      <span className="inline-flex items-center w-[16px] h-[12px] shrink-0">
        <span className="inline-block w-[16px] h-[3px] rounded-full" style={{ backgroundColor: row.color }} />
      </span>
    )
  }
  if (row.glyph === 'pit') {
    // Dashed, as the pit lane is drawn.
    return (
      <span className="inline-flex items-center w-[16px] h-[12px] shrink-0">
        <span className="inline-block w-[16px] h-0" style={{ borderTop: `2px dashed ${row.color}` }} />
      </span>
    )
  }
  // The car: a tiny top-down single-seater in the body colour.
  return (
    <span className="inline-flex items-center w-[16px] h-[12px] shrink-0" style={{ color: row.color }}>
      <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
        <rect x="0.5" y="2" width="2.5" height="6" rx="0.6" fill="currentColor" />
        <rect x="3" y="4" width="10" height="2" fill="currentColor" />
        <rect x="6" y="1.5" width="3" height="7" rx="0.6" fill="currentColor" opacity="0.75" />
        <rect x="12.5" y="2.8" width="3" height="4.4" rx="0.6" fill="currentColor" />
      </svg>
    </span>
  )
}

// The GRAND PRIX key: the corners as the chain (numbered as the map numbers
// them, in race order), then the line, the pit lane, the pulse and the car.
function GrandPrixKey({ circuit, caption }: { circuit: TransitData['grandPrix']; caption: string }) {
  const { t, lang } = useI18n()
  const dark = useTheme() === 'dark'
  return (
    <KeyChain
      rows={grandPrixLegendRows(t, lang, circuit, dark)}
      glyph={row => <GrandPrixKeyGlyph row={row} />}
      caption={caption}
      stageLabel={t.grandPrixCornerOrder}
    />
  )
}

// 16px glyphs for the mobile CITY chip and modal rows — the chip-sized
// versions of the desktop row icons, so the list reads like the CITY page.
const WORKS_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)
const MORTARBOARD_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 10 12 5 2 10l10 5 10-5z" />
    <path d="M6 12.5V17c3.3 2.7 8.7 2.7 12 0v-4.5" />
    <line x1="22" y1="10" x2="22" y2="15" />
  </svg>
)
const APARTMENT_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 21V4h9v17" />
    <path d="M13 21V10h6v11" />
    <path d="M2.5 21h19" />
    <path d="M7 8h2M7 12.5h2M16 14.5h1" />
  </svg>
)
const TOILET_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="4.75" cy="3.25" r="1.5" fill="currentColor" stroke="none" />
    <rect x="3" y="5.25" width="3.5" height="5" rx="1.25" fill="currentColor" stroke="none" />
    <path d="M3.75 10.25v3.25M5.75 10.25v3.25" strokeWidth="1.25" />
    <circle cx="11.25" cy="3.25" r="1.5" fill="currentColor" stroke="none" />
    <path d="M11.25 5.25l2.75 5.25h-5.5z" fill="currentColor" strokeWidth="1" />
    <path d="M10.35 10.5v3M12.15 10.5v3" strokeWidth="1.25" />
    <path d="M8 2.25v11.5" strokeWidth="1" opacity="0.5" />
  </svg>
)
const CAR_PARK_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" />
    <path d="M6.25 11.75V4.75h2.1a2.1 2.1 0 0 1 0 4.2h-2.1" />
  </svg>
)
const REGION_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1" strokeDasharray="2.6 2" />
    <path d="M8 2.25v5.1M8 7.35l4.6 2.4M8 7.35l-4.6 2.4" />
  </svg>
)
const WASTE_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.75 4.5h10.5" />
    <path d="M6.5 4.5V3h3v1.5" />
    <path d="M4 4.5l.85 8.4a.8.8 0 0 0 .8.6h4.7a.8.8 0 0 0 .8-.6l.85-8.4" />
    <path d="M6.6 7.5v3.4M9.4 7.5v3.4" strokeWidth="1.1" opacity="0.65" />
  </svg>
)
const WATER_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 1.75c2.6 3 4.25 5.05 4.25 7.1a4.25 4.25 0 0 1-8.5 0c0-2.05 1.65-4.1 4.25-7.1z" />
  </svg>
)
const POWER_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.3 1.6L4.9 8.4h2.6l-1 6 4.6-7h-2.6z" />
  </svg>
)
const GRAND_PRIX_ICON_16 = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 14.5V2.5" />
    <path d="M3.5 3h9l-1.5 3 1.5 3h-9" />
    <path d="M6.5 3v6M9.5 3v6" strokeWidth="1.1" opacity="0.65" />
  </svg>
)
// Building glyph for the CITY chip (16px) and the modal header (12px).
function CityIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-5h6v5" />
      <path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
    </svg>
  )
}

const LS_DESKTOP_OPEN = 'mm-layers-desktop-open'
const LS_DESKTOP_COLLAPSED_GROUPS = 'mm-layers-collapsed-groups'
const LS_SCHOOLS_LEGEND_OPEN = 'mm-schools-legend-open'
const LS_PUBLIC_HOUSING_LEGEND_OPEN = 'mm-public-housing-legend-open'
const LS_WASTE_LEGEND_OPEN = 'mm-waste-legend-open'
// Stable "nothing hidden" fallback for a legend rendered without the prop, so
// the `??` below cannot hand a fresh Set to the render on every pass.
const EMPTY_WASTE_TYPES: WasteTypeSet = new Set<WasteLayerType>()
// Which page of the desktop panel is showing. The simulated transit layers
// (LRT / BUS / AIR / SEA) and the static city overlays (WORKS / SCHOOLS / WC)
// are different kinds of thing, and the city list will keep growing, so each
// gets its own page; the choice persists like the other panel state.
const LS_LAYERS_TAB = 'mm-layers-tab'
const LAYERS_TABS = ['transit', 'city'] as const
type LayersTab = typeof LAYERS_TABS[number]

interface Props {
  cityDataStatus?: CityDataStatus
  onRequestCityLayer?: (layer: CityLayer) => void

  transitData: TransitData
  allTransitData?: TransitData
  visibleRoutes?: Set<string>
  inactiveRoutes?: Set<string>
  isAutoMode?: boolean
  lrtOn?: Set<string>
  flightsOn?: boolean
  ferriesOn?: boolean
  roadWorksOn?: boolean
  // Notices in force on the SIMULATED calendar day (computed in App so the
  // legend and the map markers always agree). Not derivable from
  // transitData.roadWorks alone, which is the whole dataset.
  activeRoadWorksCount?: number
  schoolsOn?: boolean
  // Which teaching stages are drawn, and how many schools each stage has
  // (counted from the UNFILTERED data, so a row keeps its total while off).
  schoolLevelsOn?: SchoolLevelSet
  schoolLevelCounts?: Record<SchoolLevel, number>
  // The Housing Bureau's estates. Opt-in like the schools it mirrors, and with
  // the same sub-filters: which of the two types are drawn, and how many
  // estates each type has (counted from the UNFILTERED data, so a row keeps
  // its total while off).
  publicHousingOn?: boolean
  publicHousingTypesOn?: PublicHousingTypeSet
  publicHousingTypeCounts?: Record<PublicHousingType, number>
  // The parish tint. Opt-in like the rows below it, but the one CITY layer
  // that is CONTEXT rather than data — it is NOT a focus mode, and it has no
  // per-area toggles, so a single switch is the whole control.
  parishesOn?: boolean
  // Public toilets. Like schools this layer is opt-in, so it defaults to off
  // here too — the count shown is the whole register, which never changes.
  toiletsOn?: boolean
  // Public car parks — opt-in like the toilets; the count is the whole
  // register, which only changes when the daily workflow lands a new file.
  carParksOn?: boolean
  // Waste and recycling points — opt-in like the toilets, and the one CITY row
  // with sub-filters: `wasteHiddenTypes` is the set of the six site types that
  // are switched OFF, and `wasteTypeCounts` their totals from the UNFILTERED
  // data (so a key row keeps its number while its type is hidden).
  wasteOn?: boolean
  wasteHiddenTypes?: WasteTypeSet
  wasteTypeCounts?: Record<WasteLayerType, number>
  // Macao Water supply facilities. Also opt-in, but unlike its neighbours this
  // one is a FOCUS mode: App clears every other layer while it is on and puts
  // them back when it goes off (see toggleWater), so the row's ON state also
  // means "everything else is off".
  waterOn?: boolean
  // CEM's electricity network — the SECOND focus mode, and mutually exclusive
  // with WATER: turning this on takes water off (and vice versa), so at most
  // one of the two rows can read ON.
  powerOn?: boolean
  // The Guia Circuit — the FOURTH focus mode, exclusive with the three above.
  grandPrixOn?: boolean
  clock?: SimulationClock
  onToggleLrt?: (id: string) => void
  onToggleFlights?: () => void
  onToggleFerries?: () => void
  onToggleRoadWorks?: () => void
  onToggleSchools?: () => void
  onToggleSchoolLevel?: (level: SchoolLevel) => void
  onTogglePublicHousing?: () => void
  onTogglePublicHousingType?: (type: PublicHousingType) => void
  onToggleParishes?: () => void
  onToggleToilets?: () => void
  onToggleCarParks?: () => void
  onToggleWaste?: () => void
  onToggleWasteType?: (type: WasteLayerType) => void
  onToggleWater?: () => void
  onTogglePower?: () => void
  onToggleGrandPrix?: () => void
  onToggleRoute?: (routeId: string) => void
  onToggleAll?: () => void
  onShowAll?: () => void
  onHideAll?: () => void
  onToggleGroup?: (groupKey: GroupKey) => void
  onResetAuto?: () => void
}

type MobilePanel = MobileLayerCategory | 'parishes' | 'works' | 'schools' | 'housing' | 'toilets' | 'carparks' | 'waste' | 'water' | 'power' | 'grandprix' | null

export function LineLegend({
  cityDataStatus,
  onRequestCityLayer,
  transitData,
  allTransitData,
  visibleRoutes,
  inactiveRoutes,
  isAutoMode,
  lrtOn,
  flightsOn = true,
  ferriesOn = true,
  roadWorksOn = true,
  activeRoadWorksCount = 0,
  schoolsOn = true,
  schoolLevelsOn,
  schoolLevelCounts,
  publicHousingOn = false,
  publicHousingTypesOn,
  publicHousingTypeCounts,
  parishesOn = false,
  toiletsOn = false,
  carParksOn = false,
  wasteOn = false,
  wasteHiddenTypes,
  wasteTypeCounts,
  waterOn = false,
  powerOn = false,
  grandPrixOn = false,
  clock,
  onToggleLrt,
  onToggleFlights,
  onToggleFerries,
  onToggleRoadWorks,
  onToggleSchools,
  onToggleSchoolLevel,
  onTogglePublicHousing,
  onTogglePublicHousingType,
  onToggleParishes,
  onToggleToilets,
  onToggleCarParks,
  onToggleWaste,
  onToggleWasteType,
  onToggleWater,
  onTogglePower,
  onToggleGrandPrix,
  onToggleRoute,
  onShowAll,
  onHideAll,
  onToggleGroup,
  onResetAuto,
}: Props) {
  const { lang, t } = useI18n()
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null)
  const [mobileBusGroup, setMobileBusGroup] = useState<GroupKey>('peninsula')
  const [desktopOpen, setDesktopOpen] = useState(() => {
    try { return localStorage.getItem(LS_DESKTOP_OPEN) !== '0' } catch { return true }
  })
  const [schoolsLegendOpen, setSchoolsLegendOpen] = useState(() => {
    try { return localStorage.getItem(LS_SCHOOLS_LEGEND_OPEN) !== '0' } catch { return true }
  })
  const [publicHousingLegendOpen, setPublicHousingLegendOpen] = useState(() => {
    try { return localStorage.getItem(LS_PUBLIC_HOUSING_LEGEND_OPEN) !== '0' } catch { return true }
  })
  const [wasteLegendOpen, setWasteLegendOpen] = useState(() => {
    try { return localStorage.getItem(LS_WASTE_LEGEND_OPEN) !== '0' } catch { return true }
  })
  const [layersTab, setLayersTab] = useState<LayersTab>(() => {
    try { return localStorage.getItem(LS_LAYERS_TAB) === 'city' ? 'city' : 'transit' } catch { return 'transit' }
  })
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LS_DESKTOP_COLLAPSED_GROUPS)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) return new Set(arr)
      }
    } catch { /* ignore */ }
    return new Set(GROUP_ORDER)
  })

  useEffect(() => { localStorage.setItem(LS_DESKTOP_OPEN, desktopOpen ? '1' : '0') }, [desktopOpen])
  useEffect(() => { localStorage.setItem(LS_LAYERS_TAB, layersTab) }, [layersTab])
  useEffect(() => {
    localStorage.setItem(LS_SCHOOLS_LEGEND_OPEN, schoolsLegendOpen ? '1' : '0')
  }, [schoolsLegendOpen])
  useEffect(() => {
    localStorage.setItem(LS_PUBLIC_HOUSING_LEGEND_OPEN, publicHousingLegendOpen ? '1' : '0')
  }, [publicHousingLegendOpen])
  useEffect(() => {
    localStorage.setItem(LS_WASTE_LEGEND_OPEN, wasteLegendOpen ? '1' : '0')
  }, [wasteLegendOpen])
  useEffect(() => {
    localStorage.setItem(LS_DESKTOP_COLLAPSED_GROUPS, JSON.stringify([...collapsedGroups]))
  }, [collapsedGroups])

  const toggleGroupCollapse = (g: string) => setCollapsedGroups(prev => {
    const next = new Set(prev)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    return next
  })

  // Memoize so the `?? []` fallback doesn't hand `grouped` a fresh array
  // every render (which would make its useMemo recompute each time).
  const busRoutes = useMemo(() => allTransitData?.busRoutes ?? [], [allTransitData])
  const allLrtLines = allTransitData?.lrtLines ?? transitData.lrtLines
  // Per-level totals. App passes them pre-counted; the fallback keeps the
  // legend correct if it's ever rendered without them.
  const allSchools = useMemo(
    () => allTransitData?.schools ?? transitData.schools,
    [allTransitData, transitData.schools]
  )
  const levelCounts = useMemo(
    () => schoolLevelCounts ?? countSchoolsByLevel(allSchools),
    [schoolLevelCounts, allSchools]
  )
  // Same contract for the housing types: App passes them pre-counted from the
  // UNFILTERED list, and the fallback keeps the two rows correct if the legend
  // is ever rendered without them.
  const allPublicHousing = useMemo(
    () => allTransitData?.publicHousing ?? transitData.publicHousing,
    [allTransitData, transitData.publicHousing]
  )
  const housingTypeCounts = useMemo(
    () => publicHousingTypeCounts ?? countPublicHousingByType(allPublicHousing),
    [publicHousingTypeCounts, allPublicHousing]
  )
  // Same contract for the waste types: App passes them pre-counted from the
  // UNFILTERED list, and the fallback keeps the key correct if the legend is
  // ever rendered without them.
  const allWaste = useMemo(
    () => allTransitData?.waste ?? transitData.waste,
    [allTransitData, transitData.waste]
  )
  // The incineration plant is the WASTE key's seventh row but lives in the
  // POWER dataset, so the fallback count reads it from there — unfiltered, for
  // the same reason as `allWaste`.
  const allPower = useMemo(
    () => allTransitData?.powerFacilities ?? transitData.powerFacilities,
    [allTransitData, transitData.powerFacilities]
  )
  const wasteCounts = useMemo(
    () => wasteTypeCounts ?? countWasteByType(allWaste, {
      incinerator: wasteIncinerator(allPower),
      ecoStations: allTransitData?.wasteEcoStations ?? transitData.wasteEcoStations,
      facilities: allTransitData?.wasteFacilities ?? transitData.wasteFacilities,
    }),
    [wasteTypeCounts, allWaste, allPower, allTransitData,
      transitData.wasteEcoStations, transitData.wasteFacilities]
  )
  const grouped = useMemo(() => {
    const groups = new Map<typeof GROUP_ORDER[number], typeof busRoutes>()
    for (const g of GROUP_ORDER) groups.set(g, [])
    for (const route of busRoutes) {
      groups.get(getRouteGroup(route))!.push(route)
    }
    return groups
  }, [busRoutes])

  if (transitData.loading) {
    // The loading chip must occupy the *exact* same bounding box the real
    // LAYERS panel will take once data arrives — same position, same width.
    // Previously it was content-sized (~90px) while the full panel is 240px
    // with the same right-3 anchor, so the left edge jumped ~150px inward
    // on load, which Lighthouse attributed as the 0.140 layout shift
    // (amplified further by the mm-ui-scale zoom: 1.2-1.3). Height doesn't
    // need to match — top-anchored absolute elements don't register as CLS
    // when only the bottom edge moves.
    return (
      <div className="mm-ui-scale absolute top-3 right-3 z-20 hidden sm:block landscape:hidden
                      bg-(--mm-panel)/95 backdrop-blur-md rounded-sm
                      px-3 py-2 border border-(--mm-border) text-(--mm-amber)/80
                      mm-mono text-ui-10 tracking-[0.25em] w-[240px] text-center">
        {t.loading}
      </div>
    )
  }

  const togglePanel = (panel: MobilePanel) =>
    setMobilePanel(prev => (prev === panel ? null : panel))

  const activeRoutes = transitData.busRoutes.length
  const totalRoutes = allTransitData?.busRoutes.length ?? activeRoutes
  const lrtActive = lrtOn?.size ?? allLrtLines.length
  const lrtTotal = allLrtLines.length
  const flightCount = transitData.flights.length
  const totalFlightCount = allTransitData?.flights.length ?? flightCount
  const ferryCount = transitData.ferries.length
  const totalFerryCount = allTransitData?.ferries.length ?? ferryCount
  const cityCount = (layer: CityLayer, loaded: number) =>
    cityDataStatus && cityDataStatus[layer] !== 'ready' ? cityCatalog.counts[layer] : loaded
  const totalRoadWorkCount = cityCount('works', allTransitData?.roadWorks.length ?? transitData.roadWorks.length)
  // Schools are static, so `schoolCount` is the full register — the master
  // switch empties `transitData.schools`, it doesn't change how many exist.
  // The per-level toggles narrow it, hence the enabled/total pair.
  const schoolCount = cityCount('schools', allTransitData?.schools.length ?? transitData.schools.length)
  const isSchoolLevelOn = (level: SchoolLevel) =>
    (schoolLevelsOn ? schoolLevelsOn.has(level) : true)
  const schoolLevelsAllOn = SCHOOL_LEVEL_ORDER.every(isSchoolLevelOn)
  const schoolEnabledCount = SCHOOL_LEVEL_ORDER.reduce(
    (sum, level) => (isSchoolLevelOn(level) ? sum + (levelCounts[level] ?? 0) : sum), 0
  )
  // The housing estates are static too, so `publicHousingCount` is the full
  // register and the two type toggles narrow it — the enabled/total pair the
  // SCHOOLS row above uses.
  const publicHousingCount = cityCount('housing', allTransitData?.publicHousing.length ?? transitData.publicHousing.length)
  const isPublicHousingTypeOn = (type: PublicHousingType) =>
    (publicHousingTypesOn ? publicHousingTypesOn.has(type) : true)
  const publicHousingTypesAllOn = PUBLIC_HOUSING_TYPE_ORDER.every(isPublicHousingTypeOn)
  const publicHousingEnabledCount = PUBLIC_HOUSING_TYPE_ORDER.reduce(
    (sum, type) => (isPublicHousingTypeOn(type) ? sum + (housingTypeCounts[type] ?? 0) : sum), 0
  )
  // Toilets are static and unfiltered: the row always shows the full register,
  // and the master switch is the only thing that empties transitData.toilets.
  const toiletCount = cityCount('toilets', allTransitData?.toilets.length ?? transitData.toilets.length)
  // Same for the car parks: the row always shows the full register.
  const carParkCount = cityCount('carparks', allTransitData?.carParks.length ?? transitData.carParks.length)
  // The number of AREAS, from the unfiltered data — eight, and only ever eight
  // until the government redraws a boundary.
  const parishCount = cityCount('parishes', allTransitData?.parishes.length ?? transitData.parishes.length)
  // Waste is the one CITY row whose count MOVES: the master switch is a whole-
  // layer toggle like its neighbours, but the six type toggles narrow what is
  // drawn, so the row shows the visible total (and enabled/total when some type
  // is hidden) rather than the register size.
  const wasteTotal = visibleWasteCount(wasteCounts, EMPTY_WASTE_TYPES)
  const hiddenWasteTypes: WasteTypeSet = wasteHiddenTypes ?? EMPTY_WASTE_TYPES
  const wasteTypesAllOn = WASTE_LAYER_TYPES.every(type => !hiddenWasteTypes.has(type))
  const wasteVisibleCount = visibleWasteCount(wasteCounts, hiddenWasteTypes)
  // And for the water facilities — Macao Water's list is a fixed 22.
  const waterCount = cityCount('water', allTransitData?.waterFacilities.length ?? transitData.waterFacilities.length)
  // The UNFILTERED network, for the same reason as the count above: the key
  // describes what the layer draws when it is on, and `transitData` is nulled
  // out while it is off.
  const waterNetwork = allTransitData?.waterNetwork ?? transitData.waterNetwork
  // And for the electricity facilities — CEM's list is fixed until the manual
  // pipeline run regenerates it.
  const powerCount = cityCount('power', allTransitData?.powerFacilities.length ?? transitData.powerFacilities.length)
  const powerNetwork = allTransitData?.powerNetwork ?? transitData.powerNetwork
  // The circuit, from the UNFILTERED data like the two above (App nulls the
  // filtered copy while the layer is off, and the row must still count).
  const grandPrix = allTransitData?.grandPrix ?? transitData.grandPrix
  const grandPrixCount = cityCount('grandprix', grandPrix?.corners.length ?? 0)

  // Shared city data; desktop uses cards and mobile uses a numbered index.
  // Counts always use unfiltered data, including when a focus layer is active.
  const cityLayerRows = [
    // PARISHES first: it is the ground the other rows are read against, and the
    // only one that is context rather than data.
    parishCount > 0 ? {
      panel: 'parishes' as const, focus: false, label: t.parishes, code: 'PARISHES', accent: 'slate', description: t.parishesTransitNote, icon: REGION_ICON_16, on: parishesOn,
      count: String(parishCount),
      toggle: onToggleParishes,
    } : null,
    totalRoadWorkCount > 0 ? {
      panel: 'works' as const, focus: false, label: t.roadWorks, code: 'ROAD WORKS', accent: 'amber', description: t.roadWorksActive(activeRoadWorksCount), icon: WORKS_ICON_16, on: roadWorksOn,
      count: String(activeRoadWorksCount),
      toggle: onToggleRoadWorks,
    } : null,
    carParkCount > 0 ? {
      panel: 'carparks' as const, focus: false, label: t.carParks, code: 'PARKING', accent: 'blue', description: t.carParksCount(carParkCount), icon: CAR_PARK_ICON_16, on: carParksOn,
      count: String(carParkCount),
      toggle: onToggleCarParks,
    } : null,
    toiletCount > 0 ? {
      panel: 'toilets' as const, focus: false, label: t.toilets, code: 'PUBLIC TOILETS', accent: 'teal', description: t.toiletsCount(toiletCount), icon: TOILET_ICON_16, on: toiletsOn,
      count: String(toiletCount),
      toggle: onToggleToilets,
    } : null,
    schoolCount > 0 ? {
      panel: 'schools' as const, focus: false, label: t.schools, code: 'EDUCATION', accent: 'violet', description: t.schoolsRampHint, icon: MORTARBOARD_ICON_16, on: schoolsOn,
      count: schoolLevelsAllOn ? String(schoolCount) : `${schoolEnabledCount}/${schoolCount}`,
      toggle: onToggleSchools,
    } : null,
    publicHousingCount > 0 ? {
      panel: 'housing' as const, focus: true, label: t.publicHousing, code: 'PUBLIC HOUSING', accent: 'lime', description: t.publicHousingFocusNote, icon: APARTMENT_ICON_16, on: publicHousingOn,
      count: publicHousingTypesAllOn ? String(publicHousingCount) : `${publicHousingEnabledCount}/${publicHousingCount}`,
      toggle: onTogglePublicHousing,
    } : null,
    waterCount > 0 ? {
      panel: 'water' as const, focus: true, label: t.water, code: 'WATER SUPPLY', accent: 'sky', description: t.waterNetworkNote, icon: WATER_ICON_16, on: waterOn,
      count: String(waterCount),
      toggle: onToggleWater,
    } : null,
    powerCount > 0 ? {
      panel: 'power' as const, focus: true, label: t.power, code: 'ELECTRICITY', accent: 'amber', description: t.powerNetworkNote, icon: POWER_ICON_16, on: powerOn,
      count: String(powerCount),
      toggle: onTogglePower,
    } : null,
    wasteTotal > 0 ? {
      panel: 'waste' as const, focus: true, label: t.waste, code: 'WASTE & RECYCLING', accent: 'green', description: t.wasteFocusNote, icon: WASTE_ICON_16, on: wasteOn,
      count: wasteTypesAllOn ? String(wasteTotal) : `${wasteVisibleCount}/${wasteTotal}`,
      toggle: onToggleWaste,
    } : null,
    grandPrixCount > 0 ? {
      panel: 'grandprix' as const, focus: true, label: t.grandPrix, code: 'GRAND PRIX', accent: 'red', description: t.grandPrixNote, icon: GRAND_PRIX_ICON_16, on: grandPrixOn,
      count: String(grandPrixCount),
      toggle: onToggleGrandPrix,
    } : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null).map(row => ({
    ...row,
    loadStatus: cityDataStatus ? cityLayerStatus(cityDataStatus, row.panel) : undefined,
    retry: onRequestCityLayer ? () => onRequestCityLayer(row.panel) : undefined,
  }))
  const cityLayerTotal = cityLayerRows.length
  const cityLayerOn = cityLayerRows.filter(row => row.on).length


  const cityDetails: Record<string, LayerDetail> = {
    schools: { expanded: schoolsLegendOpen, onExpand: () => setSchoolsLegendOpen(v => !v), content: (
      <div className={`pb-1 bg-(--mm-violet-2)/[0.05] ${schoolsOn ? '' : 'opacity-40 light:opacity-100'}`}>
        {SCHOOL_LEVEL_ORDER.map(level => {
          const on = isSchoolLevelOn(level)
          // "Lit" = actually drawn on the map: the level is on AND
          // the master switch is on.
          const lit = schoolsOn && on
          const color = SCHOOL_LEVEL_COLOR[level]
          return (
            <button
              key={level}
              type="button"
              onClick={() => onToggleSchoolLevel?.(level)}
              disabled={!onToggleSchoolLevel}
              aria-pressed={on}
              // The label truncates for the longest EN/PT wording
              // ("K–12 (all-through)"), so keep it readable on hover.
              title={schoolLevelLabel(t, level)}
              className={`mm-layer-filter w-full flex items-center gap-2 py-1 pl-8 pr-3
                          hover:bg-(--mm-fg)/[0.04] transition
                          ${onToggleSchoolLevel ? '' : 'cursor-default'}`}
            >
              {/* The whole five-era ramp while the level is on; a
                  hollow box in its identity colour while it is off.
                  Same grammar and the same 22px strip as the housing
                  rows below, because the colour carries the same two
                  facts: the hue is the teaching stage, the shade the
                  era the school was founded. */}
              <span
                className="inline-block w-[22px] h-[7px] shrink-0"
                style={on
                  ? { backgroundImage: schoolRampGradient(level) }
                  : { boxShadow: `inset 0 0 0 1px ${color}99` }}
              />
              <span className={`mm-layer-filter-label text-ui-10 leading-[1.2] flex-1 min-w-0 text-left truncate
                                ${on ? 'text-(--mm-fg)/75' : 'text-(--mm-text-subtle)'}`}>
                {schoolLevelLabel(t, level)}
              </span>
              <span
                className={`mm-mono mm-tabular text-ui-9 w-[18px] text-right shrink-0
                            ${lit ? '' : 'text-(--mm-fg)/25'}`}
                style={lit ? { color } : undefined}
              >
                {levelCounts[level] ?? 0}
              </span>
              <span className={`mm-layer-state mm-mono text-ui-8 tracking-[0.2em] w-[20px] text-right shrink-0
                                ${lit ? 'text-(--mm-emerald)/80' : 'text-(--mm-text-muted)'}`}>
                {on ? 'ON' : 'OFF'}
              </span>
            </button>
          )
        })}
        {/* What the strips above mean. Without this line the shade
            reads as decoration rather than as the founding era. */}
        <div className="mm-layer-detail-note pl-8 pr-3 pt-[2px] flex items-baseline gap-2
                        mm-mono text-ui-7 tracking-[0.18em] text-(--mm-text-subtle) uppercase">
          <span className="mm-tabular shrink-0">{SCHOOL_ERA_CAPTION}</span>
          <span className="flex-1 min-w-0 text-right truncate normal-case tracking-normal mm-han">
            {t.schoolsRampHint}
          </span>
        </div>
      </div>
    ) },
    housing: { expanded: publicHousingLegendOpen, onExpand: () => setPublicHousingLegendOpen(v => !v), content: (
      <div className={`pb-1 bg-(--mm-lime-2)/[0.05] ${publicHousingOn ? '' : 'opacity-40 light:opacity-100'}`}>
        {PUBLIC_HOUSING_TYPE_ORDER.map(type => {
          const on = isPublicHousingTypeOn(type)
          // "Lit" = actually drawn on the map: the type is on AND
          // the master switch is on.
          const lit = publicHousingOn && on
          const color = PUBLIC_HOUSING_TYPE_COLOR[type]
          return (
            <button
              key={type}
              type="button"
              onClick={() => onTogglePublicHousingType?.(type)}
              disabled={!onTogglePublicHousingType}
              aria-pressed={on}
              // Full label on hover (it truncates), plus — for the
              // `other` row — the programmes it covers.
              title={publicHousingTypeTitle(t, type)}
              className={`mm-layer-filter w-full flex items-center gap-2 py-1 pl-8 pr-3
                          hover:bg-(--mm-fg)/[0.04] transition
                          ${onTogglePublicHousingType ? '' : 'cursor-default'}`}
            >
              {/* The whole five-decade ramp while the type is on; a
                  hollow box in its identity colour while it is off,
                  the same on/off grammar as the school dots. */}
              <span
                className="inline-block w-[22px] h-[7px] shrink-0"
                style={on
                  ? { backgroundImage: publicHousingRampGradient(type) }
                  : { boxShadow: `inset 0 0 0 1px ${color}99` }}
              />
              <span className={`mm-layer-filter-label text-ui-10 leading-[1.2] flex-1 min-w-0 text-left truncate
                                ${on ? 'text-(--mm-fg)/75' : 'text-(--mm-text-subtle)'}`}>
                {publicHousingTypeLabel(t, type)}
              </span>
              <span
                className={`mm-mono mm-tabular text-ui-9 w-[18px] text-right shrink-0
                            ${lit ? '' : 'text-(--mm-fg)/25'}`}
                style={lit ? { color } : undefined}
              >
                {housingTypeCounts[type] ?? 0}
              </span>
              <span className={`mm-layer-state mm-mono text-ui-8 tracking-[0.2em] w-[20px] text-right shrink-0
                                ${lit ? 'text-(--mm-emerald)/80' : 'text-(--mm-text-muted)'}`}>
                {on ? 'ON' : 'OFF'}
              </span>
            </button>
          )
        })}
        {/* What the strips above mean. Without this line the shade
            reads as decoration rather than as the occupation decade. */}
        <div className="mm-layer-detail-note pl-8 pr-3 pt-[2px] flex items-baseline gap-2
                        mm-mono text-ui-7 tracking-[0.18em] text-(--mm-text-subtle) uppercase">
          <span className="mm-tabular shrink-0">{PUBLIC_HOUSING_DECADE_CAPTION}</span>
          <span className="flex-1 min-w-0 text-right truncate normal-case tracking-normal mm-han">
            {t.publicHousingRampHint}
          </span>
        </div>
        {/* Explain which other layers this focus mode preserves. */}
        <div className="mm-layer-detail-note pl-8 pr-3 mm-mono text-ui-7 tracking-[0.18em] text-(--mm-text-subtle) uppercase">
          {t.publicHousingFocusNote}
        </div>
      </div>
    ) },
    waste: { expanded: wasteLegendOpen, onExpand: () => setWasteLegendOpen(v => !v), content: (
      <div className="pb-1 bg-(--mm-green-2)/[0.05]">
        {wasteLegendRows(t, wasteCounts, hiddenWasteTypes).map(row => (
          <button
            key={row.id}
            type="button"
            onClick={() => onToggleWasteType?.(row.id)}
            disabled={!onToggleWasteType}
            aria-pressed={row.on}
            // The label truncates for the longest EN/PT wording, so
            // keep the whole thing readable on hover.
            title={row.label}
            className={`mm-layer-filter w-full flex items-center gap-2 py-1 pl-8 pr-3
                        hover:bg-(--mm-fg)/[0.04] transition
                        ${onToggleWasteType ? '' : 'cursor-default'}`}
          >
            <span
              className="inline-block w-[7px] h-[7px] shrink-0"
              style={row.on
                ? { backgroundColor: row.color }
                : { boxShadow: `inset 0 0 0 1px ${row.color}99` }}
            />
            <span className={`mm-layer-filter-label text-ui-10 leading-[1.2] flex-1 min-w-0 text-left truncate
                              ${row.on ? 'text-(--mm-fg)/75' : 'text-(--mm-text-subtle)'}`}>
              {row.label}
            </span>
            <span
              className={`mm-mono mm-tabular text-ui-9 w-[26px] text-right shrink-0
                          ${row.on ? '' : 'text-(--mm-fg)/25'}`}
              style={row.on ? { color: row.color } : undefined}
            >
              {row.count}
            </span>
            <span className={`mm-layer-state mm-mono text-ui-8 tracking-[0.2em] w-[20px] text-right shrink-0
                              ${row.on ? 'text-(--mm-emerald)/80' : 'text-(--mm-text-muted)'}`}>
              {row.on ? 'ON' : 'OFF'}
            </span>
          </button>
        ))}
        <div className="mm-layer-detail-note pl-8 pr-3 pt-[2px] mm-mono text-ui-7 tracking-[0.18em] text-(--mm-text-subtle) uppercase">
          {t.wasteTypesHint}
        </div>
        <div className="mm-layer-detail-note pl-8 pr-3 mm-mono text-ui-7 tracking-[0.18em] text-(--mm-text-subtle) uppercase">
          {t.wasteFocusNote}
        </div>
      </div>
    ) },
    water: { content: <WaterKey network={waterNetwork} caption={t.waterNetworkNote} /> },
    power: { content: <PowerKey network={powerNetwork} caption={t.powerNetworkNote} /> },
    grandprix: { content: <GrandPrixKey circuit={grandPrix} caption={t.grandPrixNote} /> },
  }


  const airSeaTotal = Number(totalFlightCount > 0) + Number(totalFerryCount > 0)
  const airSeaActive = Number(totalFlightCount > 0 && flightsOn) + Number(totalFerryCount > 0 && ferriesOn)
  const mobileTabs: MobileLayerTab[] = [
    { id: 'lrt', label: t.mobileLayersLrt, count: `${lrtActive}/${lrtTotal}`, accent: 'amber', icon: <MobileLayerIcon name="train" /> },
    ...(visibleRoutes ? [{ id: 'bus' as const, label: t.mobileLayersBus, count: `${visibleRoutes.size}/${busRoutes.length}`, accent: 'emerald', icon: <MobileLayerIcon name="bus" /> }] : []),
    ...(airSeaTotal > 0 ? [{ id: 'air-sea' as const, label: t.mobileLayersAirSea, count: `${airSeaActive}/${airSeaTotal}`, accent: 'sky', icon: <MobileLayerIcon name="ship" /> }] : []),
    ...(cityLayerTotal > 0 ? [{ id: 'city' as const, label: t.layerCity, count: `${cityLayerOn}/${cityLayerTotal}`, accent: 'amber', icon: <CityIcon /> }] : []),
  ]
  const mobileCityRow = cityLayerRows.find(row => row.panel === mobilePanel)
  const mobileCategory: MobileLayerCategory = mobileCityRow || mobilePanel === 'city' || mobilePanel === null
    ? 'city' : mobilePanel as MobileLayerCategory
  const isLrtOn = (id: string) => (lrtOn ? lrtOn.has(id) : true)
  const isLive = clock ? clock.isLive : true

  return (
    <>
      {/* Desktop LAYERS panel — collapsible; includes LRT + BUS groups + AIR */}
      {!desktopOpen ? (
        <button type="button" onClick={() => setDesktopOpen(true)} aria-expanded={false}
          className="mm-layer-launcher absolute top-4 right-4 z-20 hidden sm:flex landscape:hidden">
          <CityIcon size={18} /><span>{t.layerPanelTitle}</span>
        </button>
      ) : (
        <div className="mm-layer-panel absolute top-4 right-4 z-20 hidden sm:flex landscape:hidden"
          aria-label={t.layerPanelTitle}>
          <header className="mm-layer-header">
            <div className="mm-layer-eyebrow mm-mono"><CityIcon size={14} /> MINI MACAU <span>/ ATLAS</span></div>
            <button type="button" className="mm-layer-close" onClick={() => setDesktopOpen(false)}
              aria-label={t.layerClose}><CloseIcon /></button>
            <h2>{t.layerPanelTitle}</h2>
            <p>{t.layerPanelSubtitle}</p>
            <span className="mm-layer-live mm-mono" data-live={isLive}>
              <span />{isLive ? t.live : t.simShort}
            </span>
          </header>
          <div role="tablist" aria-label={t.layerPanelTitle} className="mm-layer-tabs">
            {LAYERS_TABS.map((tab, index) => (
              <button key={tab} id={`layers-tab-${tab}`} type="button" role="tab"
                aria-selected={layersTab === tab} aria-controls="layers-content"
                tabIndex={layersTab === tab ? 0 : -1}
                onClick={() => setLayersTab(tab)}
                onKeyDown={event => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const next = event.key === 'Home' ? 'transit' : event.key === 'End' ? 'city' : tab === 'city' ? 'transit' : 'city'
                  setLayersTab(next)
                  document.getElementById(`layers-tab-${next}`)?.focus()
                }}>
                {tab === 'transit' ? <BusIcon size={16} /> : <CityIcon size={16} />}
                <span>{tab === 'transit' ? t.layerTransit : t.layerCity}</span>
                <span className="mm-layer-tab-index mm-mono">0{index + 1}</span>
              </button>
            ))}
          </div>
          <div id="layers-content" role="tabpanel" aria-labelledby={`layers-tab-${layersTab}`}
            className="mm-layer-scroll" tabIndex={0}>
          {layersTab === 'transit' && (<div className="mm-transit-layers">
          {/* LRT — clickable rows */}
          <div>
            <div className="px-3 py-2 flex items-center justify-between bg-(--mm-fg)/[0.015] border-b border-(--mm-fg)/5">
              <span className="flex items-center gap-1.5 text-(--mm-text-muted)">
                <LrtIcon size={12} className="shrink-0 opacity-70" />
                <span
                  className="inline-block w-[8px] h-[8px]"
                  style={{ backgroundImage: 'repeating-linear-gradient(-45deg, color-mix(in srgb, var(--mm-amber) 35%, transparent) 0 1px, transparent 1px 3px)' }}
                />
                <span className="mm-mono text-ui-10 tracking-[0.25em]">LRT · 輕軌</span>
              </span>
              <span className="mm-mono mm-tabular text-ui-10 text-(--mm-text-subtle)">
                {lrtActive}<span className="text-(--mm-fg)/20">/{lrtTotal}</span>
              </span>
            </div>
            <div className="py-0.5">
              {allLrtLines.map(line => {
                const on = isLrtOn(line.id)
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => onToggleLrt?.(line.id)}
                    disabled={!onToggleLrt}
                    aria-pressed={on}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 border-l-2 transition
                               ${on
                                 ? 'border-(--mm-amber)/60 bg-(--mm-amber)/[0.04] hover:bg-(--mm-amber)/[0.08]'
                                 : 'border-transparent hover:bg-(--mm-fg)/[0.03] opacity-40 light:opacity-100'}
                               ${onToggleLrt ? '' : 'cursor-default'}`}
                  >
                    <div className="w-3 h-[3px] shrink-0" style={{ backgroundColor: on ? line.color : 'color-mix(in srgb, var(--mm-fg) 35%, transparent)' }} />
                    <span className={`mm-han text-ui-13 flex-1 text-left truncate
                                      ${on ? 'text-(--mm-fg)/90' : 'text-(--mm-text-muted)'}`}>
                      {localName(lang, line)}
                    </span>
                    <span className={`mm-layer-state mm-mono text-ui-10 tracking-[0.2em] shrink-0
                                      ${on ? 'text-(--mm-emerald)/80' : 'text-(--mm-text-muted)'}`}>
                      {on ? 'ON' : 'OFF'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* BUS section with mode tabs + collapsible groups */}
          {totalRoutes > 0 && visibleRoutes && (
            <div className="border-t border-(--mm-fg)/10">
              <div className="px-3 py-2 flex items-center justify-between bg-(--mm-fg)/[0.015]">
                <span className="flex items-center gap-1.5 text-(--mm-text-muted)">
                  <BusIcon size={12} className="shrink-0 opacity-70" />
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, color-mix(in srgb, var(--mm-emerald) 35%, transparent) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-ui-10 tracking-[0.25em]">BUS · 巴士</span>
                </span>
                <span className="mm-mono mm-tabular text-ui-11 text-(--mm-emerald)/80">
                  {activeRoutes}<span className="text-(--mm-text-subtle)">/{totalRoutes}</span>
                </span>
              </div>
              <div className="grid grid-cols-3 border-y border-(--mm-fg)/8">
                <button
                  onClick={onResetAuto}
                  className={`px-1 py-2 mm-mono text-ui-11 tracking-[0.1em] transition-colors text-center
                             ${isAutoMode
                               ? 'bg-(--mm-amber)/10 text-(--mm-amber-1)'
                               : 'text-(--mm-text-muted) hover:text-(--mm-fg) hover:bg-(--mm-fg)/5'}`}
                  style={isAutoMode ? { boxShadow: 'inset 0 -2px 0 color-mix(in srgb, var(--mm-amber) 70%, transparent)' } : undefined}
                >
                  {t.autoByTime}
                </button>
                <button
                  onClick={onShowAll}
                  className="px-1 py-2 mm-mono text-ui-11 tracking-[0.15em] text-(--mm-text-muted) hover:text-(--mm-fg)
                             hover:bg-(--mm-fg)/5 transition-colors text-center border-l border-(--mm-fg)/8"
                >
                  {t.showAll}
                </button>
                <button
                  onClick={onHideAll}
                  className="px-1 py-2 mm-mono text-ui-11 tracking-[0.15em] text-(--mm-text-muted) hover:text-(--mm-fg)
                             hover:bg-(--mm-fg)/5 transition-colors text-center border-l border-(--mm-fg)/8"
                >
                  {t.hideAll}
                </button>
              </div>
              <div className="">
                {GROUP_ORDER.map(groupKey => {
                  const routes = grouped.get(groupKey) || []
                  if (routes.length === 0) return null
                  const groupActive = routes.filter(r => visibleRoutes.has(r.id)).length
                  const eligibleInGroup = routes.filter(r => !(inactiveRoutes?.has(r.id) ?? false))
                  const groupOn = groupActive > 0
                  const collapsed = collapsedGroups.has(groupKey)
                  return (
                    <div key={groupKey} className="border-t border-(--mm-fg)/5">
                      <div className="w-full flex items-stretch bg-(--mm-fg)/[0.015]">
                        <button
                          type="button"
                          onClick={() => toggleGroupCollapse(groupKey)}
                          aria-expanded={!collapsed}
                          className="flex-1 min-w-0 px-2 py-2 flex items-center gap-2
                                     hover:bg-(--mm-fg)/[0.04] transition"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0
                                            ${groupActive > 0 ? 'bg-(--mm-amber)' : 'bg-(--mm-fg)/15'}`}
                                style={groupActive > 0 ? { boxShadow: '0 0 5px color-mix(in srgb, var(--mm-amber) 80%, transparent)' } : undefined} />
                          <span className="mm-mono text-ui-11 tracking-[0.2em] text-(--mm-text-secondary) uppercase flex-1 text-left">
                            {t[GROUP_LABEL_KEYS[groupKey]]}
                          </span>
                          <span className="mm-mono mm-tabular text-ui-11 text-(--mm-text-muted) w-10 text-right">
                            {groupActive}/{routes.length}
                          </span>
                          <span className="text-(--mm-text-subtle) mm-mono text-ui-10 w-3 text-center">
                            {collapsed ? '▸' : '▾'}
                          </span>
                        </button>
                        {onToggleGroup && eligibleInGroup.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onToggleGroup(groupKey)}
                            aria-pressed={groupOn}
                            aria-label={t[GROUP_LABEL_KEYS[groupKey]]}
                            className={`shrink-0 w-10 mm-mono text-ui-10 tracking-[0.2em]
                                        border-l border-(--mm-fg)/8 transition text-center
                                        ${groupOn
                                          ? 'text-(--mm-emerald)/80 hover:bg-(--mm-emerald)/10'
                                          : 'text-(--mm-text-subtle) hover:text-(--mm-fg)/80 hover:bg-(--mm-fg)/[0.05]'}`}
                          >
                            {groupOn ? 'ON' : 'OFF'}
                          </button>
                        )}
                      </div>
                      {!collapsed && (
                        <div className="bg-(--mm-inset)">
                          {routes.map(route => {
                            const inactive = inactiveRoutes?.has(route.id) ?? false
                            const on = visibleRoutes.has(route.id)
                            return (
                              <button
                                key={route.id}
                                onClick={() => !inactive && onToggleRoute?.(route.id)}
                                disabled={inactive}
                                aria-pressed={on}
                                title={inactive ? t.noServiceToday : undefined}
                                className={`w-full px-2 py-[3px] flex items-center gap-2 transition-colors
                                           ${inactive
                                             ? 'opacity-30 cursor-not-allowed'
                                             : on ? 'hover:bg-(--mm-fg)/[0.04]' : 'opacity-35 hover:opacity-60 light:opacity-100'}`}
                              >
                                <span
                                  className="mm-mono mm-tabular text-ui-12 font-bold text-center shrink-0"
                                  style={{
                                    width: 36,
                                    color: inactive ? '#444' : on ? route.color : 'color-mix(in srgb, var(--mm-fg) 35%, transparent)',
                                    textShadow: !inactive && on ? `0 0 6px ${route.color}66` : 'none',
                                    textDecoration: inactive ? 'line-through' : 'none',
                                  }}
                                >
                                  {route.name}
                                </span>
                                <span className={`text-ui-12 flex-1 text-left truncate mm-han
                                                  ${inactive ? 'text-(--mm-fg)/25' : on ? 'text-(--mm-fg)/75' : 'text-(--mm-text-subtle)'}`}>
                                  {inactive
                                    ? t.noServiceToday
                                    : (lang !== 'en' && route.nameCn ? route.nameCn : '')}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* AIR — toggleable */}
          {totalFlightCount > 0 && (
            <button
              type="button"
              onClick={onToggleFlights}
              disabled={!onToggleFlights}
              aria-pressed={flightsOn}
              className={`w-full px-3 py-2.5 flex items-center gap-2 transition border-t border-(--mm-fg)/10
                         ${flightsOn
                           ? 'bg-(--mm-sky-2)/[0.04] hover:bg-(--mm-sky-2)/[0.08]'
                           : 'hover:bg-(--mm-fg)/[0.03] opacity-50 light:opacity-100'}
                         ${onToggleFlights ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${flightsOn ? 'text-(--mm-text-muted)' : 'text-(--mm-text-muted)'}`}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 2L11 13" />
                  <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, color-mix(in srgb, var(--mm-sky) 35%, transparent) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-ui-10 tracking-[0.25em] text-(--mm-text-muted) flex-1 text-left">
                AIR · 航班
              </span>
              <span className={`mm-mono mm-tabular text-ui-11 ${flightsOn ? 'text-(--mm-sky)/80' : 'text-(--mm-fg)/25'}`}>
                {flightCount}
              </span>
              <span className={`mm-layer-state mm-mono text-ui-10 tracking-[0.2em] ml-1 ${flightsOn ? 'text-(--mm-emerald)/80' : 'text-(--mm-text-muted)'}`}>
                {flightsOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* SEA — toggleable */}
          {totalFerryCount > 0 && (
            <button
              type="button"
              onClick={onToggleFerries}
              disabled={!onToggleFerries}
              aria-pressed={ferriesOn}
              className={`w-full px-3 py-2.5 flex items-center gap-2 transition border-t border-(--mm-fg)/10
                         ${ferriesOn
                           ? 'bg-(--mm-red-2)/[0.05] hover:bg-(--mm-red-2)/[0.1]'
                           : 'hover:bg-(--mm-fg)/[0.03] opacity-50 light:opacity-100'}
                         ${onToggleFerries ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${ferriesOn ? 'text-(--mm-text-muted)' : 'text-(--mm-text-muted)'}`}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="5" r="3" />
                  <path d="M12 22V8" />
                  <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
                </svg>
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, color-mix(in srgb, var(--mm-red-2) 35%, transparent) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-ui-10 tracking-[0.25em] text-(--mm-text-muted) flex-1 text-left">
                SEA · 船運
              </span>
              <span className={`mm-mono mm-tabular text-ui-11 ${ferriesOn ? 'text-(--mm-red)/80' : 'text-(--mm-fg)/25'}`}>
                {ferryCount}
              </span>
              <span className={`mm-layer-state mm-mono text-ui-10 tracking-[0.2em] ml-1 ${ferriesOn ? 'text-(--mm-emerald)/80' : 'text-(--mm-text-muted)'}`}>
                {ferriesOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}
          </div>)}

          {layersTab === 'city' && <CityLayerList rows={cityLayerRows} details={cityDetails} />}
          </div>
          <footer className="mm-layer-footer">
            <span className="mm-layer-footer-dot" />
            {layersTab === 'city' ? t.layerActive(cityLayerOn) : t.layerTransitHint}
            <span className="mm-mono">MACAU</span>
          </footer>
        </div>
      )}

      {/* Mobile: 4-icon stack — LRT / BUS / AIR+SEA / CITY, below MapLibre +/- zoom
          controls. POSITIONED BY AN UNZOOMED WRAPPER: engines disagree on
          whether CSS `zoom` also scales an absolutely positioned element's own
          top/right (Chromium yes, iOS 16 WebKit — the last iOS an iPhone X
          gets — no), so a zoomed `top-[8rem]` used to land at 154px on Chrome
          and 128px on that Safari, straight over the compass button. The
          wrapper's offsets are plain px everywhere and only the stack inside
          is scaled — the same split index.css makes for the MapLibre control.
          154px sits just under that control (bottom ~141px) and still leaves
          room above the bottom timeline for popovers on short viewports. */}
      <div className="absolute top-[154px] right-[0.5rem] z-10 sm:hidden landscape:block">
      <div className="mm-mode-stack mm-ui-scale flex flex-col gap-1.5">
        {/* LRT chip */}
        <button
          onClick={() => togglePanel('lrt')}
          aria-label={t.lrtLines}
          aria-expanded={mobilePanel === 'lrt'}
          className={`w-9 h-9 flex items-center justify-center bg-(--mm-panel-2)
                     border transition shadow-[0_8px_24px_var(--mm-shadow)]
                     ${mobilePanel === 'lrt'
                       ? 'border-(--mm-amber)/60 text-(--mm-amber-1)'
                       : lrtActive > 0
                         ? 'border-(--mm-amber)/25 text-(--mm-amber-1)/80 hover:border-(--mm-amber)/50 active:scale-95'
                         : 'border-(--mm-fg)/10 text-(--mm-text-muted) hover:border-(--mm-fg)/25'}`}
        >
          <LrtIcon />
        </button>

        {/* BUS chip */}
        <button
          onClick={() => togglePanel('bus')}
          aria-label={t.busRoutes}
          aria-expanded={mobilePanel === 'bus'}
          className={`w-9 h-9 flex items-center justify-center bg-(--mm-panel-2)
                     border transition shadow-[0_8px_24px_var(--mm-shadow)]
                     ${mobilePanel === 'bus'
                       ? 'border-(--mm-emerald)/60 text-(--mm-emerald-1)'
                       : 'border-(--mm-emerald)/25 text-(--mm-emerald-1)/80 hover:border-(--mm-emerald)/50 active:scale-95'}`}
        >
          <BusIcon />
        </button>

        {/* Combined air and sea chip */}
        {airSeaTotal > 0 && (
          <button
            onClick={() => togglePanel('air-sea')}
            aria-label={`${t.flights} / ${t.ferries}`}
            aria-expanded={mobilePanel === 'air-sea'}
            className={`w-9 h-9 flex items-center justify-center bg-(--mm-panel-2)
                       border transition shadow-[0_8px_24px_var(--mm-shadow)]
                       ${mobilePanel === 'air-sea'
                         ? 'border-(--mm-sky)/60 text-(--mm-sky)'
                         : airSeaActive > 0
                           ? 'border-(--mm-sky)/25 text-(--mm-sky)/80 hover:border-(--mm-sky)/50 active:scale-95'
                           : 'border-(--mm-fg)/10 text-(--mm-text-muted) hover:border-(--mm-fg)/25'}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="m3 11 6 1 11-6c1.5-.8.7-2.7-.8-2l-4.7 2-5-3-2 1 3 4-4 2-2-1z" />
              <path d="M3 17q2.25-2 4.5 0t4.5 0 4.5 0 4.5 0M3 21q2.25-2 4.5 0t4.5 0 4.5 0 4.5 0" />
            </svg>
          </button>
        )}

        {/* CITY chip — WORKS / SCHOOLS / WC / P live behind one chip (the
            desktop panel's CITY page); a hairline separates it from the
            transit chips above. Lit while any city layer is on. */}
        {cityLayerTotal > 0 && (
          <>
            <div className="self-center w-[22px] h-px my-[3px] bg-(--mm-fg)/[0.18]" aria-hidden="true" />
            <button
              onClick={() => togglePanel('city')}
              aria-label={t.cityLayers}
              aria-expanded={mobilePanel === 'city'}
              className={`w-9 h-9 flex items-center justify-center bg-(--mm-panel-2)
                         border transition shadow-[0_8px_24px_var(--mm-shadow)]
                         ${mobilePanel === 'city'
                           ? 'border-(--mm-fg)/60 text-(--mm-fg)'
                           : cityLayerOn > 0
                             ? 'border-(--mm-fg)/25 text-(--mm-fg)/80 hover:border-(--mm-fg)/50 active:scale-95'
                             : 'border-(--mm-fg)/10 text-(--mm-text-muted) hover:border-(--mm-fg)/25'}`}
            >
              <CityIcon />
            </button>
          </>
        )}
      </div>
      </div>

      {mobilePanel !== null && (
        <MobileLayerSheet tabs={mobileTabs} category={mobileCategory} pageKey={mobilePanel}
          title={mobileCityRow?.label ?? t.mobileLayersTitle}
          onCategory={setMobilePanel} onClose={() => setMobilePanel(null)}
          onBack={mobileCityRow ? () => setMobilePanel('city') : undefined}>
          {mobilePanel === 'city' && <MobileCityIndex rows={cityLayerRows}
            onInspect={id => {
              setMobilePanel(id as MobilePanel)
              onRequestCityLayer?.(id as CityLayer)
            }} />}
          {mobileCityRow && <MobileCityDetail row={mobileCityRow}>
            {mobileCityRow.panel === 'parishes' && <p>{t.parishesTitle}</p>}
            {cityDetails[mobileCityRow.panel]?.content}
          </MobileCityDetail>}

          {mobilePanel === 'lrt' && <MobileLrtConsole lines={allLrtLines}
            stations={allTransitData?.stations ?? transitData.stations} enabled={lrtOn} onToggle={onToggleLrt} />}

          {mobilePanel === 'bus' && visibleRoutes && <MobileBusRegister
            grouped={grouped} visibleRoutes={visibleRoutes} inactiveRoutes={inactiveRoutes}
            selectedGroup={mobileBusGroup} onSelectGroup={setMobileBusGroup}
            isAutoMode={isAutoMode} onToggleRoute={onToggleRoute} onToggleGroup={onToggleGroup}
            onResetAuto={onResetAuto} onShowAll={onShowAll} onHideAll={onHideAll} />}

          {mobilePanel === 'air-sea' && <MobileServiceTickets flightCount={flightCount} ferryCount={ferryCount}
            showFlights={totalFlightCount > 0} showFerries={totalFerryCount > 0}
            flightsOn={flightsOn} ferriesOn={ferriesOn}
            onToggleFlights={onToggleFlights} onToggleFerries={onToggleFerries} />}
        </MobileLayerSheet>
      )}
    </>
  )
}
