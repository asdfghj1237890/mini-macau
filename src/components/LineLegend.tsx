import { useState, useMemo, useEffect } from 'react'
import type { TransitData, SimulationClock, SchoolLevel } from '../types'
import { useI18n, localName } from '../i18n'
import { getRouteGroup, GROUP_ORDER, GROUP_LABEL_KEYS, type GroupKey } from '../routeGroups'
import {
  SCHOOL_COLORS,
  SCHOOL_LEVEL_ORDER,
  countSchoolsByLevel,
  schoolLevelLabel,
  type SchoolLevelSet,
} from '../schools'
import { waterLegendRows, type WaterLegendRow } from '../water'
import { powerLegendRows, type PowerLegendRow } from '../power'
import {
  WASTE_LAYER_TYPES,
  countWasteByType,
  visibleWasteCount,
  wasteIncinerator,
  wasteLegendRows,
  type WasteLayerType,
  type WasteTypeSet,
} from '../waste'

// The five level colours as one 8×8 swatch. Only the mobile modal header uses
// it now — the desktop row shows the same violet hatch as the other layers,
// because the per-level rows underneath carry the colour key themselves.
const SCHOOL_SWATCH_GRADIENT = `linear-gradient(90deg, ${
  SCHOOL_LEVEL_ORDER.map((level, i) =>
    `${SCHOOL_COLORS[level]} ${i * 20}% ${(i + 1) * 20}%`).join(', ')
})`

// Violet hatch for the SCHOOLS row, matching the AIR/SEA/WORKS swatches.
const SCHOOL_HATCH = 'repeating-linear-gradient(-45deg, rgba(167,139,250,0.45) 0 1px, transparent 1px 3px)'

// Static English caption beside each level's localised label, so a row reads
// the same in all three UI languages (the mono column is decoration, not a
// translated string).
const SCHOOL_LEVEL_CAPTIONS: Record<SchoolLevel, string> = {
  kindergarten: 'KINDER',
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  university: 'TERTIARY',
  all_through: 'ALL-THROUGH',
}

// Teal hatch for the WC row, matching the AIR/SEA/WORKS/SCHOOLS swatches.
const TOILET_HATCH = 'repeating-linear-gradient(-45deg, rgba(20,184,166,0.45) 0 1px, transparent 1px 3px)'

// Blue hatch for the car-park row — the marker colour (#3b82f6).
const CAR_PARK_HATCH = 'repeating-linear-gradient(-45deg, rgba(59,130,246,0.45) 0 1px, transparent 1px 3px)'

// Green hatch for the WASTE row — the three-colour recycling green (#4ade80).
// The overlay has six colours and no single dominant one, so the row wears the
// recycling green the map's largest recycling type is drawn in.
const WASTE_HATCH = 'repeating-linear-gradient(-45deg, rgba(74,222,128,0.45) 0 1px, transparent 1px 3px)'

// Sky hatch for the WATER row — the reservoir colour (#38bdf8), which is the
// overlay's dominant tone on the map.
const WATER_HATCH = 'repeating-linear-gradient(-45deg, rgba(56,189,248,0.45) 0 1px, transparent 1px 3px)'

// Amber hatch for the POWER row — the distribution colour (#fbbf24), which is
// the overlay's dominant tone across the city.
const POWER_HATCH = 'repeating-linear-gradient(-45deg, rgba(251,191,36,0.45) 0 1px, transparent 1px 3px)'

// 12px lightning bolt for the POWER row, in the same stroked style as its
// siblings so it dims with the row.
function PowerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.3 1.6L4.9 8.4h2.6l-1 6 4.6-7h-2.6z" />
    </svg>
  )
}

// 12px droplet for the WATER row — the same stroked style as the sibling row
// glyphs, so it dims with the row instead of staying lit like an emoji would.
function WaterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.75c2.6 3 4.25 5.05 4.25 7.1a4.25 4.25 0 0 1-8.5 0c0-2.05 1.65-4.1 4.25-7.1z" />
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

// The key itself. `network` decides which pipe rows appear (see
// waterLegendRows) — a file with no pipes shows the facility rows only.
function WaterKey({ network, caption }: { network: TransitData['waterNetwork']; caption: string }) {
  const { t } = useI18n()
  const rows = waterLegendRows(t, network)
  return (
    <div className="pb-1.5">
      {rows.map(row => (
        <div key={row.id} className="w-full flex items-center gap-2 py-[2px] pl-8 pr-3">
          <KeyGlyph row={row} />
          <span className="text-[10px] leading-[1.2] flex-1 min-w-0 text-left truncate text-white/60"
                title={row.label}>
            {row.label}
          </span>
        </div>
      ))}
      <div className="pl-8 pr-3 pt-[2px] mm-mono text-[7px] tracking-[0.18em] text-white/30 uppercase">
        {caption}
      </div>
    </div>
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

// The key itself. `network` decides which voltage rows appear (see
// powerLegendRows) — a file with no lines shows the facility rows only.
function PowerKey({ network, caption }: { network: TransitData['powerNetwork']; caption: string }) {
  const { t } = useI18n()
  const rows = powerLegendRows(t, network)
  return (
    <div className="pb-1.5">
      {rows.map(row => (
        <div key={row.id} className="w-full flex items-center gap-2 py-[2px] pl-8 pr-3">
          <PowerKeyGlyph row={row} />
          <span className="text-[10px] leading-[1.2] flex-1 min-w-0 text-left truncate text-white/60"
                title={row.label}>
            {row.label}
          </span>
        </div>
      ))}
      <div className="pl-8 pr-3 pt-[2px] mm-mono text-[7px] tracking-[0.18em] text-white/30 uppercase">
        {caption}
      </div>
    </div>
  )
}

// 12px "P" plate for the car-park row: a rounded-square outline with the
// parking P, in the same stroked style as the sibling row glyphs.
function CarParkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" />
      <path d="M6.25 11.75V4.75h2.1a2.1 2.1 0 0 1 0 4.2h-2.1" />
    </svg>
  )
}

// 12px restroom figures for the WC row — the universal sign. Heads and bodies
// are filled silhouettes (stroked figures turn to mush at 12px), legs and the
// hairline divider are strokes; everything is currentColor so it dims with
// the row like the other glyphs (an emoji would not recolour).
function ToiletIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="4.75" cy="3.25" r="1.5" fill="currentColor" stroke="none" />
      <rect x="3" y="5.25" width="3.5" height="5" rx="1.25" fill="currentColor" stroke="none" />
      <path d="M3.75 10.25v3.25M5.75 10.25v3.25" strokeWidth="1.25" />
      <circle cx="11.25" cy="3.25" r="1.5" fill="currentColor" stroke="none" />
      <path d="M11.25 5.25l2.75 5.25h-5.5z" fill="currentColor" strokeWidth="1" />
      <path d="M10.35 10.5v3M12.15 10.5v3" strokeWidth="1.25" />
      <path d="M8 2.25v11.5" strokeWidth="1" opacity="0.5" />
    </svg>
  )
}

// 12px lidded bin with a recycling chevron for the WASTE row, in the same
// stroked style as its siblings so it dims with the row.
function WasteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.75 4.5h10.5" />
      <path d="M6.5 4.5V3h3v1.5" />
      <path d="M4 4.5l.85 8.4a.8.8 0 0 0 .8.6h4.7a.8.8 0 0 0 .8-.6l.85-8.4" />
      <path d="M6.6 7.5v3.4M9.4 7.5v3.4" strokeWidth="1.1" opacity="0.65" />
    </svg>
  )
}

// 12px mortarboard for the SCHOOLS row's glyph slot.
function MortarboardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 6.5L8 3.5l6 3-6 3-6-3z" />
      <path d="M4.5 8.2v3c0 .9 1.6 1.8 3.5 1.8s3.5-.9 3.5-1.8v-3" />
      <path d="M14 6.5v3.5" />
    </svg>
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
const CITY_HATCH = 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.30) 0 1px, transparent 1px 3px)'

