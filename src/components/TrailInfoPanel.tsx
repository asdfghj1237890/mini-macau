import { useI18n, type Lang, type Translations } from '../i18n'
import type { TrailArea, TrailPost, TrailSpur, TrailSummit, TrailSummitAccess } from '../types'
import {
  TRAIL_CLOSED_COLOR,
  TRAIL_COLORS,
  countTrailPosts,
  isTrailClosed,
  pickTrailText,
  summitHeightText,
  trailSummitsFor,
  trailSuspensionAt,
  upcomingTrailSuspension,
  type TrailPoint,
  type TrailSelection,
} from '../trails'

interface Props {
  selection: TrailSelection
  // The simulated date, YYYY-MM-DD — suspensions are date windows.
  ymd: string
  // Every distance post (unfiltered), for the per-trail count.
  posts: TrailPost[]
  // Every summit and climb (unfiltered), for the trail's summit rows.
  summits: TrailSummit[]
  spurs: TrailSpur[]
  onClose: () => void
}

// The dataset the user chose as the credit line for this layer.
const DATASET_URL = 'https://data.gov.mo/Detail?id=e410770e-caa6-4a56-872b-68b8af389cac'
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'
// Summit heights: DSEC Environmental Statistics table 2.3; positions: DSSCU's
// geodetic control points.
const DSEC_HEIGHTS_URL = 'https://www.dsec.gov.mo/getAttachment/a774d773-9696-48c1-b8a7-21efd4dcd1fb/E_AMB_PUB_2011_Y.aspx'
const DSSCU_CONTROL_POINTS_URL = 'https://geomatics.dsscu.gov.mo/zh-hant/tripoints1.html'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="mm-mono text-ui-9 max-sm:text-ui-7 tracking-[0.25em] text-(--mm-text-muted) shrink-0 pt-[2px]">
        {label}
      </span>
      <span className="text-ui-10 text-(--mm-fg)/80 text-right mm-han min-w-0">{value}</span>
    </div>
  )
}

function areaLabel(t: Translations, area: TrailArea): string {
  if (area === 'peninsula') return t.trailAreaPeninsula
  if (area === 'taipa') return t.trailAreaTaipa
  return t.trailAreaColoane
}

function pointLabel(t: Translations, point: TrailPoint, lang: Lang): string {
  if (point.kind === 'entrance') return t.trailPointEntrance(point.index + 1)
  if (point.kind === 'post') return t.trailPointPost(point.code)
  if (point.kind === 'summit') return t.trailPointSummit(pickTrailText(point.summit.name, lang), summitHeightText(point.summit))
  if (point.kind === 'spur') return t.trailPointSpur(pickTrailText(point.spur.name, lang))
  return t.trailPointPavilion(point.name)
}

// How this trail meets a summit, in words.
function accessLabel(t: Translations, access: TrailSummitAccess, spurName: string | null): string {
  if (access.via === 'trail') return t.trailSummitOnTrail
  // A climb that stops short of the pillar says how far short (OSM has no
  // path to 小潭山's top, for one).
  if (access.via === 'spur') {
    return access.distanceM > 30
      ? t.trailSummitViaSpurShort(spurName ?? '', access.distanceM)
      : t.trailSummitViaSpur(spurName ?? '')
  }
  return t.trailSummitNear(access.distanceM)
}

function metres(n: number, lang: string): string {
  return `${n.toLocaleString(lang === 'zh' ? 'zh-Hant' : lang === 'pt' ? 'pt-PT' : 'en-GB')} m`
}

