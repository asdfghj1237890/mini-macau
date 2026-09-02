/* eslint-disable react-refresh/only-export-components --
   This is the i18n context module: it intentionally co-locates the provider
   component with its `useI18n` hook and the pure `localName` helper. Splitting
   them out solely to satisfy the Fast-Refresh "components only" rule would
   churn every importer for no runtime benefit. */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { ga } from './analytics/ga'

export type Lang = 'en' | 'zh' | 'pt'

const LANG_CYCLE: Record<Lang, Lang> = { zh: 'pt', pt: 'en', en: 'zh' }

// localStorage key + the <html lang> tags we publish to screen readers,
// browser translation heuristics, and SEO crawlers. These must match the
// hreflang entries in index.html.
const LS_LANG_KEY = 'mm_lang'
const HTML_LANG_TAG: Record<Lang, string> = {
  zh: 'zh-Hant',
  pt: 'pt-PT',
  en: 'en',
}

function readSavedLang(): Lang {
  if (typeof window === 'undefined') return 'zh'
  try {
    const raw = localStorage.getItem(LS_LANG_KEY)
    if (raw === 'zh' || raw === 'pt' || raw === 'en') return raw
  } catch { /* ignore — private mode, storage disabled */ }
  return 'zh'
}

const translations = {
  en: {
    lrtLines: 'LRT Lines',
    busRoutes: 'Bus Routes',
    routesActive: (n: number) => `${n} routes active`,
    route: 'Route',
    groupPeninsula: 'Peninsula',
    groupCrossHarbour: 'Cross-harbour',
    groupTaipaCotai: 'Taipa / Cotai',
    groupNight: 'Night',
    groupSpecial: 'Special',
    loading: 'Loading...',
    vehicles: (n: number) => `${n} vehicles`,
    now: 'Now',
    play: 'Play',
    pause: 'Pause',
    showAll: 'Show All',
    hideAll: 'Hide All',
    autoByTime: 'By service hours',
    type: 'Type',
    lrt: 'LRT',
    bus: 'Bus',
    position: 'Position',
    bearing: 'Bearing',
    stations: 'Stations',
    nextArrivals: 'Next Arrivals',
    lines: 'Lines',
    resetNorth: 'Reset to current time',
    direction: 'Direction',
    forward: 'Forward',
    backward: 'Backward',
    arrived: 'Arrived',
    arriving: 'Arriving',
    schedule: 'Schedule',
    towards: 'Towards',
    departed: 'Departed',
    dwelling: 'At station',
    scheduleMonThu: 'Mon–Thu schedule',
    scheduleFriday: 'Friday schedule',
    scheduleSatSun: 'Weekend / holiday schedule',
    clickToSetTime: 'Click to set time',
    apply: 'Apply',
    cancel: 'Cancel',
    flights: 'Flights',
    flightsActive: (n: number) => `${n} flights`,
    ferries: 'Ferries',
    roadWorks: 'Road works',
    roadWorksActive: (n: number) => `${n} active`,
    noServiceToday: 'No service today',
    // ---- MapView drawer ----
    mapSettings: 'Map Settings',
    plan2D: '2D Plan',
    terrain3D: '3D Terrain',
    buildings: 'Buildings',
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
    timeBar: 'Time Bar',
    realtimeBus: 'Realtime Bus (β)',
    language: 'Language',
    langNameZh: '繁體中文',
    langNamePt: 'Português',
    langNameEn: 'English',
    about: 'About this site',
    simDisclaimer: 'Map shown is simulated; data may not reflect real-time conditions exactly.',
    // ---- Data sources block ----
    dataSources: 'DATA SOURCES',
    dataSourceBusLabel: 'Bus network',
    dataSourceLrtLabel: 'LRT',
    dataSourceFlightLabel: 'Flights',
    dataSourceFerryLabel: 'Ferries',
    dataSourceRoadWorksLabel: 'Road works',
    // ---- ControlPanel ----
    amPeak: 'AM PEAK',
    pmPeak: 'PM PEAK',
    nowShort: 'NOW',
    simShort: 'SIM',
    expand: 'Expand',
    collapse: 'Collapse',
    firstBusLabel: 'FIRST',
    lastBusLabel: 'LAST',
    rtLocked: 'RT · locked 1×',
    // ---- TimeDisplay ----
    sec: 'SEC',
    timetable: 'TIMETABLE',
    live: 'LIVE',
    vehicleUnit: 'veh',
    // ---- MapSplash ----
    splashTitle: 'MINI MAP MACAU',
    splashLoading: 'LOADING MAP',
    // ---- DateTimePicker ----
    scheduleCategoryLabel: 'SCHEDULE',
    dateCategoryLabel: 'DATE',
    timeCategoryLabel: 'TIME',
    setTimeLabel: 'SET TIME',
    scheduleNoteMonThu: 'Standard',
    scheduleNoteFriday: 'Extra evening',
    scheduleNoteSatSun: 'Late service',
    mtDescMonThu: 'MON–THU',
    mtDescFriday: 'FRIDAY',
    mtDescSatSun: 'WEEKEND',
    quickFirst: 'First',
    quickMorningPeak: 'AM peak',
    quickNoon: 'Noon',
    quickEveningPeak: 'PM peak',
    quickNight: 'Night',
    // ---- Flight panel ----
    flightLabel: 'FLIGHT',
    flightDeparture: 'DEP',
    flightArrival: 'ARR',
    flightDestination: 'TO',
    flightOrigin: 'FROM',
    flightAircraft: 'ACFT',
    flightAirline: 'OPER',
    flightDeparting: 'DEPARTING',
    flightAwaitingTakeoff: 'AWAITING TKOF',
    flightArriving: 'ARRIVING',
    flightAirportCode: 'MFM',
    flightFooterDep: 'DEPARTURE',
    flightFooterArr: 'ARRIVAL',
    // ---- Ferry panel ----
    ferryLabel: 'FERRY',
    ferryDeparture: 'DEP',
    ferryArrival: 'ARR',
    ferryDestination: 'TO',
    ferryOrigin: 'FROM',
    ferryJourney: 'JRNY',
    ferryDeparting: 'DEPARTING',
    ferryArriving: 'ARRIVED',
    ferryRoute: 'ROUTE',
    ferryMin: 'min',
    ferryNote: 'NOTE',
    ferryFooterDep: 'DEPARTURE',
    ferryFooterArr: 'ARRIVAL',
    portOuterHarbour: 'OHT',
    portTaipa: 'TMT',
    // ---- Road works panel ----
    roadWorkLabel: 'ROAD WORKS',
    roadWorkClosed: 'Road closed',
    roadWorkLimited: 'Restricted traffic',
    roadWorkOneWay: 'One-way traffic',
    roadWorkNoParking: 'No parking',
    roadWorkOther: 'Traffic notice',
    roadWorkInForce: 'IN FORCE',
    roadWorkUpcoming: 'UPCOMING',
    roadWorkEnded: 'ENDED',
    roadWorkUntil: (date: string) => `until ${date}`,
    roadWorkStartsIn: (n: number) => (n === 1 ? 'starts tomorrow' : `starts in ${n} days`),
    roadWorkPeriod: 'PERIOD',
    roadWorkDuration: 'DURATION',
    roadWorkDurationValue: (days: number, hours: number) => {
      const d = days === 1 ? '1 day' : `${days} days`
      if (days > 0 && hours > 0) return `${d} ${hours} h`
      if (days > 0) return d
      return `${hours} h`
    },
    roadWorkReason: 'REASON',
    roadWorkApplicant: 'APPLICANT',
    roadWorkContractor: 'CONTRACTOR',
    roadWorkNoticeNo: 'NOTICE',
    roadWorkPrevNotice: 'REPLACES',
    roadWorkDetails: 'DETAILS',
    roadWorkSource: 'SOURCE',
    // ---- VehicleInfoPanel ----
    terminalStop: 'End',
  },
  zh: {
    lrtLines: '輕軌路線',
    busRoutes: '巴士路線',
    routesActive: (n: number) => `${n} 條路線運行中`,
    route: '路線',
    groupPeninsula: '半島線',
    groupCrossHarbour: '跨海線',
    groupTaipaCotai: '氹仔／路氹線',
    groupNight: '夜間線',
    groupSpecial: '特別線',
    loading: '載入中...',
    vehicles: (n: number) => `${n} 輛車輛`,
    now: '現在',
    play: '播放',
    pause: '暫停',
    showAll: '顯示全部',
    hideAll: '隱藏全部',
    autoByTime: '按營運時間',
    type: '類型',
    lrt: '輕軌',
    bus: '巴士',
    position: '位置',
    bearing: '方向',
    stations: '車站',
    nextArrivals: '下一班到站',
    lines: '路線',
    resetNorth: '回到現在時間',
    direction: '方向',
    forward: '正向',
    backward: '反向',
    arrived: '已到達',
    arriving: '即將到達',
    schedule: '行車時刻',
    towards: '開往',
    departed: '已離站',
    dwelling: '停站中',
    scheduleMonThu: '平日班次',
    scheduleFriday: '週五班次',
    scheduleSatSun: '假日班次',
    clickToSetTime: '點擊設定時間',
    apply: '套用',
    cancel: '取消',
    flights: '航班',
    flightsActive: (n: number) => `${n} 架航班`,
    ferries: '船運',
    roadWorks: '工程改道',
    roadWorksActive: (n: number) => `${n} 項生效中`,
    noServiceToday: '本日無服務',
    mapSettings: '地圖設定',
    plan2D: '2D 平面',
    terrain3D: '3D 立體',
    buildings: '建築群',
    darkMode: '深色模式',
    lightMode: '淺色模式',
    timeBar: '時間列',
    realtimeBus: '實時巴士 (實驗)',
    language: '語系',
    langNameZh: '繁體中文',
    langNamePt: 'Português',
    langNameEn: 'English',
    about: '關於本站',
    simDisclaimer: '本地圖為模擬顯示，數據不保證完全反映此時此刻的真實狀況。',
    dataSources: '資料來源',
    dataSourceBusLabel: '巴士路線與車站',
    dataSourceLrtLabel: '輕軌',
    dataSourceFlightLabel: '航班',
    dataSourceFerryLabel: '噴射船',
    dataSourceRoadWorksLabel: '工程改道',
    amPeak: '早尖峰',
    pmPeak: '晚尖峰',
    nowShort: '現在',
    simShort: '模擬',
    expand: '展開',
    collapse: '收合',
    firstBusLabel: '首班',
    lastBusLabel: '末班',
    rtLocked: 'RT · 鎖定 1×',
    sec: '秒',
    timetable: '班表',
    live: '即時',
    vehicleUnit: '輛',
    splashTitle: 'MINI MAP MACAU',
    splashLoading: '載入地圖中',
    scheduleCategoryLabel: '班表',
    dateCategoryLabel: '日期',
    timeCategoryLabel: '時間',
    setTimeLabel: '設定時間',
    scheduleNoteMonThu: '常規班表',
    scheduleNoteFriday: '略有加班',
    scheduleNoteSatSun: '延長末班',
    mtDescMonThu: '週一至四',
    mtDescFriday: '週五',
    mtDescSatSun: '週末',
    quickFirst: '首班',
    quickMorningPeak: '早尖峰',
    quickNoon: '午',
    quickEveningPeak: '晚尖峰',
    quickNight: '夜',
    flightLabel: '航班',
    flightDeparture: '離澳',
    flightArrival: '抵澳',
    flightDestination: '目的地',
    flightOrigin: '出發地',
    flightAircraft: '機型',
    flightAirline: '航司',
    flightDeparting: '起飛中',
    flightAwaitingTakeoff: '等候起飛',
    flightArriving: '降落中',
    flightAirportCode: 'MFM',
    flightFooterDep: '離境',
    flightFooterArr: '抵境',
    ferryLabel: '船班',
    ferryDeparture: '離澳',
    ferryArrival: '抵澳',
    ferryDestination: '目的地',
    ferryOrigin: '出發地',
    ferryJourney: '航程',
    ferryDeparting: '準備離港',
    ferryArriving: '剛抵港',
    ferryRoute: '航線',
    ferryMin: '分鐘',
    ferryNote: '備註',
    ferryFooterDep: '離港',
    ferryFooterArr: '抵港',
    portOuterHarbour: '外港',
    portTaipa: '氹仔',
    roadWorkLabel: '工程改道',
    roadWorkClosed: '封閉交通',
    roadWorkLimited: '有限度通車',
    roadWorkOneWay: '單一方向行車',
    roadWorkNoParking: '禁止泊車',
    roadWorkOther: '交通通告',
    roadWorkInForce: '生效中',
    roadWorkUpcoming: '即將實施',
    roadWorkEnded: '已結束',
    roadWorkUntil: (date: string) => `至 ${date}`,
    roadWorkStartsIn: (n: number) => (n === 1 ? '明日開始' : `${n} 天後開始`),
    roadWorkPeriod: '日期',
    roadWorkDuration: '為期',
    roadWorkDurationValue: (days: number, hours: number) => {
      if (days > 0 && hours > 0) return `${days}日${hours}小時`
      if (days > 0) return `${days}日`
      return `${hours}小時`
    },
    roadWorkReason: '事由',
    roadWorkApplicant: '申請人',
    roadWorkContractor: '承建商',
    roadWorkNoticeNo: '通告編號',
    roadWorkPrevNotice: '上一份通告',
    roadWorkDetails: '內文',
    roadWorkSource: '來源',
    terminalStop: '終站',
  },
  pt: {
    lrtLines: 'Linhas MLM',
    busRoutes: 'Rotas de Autocarro',
    routesActive: (n: number) => `${n} rotas activas`,
    route: 'Rota',
    groupPeninsula: 'Península',
    groupCrossHarbour: 'Travessia',
    groupTaipaCotai: 'Taipa / Cotai',
    groupNight: 'Nocturno',
    groupSpecial: 'Especial',
    loading: 'A carregar...',
    vehicles: (n: number) => `${n} veículos`,
    now: 'Agora',
    play: 'Reproduzir',
    pause: 'Pausa',
    showAll: 'Mostrar Tudo',
    hideAll: 'Ocultar Tudo',
    autoByTime: 'Por horário',
    type: 'Tipo',
    lrt: 'MLM',
    bus: 'Autocarro',
    position: 'Posição',
    bearing: 'Direcção',
    stations: 'Estações',
    nextArrivals: 'Próximas Chegadas',
    lines: 'Linhas',
    resetNorth: 'Repor hora actual',
    direction: 'Direcção',
    forward: 'Ida',
    backward: 'Volta',
    arrived: 'Chegou',
    arriving: 'A chegar',
    schedule: 'Horário',
    towards: 'Direcção',
    departed: 'Partiu',
    dwelling: 'Na estação',
    scheduleMonThu: 'Horário Seg–Qui',
    scheduleFriday: 'Horário Sex',
    scheduleSatSun: 'Horário fim-de-semana',
    clickToSetTime: 'Clique para definir a hora',
    apply: 'Aplicar',
    cancel: 'Cancelar',
    flights: 'Voos',
    flightsActive: (n: number) => `${n} voos`,
    ferries: 'Ferries',
    roadWorks: 'Obras na via',
    roadWorksActive: (n: number) => `${n} activas`,
    noServiceToday: 'Sem serviço hoje',
    mapSettings: 'Definições',
    plan2D: '2D Plano',
    terrain3D: '3D Relevo',
    buildings: 'Edifícios',
    darkMode: 'Modo Escuro',
    lightMode: 'Modo Claro',
    timeBar: 'Barra de Hora',
    realtimeBus: 'Autocarro Tempo Real (β)',
    language: 'Idioma',
    langNameZh: '繁體中文',
    langNamePt: 'Português',
    langNameEn: 'English',
    about: 'Sobre o site',
    simDisclaimer: 'Este mapa é uma simulação; os dados podem não refletir a realidade em tempo real.',
    dataSources: 'FONTES DE DADOS',
    dataSourceBusLabel: 'Rede de autocarros',
    dataSourceLrtLabel: 'MLM',
    dataSourceFlightLabel: 'Voos',
    dataSourceFerryLabel: 'Ferries',
    dataSourceRoadWorksLabel: 'Obras na via',
    amPeak: 'PICO MANHÃ',
    pmPeak: 'PICO TARDE',
    nowShort: 'AGORA',
    simShort: 'SIM',
    expand: 'Expandir',
    collapse: 'Recolher',
    firstBusLabel: 'PRIM',
    lastBusLabel: 'ÚLT',
    rtLocked: 'RT · bloqueado 1×',
    sec: 'SEG',
    timetable: 'HORÁRIO',
    live: 'AO VIVO',
    vehicleUnit: 'v',
    splashTitle: 'MINI MAP MACAU',
    splashLoading: 'A CARREGAR MAPA',
    scheduleCategoryLabel: 'HORÁRIO',
    dateCategoryLabel: 'DATA',
    timeCategoryLabel: 'HORA',
    setTimeLabel: 'DEFINIR HORA',
    scheduleNoteMonThu: 'Padrão',
    scheduleNoteFriday: 'Reforço à noite',
    scheduleNoteSatSun: 'Fim de serviço alargado',
    mtDescMonThu: 'SEG–QUI',
    mtDescFriday: 'SEX',
    mtDescSatSun: 'FIM-SEMANA',
    quickFirst: 'Primeiro',
    quickMorningPeak: 'Pico manhã',
    quickNoon: 'Meio-dia',
    quickEveningPeak: 'Pico tarde',
    quickNight: 'Noite',
    flightLabel: 'VOO',
    flightDeparture: 'PART',
    flightArrival: 'CHEG',
    flightDestination: 'DEST',
    flightOrigin: 'ORIG',
    flightAircraft: 'AERN',
    flightAirline: 'OPER',
    flightDeparting: 'A DESC.',
    flightAwaitingTakeoff: 'A AGUARD.',
    flightArriving: 'A ATER.',
    flightAirportCode: 'MFM',
    flightFooterDep: 'PARTIDA',
    flightFooterArr: 'CHEGADA',
    ferryLabel: 'FERRY',
    ferryDeparture: 'PART',
    ferryArrival: 'CHEG',
    ferryDestination: 'DEST',
    ferryOrigin: 'ORIG',
    ferryJourney: 'VIAG',
    ferryDeparting: 'A SAIR',
    ferryArriving: 'CHEGOU',
    ferryRoute: 'ROTA',
    ferryMin: 'min',
    ferryNote: 'NOTA',
    ferryFooterDep: 'PARTIDA',
    ferryFooterArr: 'CHEGADA',
    portOuterHarbour: 'OHT',
    portTaipa: 'TMT',
    roadWorkLabel: 'OBRAS NA VIA',
    roadWorkClosed: 'Vedado ao trânsito',
    roadWorkLimited: 'Condicionamentos ao trânsito',
    roadWorkOneWay: 'Sentido único',
    roadWorkNoParking: 'Proibido estacionar',
    roadWorkOther: 'Aviso de trânsito',
    roadWorkInForce: 'EM VIGOR',
    roadWorkUpcoming: 'EM BREVE',
    roadWorkEnded: 'TERMINADO',
    roadWorkUntil: (date: string) => `até ${date}`,
    roadWorkStartsIn: (n: number) => (n === 1 ? 'começa amanhã' : `começa em ${n} dias`),
    roadWorkPeriod: 'PERÍODO',
    roadWorkDuration: 'DURAÇÃO',
    roadWorkDurationValue: (days: number, hours: number) => {
      const d = days === 1 ? '1 dia' : `${days} dias`
      if (days > 0 && hours > 0) return `${d} ${hours} h`
      if (days > 0) return d
      return `${hours} h`
    },
    roadWorkReason: 'MOTIVO',
    roadWorkApplicant: 'REQUERENTE',
    roadWorkContractor: 'EMPREITEIRO',
    roadWorkNoticeNo: 'AVISO',
    roadWorkPrevNotice: 'SUBSTITUI',
    roadWorkDetails: 'DETALHES',
    roadWorkSource: 'FONTE',
    terminalStop: 'Terminal',
  },
}

