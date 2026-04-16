import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Lang = 'en' | 'zh'

const translations = {
  en: {
    lrtLines: 'LRT Lines',
    busRoutes: 'Bus Routes',
    routesActive: (n: number) => `${n} routes active`,
    route: 'Route',
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
  },
  zh: {
    lrtLines: '輕軌路線',
    busRoutes: '巴士路線',
    routesActive: (n: number) => `${n} 條路線運行中`,
    route: '路線',
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
  },
}

interface Translations {
  lrtLines: string
  busRoutes: string
  routesActive: (n: number) => string
  route: string
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
    setLang(prev => (prev === 'en' ? 'zh' : 'en'))
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