export function TrailInfoPanel({ selection, ymd, posts, summits, spurs, onClose }: Props) {
  const { lang, t } = useI18n()
  const { trail, point } = selection

  // Header accent = the colour the line is drawn in right now, so a suspended
  // trail's panel is as grey as its dash.
  const closed = isTrailClosed(trail, ymd)
  const color = closed ? TRAIL_CLOSED_COLOR : TRAIL_COLORS[trail.kind]
  const suspension = trailSuspensionAt(trail, ymd)
  const upcoming = suspension ? null : upcomingTrailSuspension(trail, ymd)

  const title = pickTrailText(trail.name, lang)
  const entrance = pickTrailText(trail.entrance, lang)
  const exit = pickTrailText(trail.exit, lang)
  const openHours = pickTrailText(trail.openHours, lang)
  const postCount = countTrailPosts(posts, trail)
  const trailSummits = trailSummitsFor(summits, trail)
  const trailSpurs = spurs.filter(spur => spur.trails.includes(trail.id))
  const spurName = (summitId: string) => {
    const spur = trailSpurs.find(sp => sp.summit === summitId)
    return spur ? pickTrailText(spur.name, lang) : null
  }

  // IAM's published length first; the drawn line's own length beside it only
  // where the two differ by more than 5 % (several trails do, by up to 44 %).
  const drawn = trail.drawnLengthM
  const published = trail.lengthM
  const lengthText = published
    ? Math.abs(drawn - published) / published > 0.05
      ? `${metres(published, lang)} (${t.trailLengthDrawn(metres(drawn, lang))})`
      : metres(published, lang)
    : metres(drawn, lang)

  let status = t.trailOpen
  if (suspension) status = t.trailSuspended(suspension.from, suspension.to)
  else if (trail.closed) status = t.trailClosedFlag
  else if (upcoming) status = t.trailUpcoming(upcoming.from, upcoming.to)

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-fg)/10 rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) overflow-hidden mm-fade">
        {/* Header signboard: kind + the code on the posts, then the name. */}
        <div className="flex items-stretch border-b border-(--mm-fg)/10">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-(--mm-fg)/10"
               style={{ backgroundColor: `${color}14` }}>
            <div className="w-1 h-7 shrink-0" style={{ backgroundColor: color }} />
            <div>
              <div className="mm-mono text-ui-9 max-sm:text-ui-7 tracking-[0.25em] text-(--mm-text-secondary) mm-han">
                {trail.kind === 'cycle' ? t.trailLabelCycle : t.trailLabelWalk}
              </div>
              <div className="mm-mono text-ui-13 font-bold text-(--mm-fg) leading-tight">
                {trail.code ?? '—'}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="text-ui-14 font-bold text-(--mm-fg) truncate mm-han" title={title}>
              {title}
            </div>
            <div className={`mm-han text-ui-9 max-sm:text-ui-7 truncate
                             ${suspension || trail.closed ? 'text-(--mm-amber-1)' : 'text-(--mm-text-muted)'}`}>
              {areaLabel(t, trail.area)} · {status}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 text-(--mm-text-muted) hover:text-(--mm-fg) hover:bg-(--mm-fg)/5 border-l border-(--mm-fg)/10
                       mm-mono text-ui-13 transition-colors"
            aria-label={t.cancel}
          >
            ✕
          </button>
        </div>

        <div className="px-3 py-2 space-y-1">
          {point && <Row label={t.trailPoint} value={pointLabel(t, point, lang)} />}
          {trailSummits.map(({ summit, access }) => (
            <Row
              key={summit.id}
              label={t.trailSummit}
              value={`${pickTrailText(summit.name, lang)} ${summitHeightText(summit)} · ${accessLabel(t, access, spurName(summit.id))}`}
            />
          ))}
          <Row label={t.trailLength} value={lengthText} />
          {entrance && <Row label={t.trailEntrance} value={entrance} />}
          {exit && <Row label={t.trailExit} value={exit} />}
          {openHours && <Row label={t.trailOpenHours} value={openHours} />}
          {trail.phone && <Row label={t.trailPhone} value={trail.phone} />}
        </div>

        {postCount > 0 && (
          <div className="px-3 pb-2 text-ui-9 text-(--mm-text-muted) mm-han">
            {t.trailPosts(postCount)}
          </div>
        )}

        {/* Footer: the credited dataset, the IAM page, and OSM's licence when
            the line itself came from OpenStreetMap. */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] space-y-[2px]">
          <div className="flex items-center justify-between gap-2">
            <span className="mm-mono text-ui-8 max-sm:text-ui-6 tracking-[0.25em] text-(--mm-text-muted) uppercase">
              {t.trailSource}
            </span>
            <span className="mm-mono text-ui-8 max-sm:text-ui-6 tracking-wider text-(--mm-text-muted) truncate">
              {/* One cycle track has no IAM page upstream (empty webLink). */}
              {trail.webLink && (
                <>
                  <a href={trail.webLink} target="_blank" rel="noopener noreferrer"
                     className="hover:text-(--mm-emerald-1) transition-colors">
                    {t.trailIamPage}
                  </a>
                  {' · '}
                </>
              )}
              <a href={DATASET_URL} target="_blank" rel="noopener noreferrer"
                 className="hover:text-(--mm-emerald-1) transition-colors">
                data.gov.mo
              </a>
            </span>
          </div>
          <div className="text-ui-8 max-sm:text-ui-6 text-(--mm-text-muted) mm-han leading-snug">
            {t.trailSourceData}
          </div>
          {trailSummits.length > 0 && (
            <div className="text-ui-8 max-sm:text-ui-6 text-(--mm-text-muted) mm-han leading-snug">
              <a href={DSEC_HEIGHTS_URL} target="_blank" rel="noopener noreferrer"
                 className="hover:text-(--mm-emerald-1) transition-colors">
                {t.trailSummitHeightSource}
              </a>
              {' · '}
              <a href={DSSCU_CONTROL_POINTS_URL} target="_blank" rel="noopener noreferrer"
                 className="hover:text-(--mm-emerald-1) transition-colors">
                {t.trailSummitPositionSource}
              </a>
            </div>
          )}
          {trailSpurs.length > 0 && (
            <div className="text-ui-8 max-sm:text-ui-6 text-(--mm-text-muted) mm-han leading-snug">
              <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer"
                 className="hover:text-(--mm-emerald-1) transition-colors">
                {t.trailSpurSource(trailSpurs.map(sp => pickTrailText(sp.name, lang)).join('、'))}
              </a>
            </div>
          )}
          {trail.geometry.source === 'osm' && (
            <div className="text-ui-8 max-sm:text-ui-6 text-(--mm-text-muted) mm-han leading-snug">
              <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer"
                 className="hover:text-(--mm-emerald-1) transition-colors">
                {t.trailSourceOsm}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