export interface Translations {
  lrtLines: string
  busRoutes: string
  routesActive: (n: number) => string
  route: string
  groupPeninsula: string
  groupCrossHarbour: string
  groupTaipaCotai: string
  groupNight: string
  groupSpecial: string
  loading: string
  vehicles: (n: number) => string
  now: string
  play: string
  pause: string
  showAll: string
  hideAll: string
  autoByTime: string
  type: string
  lrt: string
  bus: string
  position: string
  bearing: string
  stations: string
  nextArrivals: string
  lines: string
  resetNorth: string
  direction: string
  forward: string
  backward: string
  arrived: string
  arriving: string
  schedule: string
  towards: string
  departed: string
  dwelling: string
  scheduleMonThu: string
  scheduleFriday: string
  scheduleSatSun: string
  clickToSetTime: string
  apply: string
  cancel: string
  flights: string
  flightsActive: (n: number) => string
  ferries: string
  roadWorks: string
  roadWorksActive: (n: number) => string
  noServiceToday: string
  mapSettings: string
  plan2D: string
  terrain3D: string
  buildings: string
  darkMode: string
  lightMode: string
  timeBar: string
  realtimeBus: string
  language: string
  langNameZh: string
  langNamePt: string
  langNameEn: string
  about: string
  simDisclaimer: string
  dataSources: string
  dataSourceBusLabel: string
  dataSourceLrtLabel: string
  dataSourceFlightLabel: string
  dataSourceFerryLabel: string
  dataSourceRoadWorksLabel: string
  amPeak: string
  pmPeak: string
  nowShort: string
  simShort: string
  expand: string
  collapse: string
  firstBusLabel: string
  lastBusLabel: string
  rtLocked: string
  sec: string
  timetable: string
  live: string
  vehicleUnit: string
  splashTitle: string
  splashLoading: string
  scheduleCategoryLabel: string
  dateCategoryLabel: string
  timeCategoryLabel: string
  setTimeLabel: string
  scheduleNoteMonThu: string
  scheduleNoteFriday: string
  scheduleNoteSatSun: string
  mtDescMonThu: string
  mtDescFriday: string
  mtDescSatSun: string
  quickFirst: string
  quickMorningPeak: string
  quickNoon: string
  quickEveningPeak: string
  quickNight: string
  flightLabel: string
  flightDeparture: string
  flightArrival: string
  flightDestination: string
  flightOrigin: string
  flightAircraft: string
  flightAirline: string
  flightDeparting: string
  flightAwaitingTakeoff: string
  flightArriving: string
  flightAirportCode: string
  flightFooterDep: string
  flightFooterArr: string
  ferryLabel: string
  ferryDeparture: string
  ferryArrival: string
  ferryDestination: string
  ferryOrigin: string
  ferryJourney: string
  ferryDeparting: string
  ferryArriving: string
  ferryRoute: string
  ferryMin: string
  ferryNote: string
  ferryFooterDep: string
  ferryFooterArr: string
  portOuterHarbour: string
  portTaipa: string
  roadWorkLabel: string
  roadWorkClosed: string
  roadWorkLimited: string
  roadWorkOneWay: string
  roadWorkNoParking: string
  roadWorkOther: string
  roadWorkInForce: string
  roadWorkUpcoming: string
  roadWorkEnded: string
  roadWorkUntil: (date: string) => string
  roadWorkStartsIn: (n: number) => string
  roadWorkPeriod: string
  roadWorkDuration: string
  roadWorkDurationValue: (days: number, hours: number) => string
  roadWorkReason: string
  roadWorkApplicant: string
  roadWorkContractor: string
  roadWorkNoticeNo: string
  roadWorkPrevNotice: string
  roadWorkDetails: string
  roadWorkSource: string
  terminalStop: string
}