const LS_DESKTOP_OPEN = 'mm-layers-desktop-open'
const LS_DESKTOP_COLLAPSED_GROUPS = 'mm-layers-collapsed-groups'
const LS_SCHOOLS_LEGEND_OPEN = 'mm-schools-legend-open'
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
  clock?: SimulationClock
  onToggleLrt?: (id: string) => void
  onToggleFlights?: () => void
  onToggleFerries?: () => void
  onToggleRoadWorks?: () => void
  onToggleSchools?: () => void
  onToggleSchoolLevel?: (level: SchoolLevel) => void
  onToggleToilets?: () => void
  onToggleCarParks?: () => void
  onToggleWaste?: () => void
  onToggleWasteType?: (type: WasteLayerType) => void
  onToggleWater?: () => void
  onTogglePower?: () => void
  onToggleRoute?: (routeId: string) => void
  onToggleAll?: () => void
  onShowAll?: () => void
  onHideAll?: () => void
  onToggleGroup?: (groupKey: GroupKey) => void
  onResetAuto?: () => void
}

type MobilePanel = 'lrt' | 'bus' | 'air' | 'sea' | 'works' | 'schools' | 'toilets' | 'carparks' | 'waste' | 'water' | 'power' | 'city' | null

export function LineLegend({
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
  toiletsOn = false,
  carParksOn = false,
  wasteOn = false,
  wasteHiddenTypes,
  wasteTypeCounts,
  waterOn = false,
  powerOn = false,
  clock,
  onToggleLrt,
  onToggleFlights,
  onToggleFerries,
  onToggleRoadWorks,
  onToggleSchools,
  onToggleSchoolLevel,
  onToggleToilets,
  onToggleCarParks,
  onToggleWaste,
  onToggleWasteType,
  onToggleWater,
  onTogglePower,
  onToggleRoute,
  onShowAll,
  onHideAll,
  onToggleGroup,
  onResetAuto,
}: Props) {
  const { lang, t } = useI18n()
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null)
  const [desktopOpen, setDesktopOpen] = useState(() => {
    try { return localStorage.getItem(LS_DESKTOP_OPEN) !== '0' } catch { return true }
  })
  const [schoolsLegendOpen, setSchoolsLegendOpen] = useState(() => {
    try { return localStorage.getItem(LS_SCHOOLS_LEGEND_OPEN) !== '0' } catch { return true }
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
    () => wasteTypeCounts ?? countWasteByType(allWaste, wasteIncinerator(allPower)),
    [wasteTypeCounts, allWaste, allPower]
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
                      bg-[#0b0b0c]/95 backdrop-blur-md rounded-sm
                      px-3 py-2 border border-white/10 text-amber-300/80
                      mm-mono text-[10px] tracking-[0.25em] w-[240px] text-center">
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
  const totalRoadWorkCount = allTransitData?.roadWorks.length ?? transitData.roadWorks.length
  // Schools are static, so `schoolCount` is the full register — the master
  // switch empties `transitData.schools`, it doesn't change how many exist.
  // The per-level toggles narrow it, hence the enabled/total pair.
  const schoolCount = allTransitData?.schools.length ?? transitData.schools.length
  const isSchoolLevelOn = (level: SchoolLevel) =>
    (schoolLevelsOn ? schoolLevelsOn.has(level) : true)
  const schoolLevelsAllOn = SCHOOL_LEVEL_ORDER.every(isSchoolLevelOn)
  const schoolEnabledCount = SCHOOL_LEVEL_ORDER.reduce(
    (sum, level) => (isSchoolLevelOn(level) ? sum + (levelCounts[level] ?? 0) : sum), 0
  )
  // Toilets are static and unfiltered: the row always shows the full register,
  // and the master switch is the only thing that empties transitData.toilets.
  const toiletCount = allTransitData?.toilets.length ?? transitData.toilets.length
  // Same for the car parks: the row always shows the full register.
  const carParkCount = allTransitData?.carParks.length ?? transitData.carParks.length
  // Waste is the one CITY row whose count MOVES: the master switch is a whole-
  // layer toggle like its neighbours, but the six type toggles narrow what is
  // drawn, so the row shows the visible total (and enabled/total when some type
  // is hidden) rather than the register size.
  const wasteTotal = visibleWasteCount(wasteCounts, EMPTY_WASTE_TYPES)
  const hiddenWasteTypes: WasteTypeSet = wasteHiddenTypes ?? EMPTY_WASTE_TYPES
  const wasteTypesAllOn = WASTE_LAYER_TYPES.every(type => !hiddenWasteTypes.has(type))
  const wasteVisibleCount = visibleWasteCount(wasteCounts, hiddenWasteTypes)
  // And for the water facilities — Macao Water's list is a fixed 22.
  const waterCount = allTransitData?.waterFacilities.length ?? transitData.waterFacilities.length
  // The UNFILTERED network, for the same reason as the count above: the key
  // describes what the layer draws when it is on, and `transitData` is nulled
  // out while it is off.
  const waterNetwork = allTransitData?.waterNetwork ?? transitData.waterNetwork
  // And for the electricity facilities — CEM's list is fixed until the manual
  // pipeline run regenerates it.
  const powerCount = allTransitData?.powerFacilities.length ?? transitData.powerFacilities.length
  const powerNetwork = allTransitData?.powerNetwork ?? transitData.powerNetwork

  // Mobile CITY modal — the city overlays in one list, the counterpart of the
  // desktop panel's CITY page. A row's name opens that layer's own modal; its
  // switch toggles the layer in place. Only layers with data get a row.
  const cityLayerRows = [
    totalRoadWorkCount > 0 ? {
      panel: 'works' as const, label: 'WORKS · 工程', icon: WORKS_ICON_16, on: roadWorksOn,
      count: String(activeRoadWorksCount), iconOn: 'text-amber-300', countOn: 'text-amber-300/80',
      toggle: onToggleRoadWorks,
    } : null,
    schoolCount > 0 ? {
      panel: 'schools' as const, label: 'SCHOOLS · 學校', icon: MORTARBOARD_ICON_16, on: schoolsOn,
      count: schoolLevelsAllOn ? String(schoolCount) : `${schoolEnabledCount}/${schoolCount}`,
      iconOn: 'text-violet-300', countOn: 'text-violet-300/80', toggle: onToggleSchools,
    } : null,
    toiletCount > 0 ? {
      panel: 'toilets' as const, label: 'WC · 公廁', icon: TOILET_ICON_16, on: toiletsOn,
      count: String(toiletCount), iconOn: 'text-teal-300', countOn: 'text-teal-300/80',
      toggle: onToggleToilets,
    } : null,
    carParkCount > 0 ? {
      panel: 'carparks' as const, label: 'PARKING · 停車場', icon: CAR_PARK_ICON_16, on: carParksOn,
      count: String(carParkCount), iconOn: 'text-blue-300', countOn: 'text-blue-300/80',
      toggle: onToggleCarParks,
    } : null,
    wasteTotal > 0 ? {
      panel: 'waste' as const, label: 'WASTE · 垃圾回收', icon: WASTE_ICON_16, on: wasteOn,
      count: wasteTypesAllOn ? String(wasteTotal) : `${wasteVisibleCount}/${wasteTotal}`,
      iconOn: 'text-green-300', countOn: 'text-green-300/80',
      toggle: onToggleWaste,
    } : null,
    waterCount > 0 ? {
      panel: 'water' as const, label: 'WATER · 供水', icon: WATER_ICON_16, on: waterOn,
      count: String(waterCount), iconOn: 'text-sky-300', countOn: 'text-sky-300/80',
      toggle: onToggleWater,
    } : null,
    powerCount > 0 ? {
      panel: 'power' as const, label: 'POWER · 電力', icon: POWER_ICON_16, on: powerOn,
      count: String(powerCount), iconOn: 'text-amber-300', countOn: 'text-amber-300/80',
      toggle: onTogglePower,
    } : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null)
  const cityLayerTotal = cityLayerRows.length
  const cityLayerOn = cityLayerRows.filter(row => row.on).length

  const isLrtOn = (id: string) => (lrtOn ? lrtOn.has(id) : true)
  const isLive = clock ? clock.isLive : true

  return (
    <>
      {/* Desktop LAYERS panel — collapsible; includes LRT + BUS groups + AIR */}
      {!desktopOpen ? (
        <button
          type="button"
          onClick={() => setDesktopOpen(true)}
          className="mm-ui-scale absolute top-3 right-3 z-20 hidden sm:flex landscape:hidden
                     bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10
                     hover:border-amber-300/40 shadow-xl px-3 py-2 items-center gap-3 transition"
        >
          <span className="mm-mono text-[8px] tracking-[0.28em] text-amber-300/70">▤ LAYERS</span>
          <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-white/60">
            {allLrtLines.slice(0, 3).map(line => (
              <span
                key={line.id}
                className="w-1.5 h-[3px]"
                style={{ backgroundColor: isLrtOn(line.id) ? line.color : '#444' }}
              />
            ))}
            <span className="text-white/40 ml-0.5">{lrtActive}/{lrtTotal}</span>
          </span>
          <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-white/60">
            <span className={`w-1.5 h-1.5 rounded-full ${activeRoutes > 0 ? 'bg-emerald-400' : 'bg-white/20'}`} />
            <span>{activeRoutes}/{totalRoutes}</span>
          </span>
          {totalFlightCount > 0 && flightsOn && (
            <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-sky-300/80">
              <span>✈</span><span>{flightCount}</span>
            </span>
          )}
          {totalFerryCount > 0 && ferriesOn && (
            <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-red-300/80">
              <span>{'\u2693\uFE0E'}</span><span>{ferryCount}</span>
            </span>
          )}
          {totalRoadWorkCount > 0 && roadWorksOn && (
            <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-amber-300/80">
              <span>{'\u26A0\uFE0E'}</span><span>{activeRoadWorksCount}</span>
            </span>
          )}
        </button>
      ) : (
        <div className="mm-ui-scale absolute top-3 right-3 z-20 hidden sm:block landscape:hidden
                        bg-[#0b0b0c]/95 backdrop-blur-md rounded-sm
                        border border-white/10 overflow-hidden w-[240px] shadow-2xl">
          {/* Header */}
          <div className="px-3 py-1 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
            <span className="mm-mono text-[9px] tracking-[0.28em] text-amber-300/75">▤ LAYERS</span>
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 mm-mono text-[9px] tracking-[0.2em] ${isLive ? 'text-emerald-300/80' : 'text-white/30'}`}>
                <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-emerald-400 mm-led-pulse' : 'bg-white/25'}`} />
                {isLive ? t.live : t.simShort}
              </span>
              <button
                type="button"
                onClick={() => setDesktopOpen(false)}
                aria-label="collapse layers panel"
                className="text-white/55 hover:text-amber-200 hover:bg-white/5 text-[18px] mm-mono
                           w-6 h-6 flex items-center justify-center leading-none transition
                           border border-white/10 hover:border-amber-300/40 rounded-sm"
              >
                ×
              </button>
            </div>
          </div>

          {/* TRANSIT / CITY pages — same segment styling as the BUS mode
              switch below, so the panel reads as one control vocabulary. */}
          <div role="tablist" className="grid grid-cols-2 border-b border-white/8">
            {LAYERS_TABS.map(tab => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={layersTab === tab}
                onClick={() => setLayersTab(tab)}
                className={`px-1 py-[5px] mm-mono text-[9px] tracking-[0.15em] transition-colors text-center
                           ${layersTab === tab
                             ? 'bg-amber-300/10 text-amber-200'
                             : 'text-white/45 hover:text-white hover:bg-white/5'}
                           ${tab === 'city' ? 'border-l border-white/8' : ''}`}
                style={layersTab === tab ? { boxShadow: 'inset 0 -2px 0 rgba(252,196,65,0.7)' } : undefined}
              >
                {tab === 'transit' ? 'TRANSIT · 交通' : 'CITY · 城市'}
              </button>
            ))}
          </div>

          {layersTab === 'transit' && (<>
          {/* LRT — clickable rows */}
          <div>
            <div className="px-3 py-1 flex items-center justify-between bg-white/[0.015] border-b border-white/5">
              <span className="flex items-center gap-1.5 text-white/45">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                  <rect x="4" y="3" width="16" height="14" rx="2" />
                  <path d="M4 11h16" /><path d="M12 3v8" />
                  <path d="M8 21l2-4h4l2 4" />
                </svg>
                <span
                  className="inline-block w-[8px] h-[8px]"
                  style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(252,196,65,0.35) 0 1px, transparent 1px 3px)' }}
                />
                <span className="mm-mono text-[8px] tracking-[0.25em]">LRT · 輕軌</span>
              </span>
              <span className="mm-mono mm-tabular text-[8px] text-white/30">
                {lrtActive}<span className="text-white/20">/{lrtTotal}</span>
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
                    className={`w-full flex items-center gap-2 px-2.5 py-1 border-l-2 transition
                               ${on
                                 ? 'border-amber-300/60 bg-amber-300/[0.04] hover:bg-amber-300/[0.08]'
                                 : 'border-transparent hover:bg-white/[0.03] opacity-40'}
                               ${onToggleLrt ? '' : 'cursor-default'}`}
                  >
                    <div className="w-3 h-[3px] shrink-0" style={{ backgroundColor: on ? line.color : '#555' }} />
                    <span className={`mm-han text-[11px] flex-1 text-left truncate
                                      ${on ? 'text-white/90' : 'text-white/40'}`}>
                      {localName(lang, line)}
                    </span>
                    <span className={`mm-mono text-[8px] tracking-[0.2em] shrink-0
                                      ${on ? 'text-emerald-300/80' : 'text-white/25'}`}>
                      {on ? 'ON' : 'OFF'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* BUS section with mode tabs + collapsible groups */}
          {totalRoutes > 0 && visibleRoutes && (
            <div className="border-t border-white/10">
              <div className="px-3 py-1 flex items-center justify-between bg-white/[0.015]">
                <span className="flex items-center gap-1.5 text-white/45">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                    <path d="M8 6v6" /><path d="M16 6v6" />
                    <path d="M2 12h20" />
                    <rect x="2" y="4" width="20" height="14" rx="3" />
                    <circle cx="7" cy="20" r="1" /><circle cx="17" cy="20" r="1" />
                  </svg>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(110,231,183,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[8px] tracking-[0.25em]">BUS · 巴士</span>
                </span>
                <span className="mm-mono mm-tabular text-[9px] text-emerald-300/80">
                  {activeRoutes}<span className="text-white/30">/{totalRoutes}</span>
                </span>
              </div>
              <div className="grid grid-cols-3 border-y border-white/8">
                <button
                  onClick={onResetAuto}
                  className={`px-1 py-1 mm-mono text-[9px] tracking-[0.1em] transition-colors text-center
                             ${isAutoMode
                               ? 'bg-amber-300/10 text-amber-200'
                               : 'text-white/45 hover:text-white hover:bg-white/5'}`}
                  style={isAutoMode ? { boxShadow: 'inset 0 -2px 0 rgba(252,196,65,0.7)' } : undefined}
                >
                  {t.autoByTime}
                </button>
                <button
                  onClick={onShowAll}
                  className="px-1 py-1 mm-mono text-[9px] tracking-[0.15em] text-white/45 hover:text-white
                             hover:bg-white/5 transition-colors text-center border-l border-white/8"
                >
                  {t.showAll}
                </button>
                <button
                  onClick={onHideAll}
                  className="px-1 py-1 mm-mono text-[9px] tracking-[0.15em] text-white/45 hover:text-white
                             hover:bg-white/5 transition-colors text-center border-l border-white/8"
                >
                  {t.hideAll}
                </button>
              </div>
              <div className="max-h-[45vh] overflow-y-auto">
                {GROUP_ORDER.map(groupKey => {
                  const routes = grouped.get(groupKey) || []
                  if (routes.length === 0) return null
                  const groupActive = routes.filter(r => visibleRoutes.has(r.id)).length
                  const eligibleInGroup = routes.filter(r => !(inactiveRoutes?.has(r.id) ?? false))
                  const groupOn = groupActive > 0
                  const collapsed = collapsedGroups.has(groupKey)
                  return (
                    <div key={groupKey} className="border-t border-white/5">
                      <div className="w-full flex items-stretch bg-white/[0.015]">
                        <button
                          type="button"
                          onClick={() => toggleGroupCollapse(groupKey)}
                          className="flex-1 min-w-0 px-2 py-1 flex items-center gap-2
                                     hover:bg-white/[0.04] transition"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0
                                            ${groupActive > 0 ? 'bg-amber-300' : 'bg-white/15'}`}
                                style={groupActive > 0 ? { boxShadow: '0 0 5px rgba(252,196,65,0.8)' } : undefined} />
                          <span className="mm-mono text-[9px] tracking-[0.2em] text-white/55 uppercase flex-1 text-left">
                            {t[GROUP_LABEL_KEYS[groupKey]]}
                          </span>
                          <span className="mm-mono mm-tabular text-[9px] text-white/35 w-10 text-right">
                            {groupActive}/{routes.length}
                          </span>
                          <span className="text-white/30 mm-mono text-[8px] w-3 text-center">
                            {collapsed ? '▸' : '▾'}
                          </span>
                        </button>
                        {onToggleGroup && eligibleInGroup.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onToggleGroup(groupKey)}
                            aria-pressed={groupOn}
                            className={`shrink-0 w-10 mm-mono text-[8px] tracking-[0.2em]
                                        border-l border-white/8 transition text-center
                                        ${groupOn
                                          ? 'text-emerald-300/80 hover:bg-emerald-300/10'
                                          : 'text-white/30 hover:text-white/80 hover:bg-white/[0.05]'}`}
                          >
                            {groupOn ? 'ON' : 'OFF'}
                          </button>
                        )}
                      </div>
                      {!collapsed && (
                        <div className="bg-[#060607]">
                          {routes.map(route => {
                            const inactive = inactiveRoutes?.has(route.id) ?? false
                            const on = visibleRoutes.has(route.id)
                            return (
                              <button
                                key={route.id}
                                onClick={() => !inactive && onToggleRoute?.(route.id)}
                                disabled={inactive}
                                title={inactive ? t.noServiceToday : undefined}
                                className={`w-full px-2 py-[3px] flex items-center gap-2 transition-colors
                                           ${inactive
                                             ? 'opacity-30 cursor-not-allowed'
                                             : on ? 'hover:bg-white/[0.04]' : 'opacity-35 hover:opacity-60'}`}
                              >
                                <span
                                  className="mm-mono mm-tabular text-[10px] font-bold text-center shrink-0"
                                  style={{
                                    width: 36,
                                    color: inactive ? '#444' : on ? route.color : '#555',
                                    textShadow: !inactive && on ? `0 0 6px ${route.color}66` : 'none',
                                    textDecoration: inactive ? 'line-through' : 'none',
                                  }}
                                >
                                  {route.name}
                                </span>
                                <span className={`text-[10px] flex-1 text-left truncate mm-han
                                                  ${inactive ? 'text-white/25' : on ? 'text-white/75' : 'text-white/30'}`}>
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
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${flightsOn
                           ? 'bg-sky-400/[0.04] hover:bg-sky-400/[0.08]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleFlights ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${flightsOn ? 'text-white/45' : 'text-white/40'}`}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 2L11 13" />
                  <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(125,211,252,0.35) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                AIR · 航班
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${flightsOn ? 'text-sky-300/80' : 'text-white/25'}`}>
                {flightCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${flightsOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
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
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${ferriesOn
                           ? 'bg-red-400/[0.05] hover:bg-red-400/[0.1]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleFerries ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${ferriesOn ? 'text-white/45' : 'text-white/40'}`}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="5" r="3" />
                  <path d="M12 22V8" />
                  <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
                </svg>
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(248,113,113,0.35) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                SEA · 船運
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${ferriesOn ? 'text-red-300/80' : 'text-white/25'}`}>
                {ferryCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${ferriesOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {ferriesOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}
          </>)}

          {layersTab === 'city' && (<>
          {/* ROAD WORKS — toggleable */}
          {totalRoadWorkCount > 0 && (
            <button
              type="button"
              onClick={onToggleRoadWorks}
              disabled={!onToggleRoadWorks}
              aria-pressed={roadWorksOn}
              title={t.roadWorksActive(activeRoadWorksCount)}
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${roadWorksOn
                           ? 'bg-amber-400/[0.05] hover:bg-amber-400/[0.1]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleRoadWorks ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex justify-center text-[10px] leading-none w-[12px] shrink-0 ${roadWorksOn ? 'text-white/45' : 'text-white/40'}`}>{'⚠︎'}</span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(245,158,11,0.45) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                WORKS · 工程
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${roadWorksOn ? 'text-amber-300/80' : 'text-white/25'}`}>
                {activeRoadWorksCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${roadWorksOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {roadWorksOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* SCHOOLS — the row keeps the five columns of AIR/SEA/WORKS above
              it (glyph · swatch · label · count · state) and adds the bus
              groups' split interaction: the body expands the per-level rows,
              the ON/OFF button at the right is the whole-layer switch. No
              chevron — the rows below are the affordance. */}
          {schoolCount > 0 && (
            <>
              <div className={`flex items-stretch border-t border-white/10 transition
                              ${schoolsOn ? 'bg-violet-400/[0.05]' : 'opacity-50'}`}>
                <button
                  type="button"
                  onClick={() => setSchoolsLegendOpen(v => !v)}
                  aria-expanded={schoolsLegendOpen}
                  title={t.schoolsExpandTitle}
                  className="flex-1 min-w-0 flex items-center gap-2 py-1.5 pl-3 pr-1.5
                             hover:bg-violet-400/[0.1] transition"
                >
                  <span className={`inline-flex items-center justify-center w-[12px] shrink-0
                                    ${schoolsOn ? 'text-white/45' : 'text-white/40'}`}>
                    <MortarboardIcon />
                  </span>
                  <span
                    className="inline-block w-[8px] h-[8px] shrink-0"
                    style={{ backgroundImage: SCHOOL_HATCH }}
                  />
                  <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45
                                   flex-1 min-w-0 text-left truncate">
                    SCHOOLS · 學校
                  </span>
                  <span className={`mm-mono mm-tabular text-[9px] shrink-0
                                    ${schoolsOn ? 'text-violet-300/80' : 'text-white/25'}`}>
                    {schoolLevelsAllOn ? schoolCount : `${schoolEnabledCount}/${schoolCount}`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onToggleSchools}
                  disabled={!onToggleSchools}
                  aria-pressed={schoolsOn}
                  title={t.schoolsToggleAllTitle}
                  className={`shrink-0 inline-flex items-center justify-end pl-1.5 pr-3
                              hover:bg-emerald-300/[0.1] transition
                              ${onToggleSchools ? '' : 'cursor-default'}`}
                >
                  <span className={`mm-mono text-[8px] tracking-[0.2em] ${schoolsOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                    {schoolsOn ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
              {schoolsLegendOpen && (
                <div className={`pb-1 bg-violet-400/[0.05] ${schoolsOn ? '' : 'opacity-40'}`}>
                  {SCHOOL_LEVEL_ORDER.map(level => {
                    const on = isSchoolLevelOn(level)
                    // "Lit" = actually drawn on the map: the level is on AND
                    // the master switch is on.
                    const lit = schoolsOn && on
                    const color = SCHOOL_COLORS[level]
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
                        className={`w-full flex items-center gap-2 py-1 pl-8 pr-3
                                    hover:bg-white/[0.04] transition
                                    ${onToggleSchoolLevel ? '' : 'cursor-default'}`}
                      >
                        <span
                          className="inline-block w-[7px] h-[7px] shrink-0"
                          style={on
                            ? { backgroundColor: color }
                            : { boxShadow: `inset 0 0 0 1px ${color}99` }}
                        />
                        <span className={`text-[10px] leading-[1.2] flex-1 min-w-0 text-left truncate
                                          ${on ? 'text-white/75' : 'text-white/30'}`}>
                          {schoolLevelLabel(t, level)}
                        </span>
                        <span className="mm-mono text-[7px] tracking-[0.18em] text-white/25 shrink-0">
                          {SCHOOL_LEVEL_CAPTIONS[level]}
                        </span>
                        <span
                          className={`mm-mono mm-tabular text-[9px] w-[18px] text-right shrink-0
                                      ${lit ? '' : 'text-white/25'}`}
                          style={lit ? { color } : undefined}
                        >
                          {levelCounts[level] ?? 0}
                        </span>
                        <span className={`mm-mono text-[8px] tracking-[0.2em] w-[20px] text-right shrink-0
                                          ${lit ? 'text-emerald-300/80' : 'text-white/25'}`}>
                          {on ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* PUBLIC TOILETS — toggleable, same five columns as AIR/SEA/WORKS.
              No collapsible body: the layer has no sub-filters, and the three
              marker variants are explained by the info panel, not a key. */}
          {toiletCount > 0 && (
            <button
              type="button"
              onClick={onToggleToilets}
              disabled={!onToggleToilets}
              aria-pressed={toiletsOn}
              title={t.toiletsCount(toiletCount)}
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${toiletsOn
                           ? 'bg-teal-400/[0.05] hover:bg-teal-400/[0.1]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleToilets ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${toiletsOn ? 'text-white/45' : 'text-white/40'}`}>
                <ToiletIcon />
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: TOILET_HATCH }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                WC · 公廁
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${toiletsOn ? 'text-teal-300/80' : 'text-white/25'}`}>
                {toiletCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${toiletsOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {toiletsOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* PUBLIC CAR PARKS — same five columns as WC above it. Switching
              this on is also what starts the live-vacancy polling (only while
              the clock runs at 1× — see useCarParkVacancy). */}
          {carParkCount > 0 && (
            <button
              type="button"
              onClick={onToggleCarParks}
              disabled={!onToggleCarParks}
              aria-pressed={carParksOn}
              title={t.carParksCount(carParkCount)}
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${carParksOn
                           ? 'bg-blue-400/[0.05] hover:bg-blue-400/[0.1]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleCarParks ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${carParksOn ? 'text-white/45' : 'text-white/40'}`}>
                <CarParkIcon />
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: CAR_PARK_HATCH }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                PARKING · 停車場
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${carParksOn ? 'text-blue-300/80' : 'text-white/25'}`}>
                {carParkCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${carParksOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {carParksOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* WASTE & RECYCLING — a FOCUS mode like WATER and POWER below it
              (switching it on clears every other layer, switching it off puts
              them back), drawn with the SCHOOLS split interaction because it is
              the one focus layer with sub-filters: the body expands the six type
              rows, the ON/OFF button at the right is the whole-layer switch.
              Same five columns as PARKING above it, and the same 6 px + 6 px
              split so the count→ON gap stays 12 px like every other row. */}
          {wasteTotal > 0 && (
            <>
              <div className={`flex items-stretch border-t border-white/10 transition
                              ${wasteOn ? 'bg-green-400/[0.05]' : 'opacity-50'}`}>
                <button
                  type="button"
                  onClick={() => setWasteLegendOpen(v => !v)}
                  aria-expanded={wasteLegendOpen}
                  title={`${t.wasteExpandTitle} · ${t.wasteFocusNote}`}
                  className="flex-1 min-w-0 flex items-center gap-2 py-1.5 pl-3 pr-1.5
                             hover:bg-green-400/[0.1] transition"
                >
                  <span className={`inline-flex items-center justify-center w-[12px] shrink-0
                                    ${wasteOn ? 'text-white/45' : 'text-white/40'}`}>
                    <WasteIcon />
                  </span>
                  <span
                    className="inline-block w-[8px] h-[8px] shrink-0"
                    style={{ backgroundImage: WASTE_HATCH }}
                  />
                  <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45
                                   flex-1 min-w-0 text-left truncate">
                    WASTE · 垃圾回收
                  </span>
                  <span className={`mm-mono mm-tabular text-[9px] shrink-0
                                    ${wasteOn ? 'text-green-300/80' : 'text-white/25'}`}>
                    {wasteTypesAllOn ? wasteTotal : `${wasteVisibleCount}/${wasteTotal}`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onToggleWaste}
                  disabled={!onToggleWaste}
                  aria-pressed={wasteOn}
                  title={`${t.wasteCount(wasteVisibleCount)} · ${t.wasteFocusNote}`}
                  className={`shrink-0 inline-flex items-center justify-end pl-1.5 pr-3
                              hover:bg-emerald-300/[0.1] transition
                              ${onToggleWaste ? '' : 'cursor-default'}`}
                >
                  <span className={`mm-mono text-[8px] tracking-[0.2em] ${wasteOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                    {wasteOn ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
              {/* The key, only while the layer is on — it explains marks that
                  are on screen, so it has nothing to say when they are not. */}
              {wasteOn && wasteLegendOpen && (
                <div className="pb-1 bg-green-400/[0.05]">
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
                      className={`w-full flex items-center gap-2 py-1 pl-8 pr-3
                                  hover:bg-white/[0.04] transition
                                  ${onToggleWasteType ? '' : 'cursor-default'}`}
                    >
                      <span
                        className="inline-block w-[7px] h-[7px] shrink-0"
                        style={row.on
                          ? { backgroundColor: row.color }
                          : { boxShadow: `inset 0 0 0 1px ${row.color}99` }}
                      />
                      <span className={`text-[10px] leading-[1.2] flex-1 min-w-0 text-left truncate
                                        ${row.on ? 'text-white/75' : 'text-white/30'}`}>
                        {row.label}
                      </span>
                      <span
                        className={`mm-mono mm-tabular text-[9px] w-[26px] text-right shrink-0
                                    ${row.on ? '' : 'text-white/25'}`}
                        style={row.on ? { color: row.color } : undefined}
                      >
                        {row.count}
                      </span>
                      <span className={`mm-mono text-[8px] tracking-[0.2em] w-[20px] text-right shrink-0
                                        ${row.on ? 'text-emerald-300/80' : 'text-white/25'}`}>
                        {row.on ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  ))}
                  <div className="pl-8 pr-3 pt-[2px] mm-mono text-[7px] tracking-[0.18em] text-white/30 uppercase">
                    {t.wasteTypesHint}
                  </div>
                  <div className="pl-8 pr-3 mm-mono text-[7px] tracking-[0.18em] text-white/30 uppercase">
                    {t.wasteFocusNote}
                  </div>
                </div>
              )}
            </>
          )}

          {/* MACAO WATER — same five columns as P above it. Unlike its
              neighbours this is a focus mode: switching it on clears every
              other layer (App snapshots them first) so the supply network is
              read against an empty city, and switching it off restores them. */}
          {waterCount > 0 && (
            <button
              type="button"
              onClick={onToggleWater}
              disabled={!onToggleWater}
              aria-pressed={waterOn}
              // The hover text carries the disclaimer the map itself cannot:
              // the pipes are our schematic, not Macao Water's real mains.
              title={`${t.waterCount(waterCount)} · ${t.waterNetworkNote}`}
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${waterOn
                           ? 'bg-sky-400/[0.05] hover:bg-sky-400/[0.1]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleWater ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${waterOn ? 'text-white/45' : 'text-white/40'}`}>
                <WaterIcon />
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: WATER_HATCH }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                WATER · 供水
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${waterOn ? 'text-sky-300/80' : 'text-white/25'}`}>
                {waterCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${waterOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {waterOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}
          {/* The key, only while the layer is on — it explains marks that are
              on screen, so it has nothing to say when they are not. */}
          {waterCount > 0 && waterOn && (
            <WaterKey network={waterNetwork} caption={t.waterNetworkNote} />
          )}

          {/* CEM ELECTRICITY — same five columns as WATER above it, and the
              same focus-mode behaviour. The two are mutually exclusive:
              switching this on takes WATER off and restores what WATER was
              hiding, then hides it all again for POWER. */}
          {powerCount > 0 && (
            <button
              type="button"
              onClick={onTogglePower}
              disabled={!onTogglePower}
              aria-pressed={powerOn}
              // The hover text carries the disclaimer the map itself cannot:
              // the HV lines are our schematic, not CEM's cable routes.
              title={`${t.powerCount(powerCount)} · ${t.powerNetworkNote}`}
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${powerOn
                           ? 'bg-amber-400/[0.05] hover:bg-amber-400/[0.1]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onTogglePower ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${powerOn ? 'text-white/45' : 'text-white/40'}`}>
                <PowerIcon />
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: POWER_HATCH }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                POWER · 電力
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${powerOn ? 'text-amber-300/80' : 'text-white/25'}`}>
                {powerCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${powerOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {powerOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}
          {powerCount > 0 && powerOn && (
            <PowerKey network={powerNetwork} caption={t.powerNetworkNote} />
          )}
          </>)}
        </div>
      )}

      {/* Mobile: 4-icon stack — LRT / BUS / AIR / SEA, below MapLibre +/- zoom
          controls. Uses top-[8rem] (visual ~154px) so it sits just under the
          MapLibre nav control (bottom ~141px visual) without overlap, and
          still leaves enough room above the bottom timeline for popovers on
          short viewports. */}
      <div className="mm-mode-stack mm-ui-scale absolute top-[8rem] right-[0.5rem] z-10 flex flex-col gap-1.5
                      sm:hidden">
        {/* LRT chip */}
        <button
          onClick={() => togglePanel('lrt')}
          aria-label={t.lrtLines}
          className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                     border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                     ${mobilePanel === 'lrt'
                       ? 'border-amber-300/60 text-amber-200'
                       : lrtActive > 0
                         ? 'border-amber-300/25 text-amber-200/80 hover:border-amber-300/50 active:scale-95'
                         : 'border-white/10 text-white/40 hover:border-white/25'}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="3" width="16" height="14" rx="2" />
            <path d="M4 11h16" />
            <path d="M12 3v8" />
            <path d="M8 21l2-4h4l2 4" />
          </svg>
        </button>

        {/* BUS chip */}
        <button
          onClick={() => togglePanel('bus')}
          aria-label={t.busRoutes}
          className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                     border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                     ${mobilePanel === 'bus'
                       ? 'border-emerald-300/60 text-emerald-200'
                       : 'border-emerald-300/25 text-emerald-200/80 hover:border-emerald-300/50 active:scale-95'}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 6v6" />
            <path d="M16 6v6" />
            <path d="M2 12h20" />
            <rect x="2" y="4" width="20" height="14" rx="3" />
            <circle cx="7" cy="20" r="1" />
            <circle cx="17" cy="20" r="1" />
          </svg>
        </button>

        {/* AIR chip */}
        {totalFlightCount > 0 && (
          <button
            onClick={() => togglePanel('air')}
            aria-label={t.flights}
            className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                       border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                       ${mobilePanel === 'air'
                         ? 'border-sky-300/60 text-sky-300'
                         : flightsOn
                           ? 'border-sky-300/25 text-sky-300/80 hover:border-sky-300/50 active:scale-95'
                           : 'border-white/10 text-white/40 hover:border-white/25'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
            </svg>
          </button>
        )}

        {/* SEA chip */}
        {totalFerryCount > 0 && (
          <button
            onClick={() => togglePanel('sea')}
            aria-label={t.ferries}
            className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                       border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                       ${mobilePanel === 'sea'
                         ? 'border-red-400/60 text-red-300'
                         : ferriesOn
                           ? 'border-red-400/25 text-red-300/80 hover:border-red-400/50 active:scale-95'
                           : 'border-white/10 text-white/40 hover:border-white/25'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="5" r="3" />
              <line x1="12" y1="22" x2="12" y2="8" />
              <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
            </svg>
          </button>
        )}

        {/* CITY chip — WORKS / SCHOOLS / WC / P live behind one chip (the
            desktop panel's CITY page); a hairline separates it from the
            transit chips above. Lit while any city layer is on. */}
        {cityLayerTotal > 0 && (
          <>
            <div className="self-center w-[22px] h-px my-[3px] bg-white/[0.18]" aria-hidden="true" />
            <button
              onClick={() => togglePanel('city')}
              aria-label={t.cityLayers}
              className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                         border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                         ${mobilePanel === 'city'
                           ? 'border-white/60 text-white'
                           : cityLayerOn > 0
                             ? 'border-white/25 text-white/80 hover:border-white/50 active:scale-95'
                             : 'border-white/10 text-white/40 hover:border-white/25'}`}
            >
              <CityIcon />
            </button>
          </>
        )}
      </div>

      {/* Mobile centered modal for LRT/BUS/AIR/SEA. Rendered OUTSIDE the
          mm-ui-scale chip stack so CSS `zoom` on that ancestor doesn't
          trap `fixed` descendants — the modal must anchor to the viewport
          to dodge the MapLibre nav control (top-right) and the bottom
          timeline/speed bar simultaneously. The backdrop button closes
          on outside tap; stopPropagation on the panel keeps taps inside
          from bubbling up. */}
      {mobilePanel !== null && (
        <div className="sm:hidden fixed inset-0 z-40 flex items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setMobilePanel(null)}
            aria-label="close"
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />

          {/* LRT */}
          {mobilePanel === 'lrt' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[320px] max-h-[80dvh] bg-[#0b0b0c]
                         border border-amber-300/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)] flex flex-col"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber-300/80">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <rect x="4" y="3" width="16" height="14" rx="2" />
                    <path d="M4 11h16" /><path d="M12 3v8" />
                    <path d="M8 21l2-4h4l2 4" />
                  </svg>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(252,196,65,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">LRT · 輕軌</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">{lrtActive}/{lrtTotal}</span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0">
                {allLrtLines.map(line => {
                  const on = isLrtOn(line.id)
                  return (
                    <button
                      key={line.id}
                      type="button"
                      onClick={() => onToggleLrt?.(line.id)}
                      aria-pressed={on}
                      className={`w-full flex items-center gap-2 px-3 py-2 border-l-2 transition
                                 ${on
                                   ? 'border-amber-300/60 bg-amber-300/[0.04] active:bg-amber-300/[0.08]'
                                   : 'border-transparent active:bg-white/[0.04] opacity-40'}`}
                    >
                      <div className="w-3 h-[3px] shrink-0" style={{ backgroundColor: on ? line.color : '#555' }} />
                      <span className={`mm-han text-[12px] flex-1 text-left truncate
                                        ${on ? 'text-white/90' : 'text-white/40'}`}>
                        {localName(lang, line)}
                      </span>
                      <span className={`mm-mono text-[9px] tracking-[0.2em] shrink-0
                                        ${on ? 'text-emerald-300/80' : 'text-white/25'}`}>
                        {on ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* BUS */}
          {mobilePanel === 'bus' && visibleRoutes && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[340px] max-h-[80dvh] bg-[#0b0b0c]
                         border border-emerald-300/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)] flex flex-col"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-emerald-300/80">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M8 6v6" /><path d="M16 6v6" />
                    <path d="M2 12h20" />
                    <rect x="2" y="4" width="20" height="14" rx="3" />
                    <circle cx="7" cy="20" r="1" /><circle cx="17" cy="20" r="1" />
                  </svg>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(110,231,183,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">BUS · 巴士</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-emerald-300/80">
                    {visibleRoutes.size}<span className="text-white/30">/{busRoutes.length}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <div className="grid grid-cols-3 border-b border-white/8 shrink-0">
                <button
                  onClick={onResetAuto}
                  className={`px-1 py-1.5 mm-mono text-[10px] tracking-[0.1em] transition-colors text-center
                             ${isAutoMode
                               ? 'bg-emerald-300/10 text-emerald-200'
                               : 'text-white/45 active:text-white active:bg-white/5'}`}
                  style={isAutoMode ? { boxShadow: 'inset 0 -2px 0 rgba(110,231,183,0.7)' } : undefined}
                >
                  {t.autoByTime}
                </button>
                <button
                  onClick={onShowAll}
                  className="px-1 py-1.5 mm-mono text-[10px] tracking-[0.15em] text-white/45 active:text-white
                             active:bg-white/5 transition-colors text-center border-l border-white/8"
                >
                  {t.showAll}
                </button>
                <button
                  onClick={onHideAll}
                  className="px-1 py-1.5 mm-mono text-[10px] tracking-[0.15em] text-white/45 active:text-white
                             active:bg-white/5 transition-colors text-center border-l border-white/8"
                >
                  {t.hideAll}
                </button>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0">
                {GROUP_ORDER.map(groupKey => {
                  const routes = grouped.get(groupKey) || []
                  if (routes.length === 0) return null
                  const groupActive = routes.filter(r => visibleRoutes.has(r.id)).length
                  const eligibleInGroup = routes.filter(r => !(inactiveRoutes?.has(r.id) ?? false))
                  const groupOn = groupActive > 0
                  const collapsed = collapsedGroups.has(groupKey)
                  return (
                    <div key={groupKey} className="border-t border-white/5">
                      <div className="w-full flex items-stretch bg-white/[0.015]">
                        <button
                          type="button"
                          onClick={() => toggleGroupCollapse(groupKey)}
                          className="flex-1 min-w-0 px-2 py-1.5 flex items-center gap-2
                                     active:bg-white/[0.04] transition"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0
                                            ${groupActive > 0 ? 'bg-emerald-300' : 'bg-white/15'}`} />
                          <span className="mm-mono text-[10px] tracking-[0.2em] text-white/55 uppercase flex-1 text-left">
                            {t[GROUP_LABEL_KEYS[groupKey]]}
                          </span>
                          <span className="mm-mono mm-tabular text-[10px] text-white/35 w-10 text-right">
                            {groupActive}/{routes.length}
                          </span>
                          <span className="text-white/30 mm-mono text-[9px] w-3 text-center">
                            {collapsed ? '▸' : '▾'}
                          </span>
                        </button>
                        {onToggleGroup && eligibleInGroup.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onToggleGroup(groupKey)}
                            aria-pressed={groupOn}
                            className={`shrink-0 w-11 mm-mono text-[9px] tracking-[0.2em]
                                        border-l border-white/8 transition text-center
                                        ${groupOn
                                          ? 'text-emerald-300/80 active:bg-emerald-300/10'
                                          : 'text-white/30 active:bg-white/[0.05]'}`}
                          >
                            {groupOn ? 'ON' : 'OFF'}
                          </button>
                        )}
                      </div>
                      {!collapsed && (
                      <div className="bg-[#060607]">
                        {routes.map(route => {
                          const inactive = inactiveRoutes?.has(route.id) ?? false
                          const on = visibleRoutes.has(route.id)
                          return (
                            <button
                              key={route.id}
                              onClick={() => !inactive && onToggleRoute?.(route.id)}
                              disabled={inactive}
                              className={`w-full px-2 py-1 flex items-center gap-2 transition-colors
                                         ${inactive
                                           ? 'opacity-30 cursor-not-allowed'
                                           : on ? 'active:bg-white/[0.04]' : 'opacity-35'}`}
                            >
                              <span
                                className="mm-mono mm-tabular text-[11px] font-bold text-center shrink-0"
                                style={{
                                  width: 36,
                                  color: inactive ? '#444' : on ? route.color : '#555',
                                  textShadow: !inactive && on ? `0 0 6px ${route.color}66` : 'none',
                                  textDecoration: inactive ? 'line-through' : 'none',
                                }}
                              >
                                {route.name}
                              </span>
                              <span className={`text-[11px] flex-1 text-left truncate mm-han
                                                ${inactive ? 'text-white/25' : on ? 'text-white/75' : 'text-white/30'}`}>
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

          {/* AIR */}
          {mobilePanel === 'air' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-sky-300/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sky-300/80">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                  </svg>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(125,211,252,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">AIR · 航班</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {flightsOn ? flightCount : 0}/{totalFlightCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleFlights}
                disabled={!onToggleFlights}
                aria-pressed={flightsOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${flightsOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleFlights ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={flightsOn ? 'text-sky-300' : 'text-white/40'}>✈</span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {flightCount} {t.flights}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${flightsOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {flightsOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}

          {/* SEA */}
          {mobilePanel === 'sea' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-red-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-red-300/85">
                  <span className="text-[12px] leading-none">{'\u2693\uFE0E'}</span>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(248,113,113,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">SEA · 船運</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {ferriesOn ? ferryCount : 0}/{totalFerryCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleFerries}
                disabled={!onToggleFerries}
                aria-pressed={ferriesOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${ferriesOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleFerries ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={ferriesOn ? 'text-red-400' : 'text-white/40'}>{'\u2693\uFE0E'}</span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {ferryCount} {t.ferries}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${ferriesOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {ferriesOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}

          {/* CITY — one list for the city overlays. The name opens that
              layer's own modal (schools keep their per-level rows there);
              the count + ON/OFF at the right toggles it in place. */}
          {mobilePanel === 'city' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-white/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-white/85">
                  <CityIcon size={12} />
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: CITY_HATCH }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">CITY · 城市</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {cityLayerOn}/{cityLayerTotal}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              {cityLayerRows.map((row, i) => (
                <div
                  key={row.panel}
                  className={`flex items-stretch ${i > 0 ? 'border-t border-white/[0.06]' : ''} ${row.on ? '' : 'opacity-60'}`}
                >
                  <button
                    type="button"
                    onClick={() => setMobilePanel(row.panel)}
                    className="flex-1 min-w-0 px-3 py-3 flex items-center gap-2 text-left active:bg-white/[0.04]"
                  >
                    <span className={`inline-flex w-4 justify-center shrink-0 ${row.on ? row.iconOn : 'text-white/40'}`}>
                      {row.icon}
                    </span>
                    <span className="mm-mono text-[10px] tracking-[0.2em] text-white/80 truncate">{row.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={row.toggle}
                    disabled={!row.toggle}
                    aria-pressed={row.on}
                    className={`shrink-0 pl-3 pr-3 flex items-center gap-3.5 active:bg-white/[0.04] ${row.toggle ? '' : 'cursor-default'}`}
                  >
                    <span className={`mm-mono mm-tabular text-[12px] ${row.on ? row.countOn : 'text-white/35'}`}>{row.count}</span>
                    <span className={`mm-mono text-[10px] tracking-[0.2em] w-[26px] text-right ${row.on ? 'text-emerald-300' : 'text-white/25'}`}>
                      {row.on ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ROAD WORKS */}
          {mobilePanel === 'works' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-amber-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber-300/85">
                  <span className="text-[12px] leading-none">{'⚠︎'}</span>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(245,158,11,0.45) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">WORKS · 工程</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {roadWorksOn ? activeRoadWorksCount : 0}/{totalRoadWorkCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleRoadWorks}
                disabled={!onToggleRoadWorks}
                aria-pressed={roadWorksOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${roadWorksOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleRoadWorks ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={roadWorksOn ? 'text-amber-400' : 'text-white/40'}>{'⚠︎'}</span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.roadWorksActive(activeRoadWorksCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${roadWorksOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {roadWorksOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}

          {/* SCHOOLS */}
          {mobilePanel === 'schools' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-violet-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-violet-300/85">
                  <MortarboardIcon />
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: SCHOOL_SWATCH_GRADIENT }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">SCHOOLS · 學校</span>
                </span>
                <button
                  type="button"
                  onClick={() => setMobilePanel(null)}
                  aria-label="close"
                  className="w-6 h-6 flex items-center justify-center leading-none
                             border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                >×</button>
              </div>
              <button
                type="button"
                onClick={onToggleSchools}
                disabled={!onToggleSchools}
                aria-pressed={schoolsOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${schoolsOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleSchools ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`inline-flex items-center ${schoolsOn ? 'text-violet-400' : 'text-white/40'}`}>
                    <MortarboardIcon />
                  </span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.schoolsCount(schoolEnabledCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${schoolsOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {schoolsOn ? 'ON' : 'OFF'}
                </span>
              </button>
              {/* Per-level rows — same handlers as the desktop panel, at a
                  44px tap target. No chevron: the modal is always expanded. */}
              <div className={`pb-1 border-t border-white/10 ${schoolsOn ? '' : 'opacity-40'}`}>
                {SCHOOL_LEVEL_ORDER.map(level => {
                  const on = isSchoolLevelOn(level)
                  const lit = schoolsOn && on
                  const color = SCHOOL_COLORS[level]
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => onToggleSchoolLevel?.(level)}
                      disabled={!onToggleSchoolLevel}
                      aria-pressed={on}
                      title={schoolLevelLabel(t, level)}
                      className={`w-full h-11 flex items-center gap-2 px-3 active:bg-white/[0.04] transition
                                  ${onToggleSchoolLevel ? '' : 'cursor-default'}`}
                    >
                      <span
                        className="inline-block w-[9px] h-[9px] shrink-0"
                        style={on
                          ? { backgroundColor: color }
                          : { boxShadow: `inset 0 0 0 1px ${color}99` }}
                      />
                      <span className={`text-[12px] leading-[1.2] flex-1 min-w-0 text-left truncate
                                        ${on ? 'text-white/75' : 'text-white/30'}`}>
                        {schoolLevelLabel(t, level)}
                      </span>
                      <span
                        className={`mm-mono mm-tabular text-[11px] w-6 text-right shrink-0
                                    ${lit ? '' : 'text-white/25'}`}
                        style={lit ? { color } : undefined}
                      >
                        {levelCounts[level] ?? 0}
                      </span>
                      <span className={`mm-mono text-[10px] tracking-[0.2em] w-8 text-right shrink-0
                                        ${lit ? 'text-emerald-300' : 'text-white/25'}`}>
                        {on ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* TOILETS */}
          {mobilePanel === 'toilets' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-teal-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-teal-300/85">
                  <ToiletIcon />
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: TOILET_HATCH }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">WC · 公廁</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {toiletsOn ? toiletCount : 0}/{toiletCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleToilets}
                disabled={!onToggleToilets}
                aria-pressed={toiletsOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${toiletsOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleToilets ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={toiletsOn ? 'text-teal-400' : 'text-white/40'}>
                    <ToiletIcon />
                  </span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.toiletsCount(toiletCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${toiletsOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {toiletsOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}

          {/* CAR PARKS */}
          {mobilePanel === 'carparks' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-blue-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-blue-300/85">
                  <CarParkIcon />
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: CAR_PARK_HATCH }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">PARKING · 停車場</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {carParksOn ? carParkCount : 0}/{carParkCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleCarParks}
                disabled={!onToggleCarParks}
                aria-pressed={carParksOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${carParksOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleCarParks ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={carParksOn ? 'text-blue-400' : 'text-white/40'}>
                    <CarParkIcon />
                  </span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.carParksCount(carParkCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${carParksOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {carParksOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}

          {/* WASTE & RECYCLING */}
          {mobilePanel === 'waste' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-green-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-green-300/85">
                  <WasteIcon />
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: WASTE_HATCH }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">WASTE · 垃圾回收</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {wasteOn ? wasteVisibleCount : 0}/{wasteTotal}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleWaste}
                disabled={!onToggleWaste}
                aria-pressed={wasteOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${wasteOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleWaste ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={wasteOn ? 'text-green-400' : 'text-white/40'}>
                    <WasteIcon />
                  </span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.wasteCount(wasteVisibleCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${wasteOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {wasteOn ? 'ON' : 'OFF'}
                </span>
              </button>
              {/* Per-type rows — same handlers as the desktop key, at a 44px tap
                  target. No collapsing: the modal is always expanded. */}
              <div className={`pb-1 border-t border-white/10 ${wasteOn ? '' : 'opacity-40'}`}>
                {wasteLegendRows(t, wasteCounts, hiddenWasteTypes).map(row => {
                  // "Lit" = actually drawn on the map: the type is on AND the
                  // master switch is on.
                  const lit = wasteOn && row.on
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onToggleWasteType?.(row.id)}
                      disabled={!onToggleWasteType}
                      aria-pressed={row.on}
                      title={row.label}
                      className={`w-full h-11 flex items-center gap-2 px-3 active:bg-white/[0.04] transition
                                  ${onToggleWasteType ? '' : 'cursor-default'}`}
                    >
                      <span
                        className="inline-block w-[9px] h-[9px] shrink-0"
                        style={row.on
                          ? { backgroundColor: row.color }
                          : { boxShadow: `inset 0 0 0 1px ${row.color}99` }}
                      />
                      <span className={`text-[12px] leading-[1.2] flex-1 min-w-0 text-left truncate
                                        ${row.on ? 'text-white/75' : 'text-white/30'}`}>
                        {row.label}
                      </span>
                      <span
                        className={`mm-mono mm-tabular text-[11px] w-8 text-right shrink-0
                                    ${lit ? '' : 'text-white/25'}`}
                        style={lit ? { color: row.color } : undefined}
                      >
                        {row.count}
                      </span>
                      <span className={`mm-mono text-[10px] tracking-[0.2em] w-8 text-right shrink-0
                                        ${lit ? 'text-emerald-300' : 'text-white/25'}`}>
                        {row.on ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  )
                })}
                {/* The same two captions as the desktop key: what the type rows
                    do, and what switching the layer on does to the rest of the
                    map — the counterpart of the WATER key's disclaimer. */}
                <div className="px-3 pt-1 mm-mono text-[8px] tracking-[0.18em] text-white/30 uppercase">
                  {t.wasteTypesHint}
                </div>
                <div className="px-3 pb-1 mm-mono text-[8px] tracking-[0.18em] text-white/30 uppercase">
                  {t.wasteFocusNote}
                </div>
              </div>
            </div>
          )}

          {/* MACAO WATER */}
          {mobilePanel === 'water' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-sky-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sky-300/85">
                  <WaterIcon />
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: WATER_HATCH }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">WATER · 供水</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {waterOn ? waterCount : 0}/{waterCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleWater}
                disabled={!onToggleWater}
                aria-pressed={waterOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${waterOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleWater ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={waterOn ? 'text-sky-400' : 'text-white/40'}>
                    <WaterIcon />
                  </span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.waterCount(waterCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${waterOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {waterOn ? 'ON' : 'OFF'}
                </span>
              </button>
              {/* The same key as the desktop panel. Shown whether or not the
                  layer is on: a touch device has no hover, so this modal is
                  the only place the marks are ever explained. Its caption
                  carries the "schematic" disclaimer. */}
              <div className="border-t border-white/10 pt-1.5">
                <WaterKey network={waterNetwork} caption={t.waterNetworkNote} />
              </div>
            </div>
          )}

          {/* CEM ELECTRICITY */}
          {mobilePanel === 'power' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-amber-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber-300/85">
                  <PowerIcon />
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: POWER_HATCH }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">POWER · 電力</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {powerOn ? powerCount : 0}/{powerCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onTogglePower}
                disabled={!onTogglePower}
                aria-pressed={powerOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${powerOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onTogglePower ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={powerOn ? 'text-amber-400' : 'text-white/40'}>
                    <PowerIcon />
                  </span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.powerCount(powerCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${powerOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {powerOn ? 'ON' : 'OFF'}
                </span>
              </button>
              {/* Shown whether or not the layer is on, like the WATER modal: a
                  touch device has no hover, so this is the only place the marks
                  are ever explained. Its caption carries the disclaimer. */}
              <div className="border-t border-white/10 pt-1.5">
                <PowerKey network={powerNetwork} caption={t.powerNetworkNote} />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
