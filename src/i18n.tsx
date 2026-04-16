import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Lang = 'en' | 'zh' | 'pt'

const LANG_CYCLE: Record<Lang, Lang> = { zh: 'pt', pt: 'en', en: 'zh' }

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
    scheduleMonThu: 'Mon–Thu',
    scheduleFriday: 'Friday',
    scheduleSatSun: 'Sat/Sun/Holiday',
    clickToSetTime: 'Click to set time',
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
    scheduleMonThu: '週一至週四',
    scheduleFriday: '週五',
    scheduleSatSun: '週六日及公眾假期',
    clickToSetTime: '點擊設定時間',
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
    scheduleMonThu: 'Seg–Qui',
    scheduleFriday: 'Sexta',
    scheduleSatSun: 'Sáb/Dom/Feriado',
    clickToSetTime: 'Clique para definir a hora',
  },
}

interface Translations {
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
}

interface I18nContextValue {
  lang: Lang
  t: Translations
  toggleLang: () => void
}

const I18nContext = createContext<I18nContextValue>(null!)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('zh')

  const toggleLang = useCallback(() => {
    setLang(prev => LANG_CYCLE[prev])
  }, [])

  const t = translations[lang]

  return (
    <I18nContext.Provider value={{ lang, t, toggleLang }}>
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