interface I18nContextValue {
  lang: Lang
  t: Translations
  toggleLang: () => void
  setLang: (lang: Lang) => void
}

const I18nContext = createContext<I18nContextValue>(null!)

export function I18nProvider({ children }: { children: ReactNode }) {
  // Initialise from localStorage so the user's previous choice survives a
  // reload. Falls back to 'zh' when no saved value or storage is unavailable.
  const [lang, setLangState] = useState<Lang>(readSavedLang)

  const toggleLang = useCallback(() => {
    setLangState(prev => LANG_CYCLE[prev])
  }, [])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
  }, [])

  // Persist + keep <html lang> in sync with the active UI language. Assistive
  // tech (screen readers) and browser auto-translate rely on this attribute
  // to pick correct pronunciation / translation pairs; if we don't update it
  // it stays stuck at zh-Hant from index.html regardless of the user's choice.
  //
  // Also emit a `language_changed` GA4 event on every switch EXCEPT the
  // initial mount value — we want to measure user-initiated changes, not
  // the hydrated-from-localStorage default.
  const prevLangRef = useRef<Lang | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem(LS_LANG_KEY, lang)
    } catch { /* storage might be disabled */ }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = HTML_LANG_TAG[lang]
    }
    if (prevLangRef.current !== null && prevLangRef.current !== lang) {
      ga.languageChanged(prevLangRef.current, lang, 'app')
    }
    prevLangRef.current = lang
  }, [lang])

  const t = translations[lang]

  return (
    <I18nContext.Provider value={{ lang, t, toggleLang, setLang }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}

export function localName(
  lang: Lang,
  item: { name?: string; nameCn?: string; namePt?: string },
): string {
  if (lang === 'zh') return item.nameCn || item.name || ''
  if (lang === 'pt') return item.namePt || item.name || ''
  return item.name || ''
}
