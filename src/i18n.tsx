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
    schools: 'Schools',
    schoolsCount: (n: number) => `${n} schools`,
    schoolLevelKindergarten: 'Kindergarten',
    schoolLevelPrimary: 'Primary',
    schoolLevelSecondary: 'Secondary',
    schoolLevelUniversity: 'University',
    schoolLevelAllThrough: 'K–12 (all-through)',
    schoolsExpandTitle: 'Show or hide school types',
    schoolsToggleAllTitle: 'Toggle the whole layer',
    toilets: 'Public toilets',
    toiletsCount: (n: number) => `${n} toilets`,
    cityLayers: 'City layers',
    carParks: 'Public car parks',
    carParksCount: (n: number) => `${n} car parks`,
    water: 'Water supply',
    waterCount: (n: number) => `${n} facilities`,
    power: 'Electricity',
    powerCount: (n: number) => `${n} facilities`,
    noServiceToday: 'No service today',
    // ---- MapView drawer ----
    mapSettings: 'Map Settings',
    plan2D: '2D Plan',
    terrain3D: '3D Terrain',
    buildings: 'Buildings',
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
    timeBar: 'Time Bar',
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
    dataSourceSchoolsLabel: 'Schools',
    dataSourceToiletsLabel: 'Public toilets',
    dataSourceCarParksLabel: 'Car parks',
    dataSourceWaterLabel: 'Water supply',
    dataSourcePowerLabel: 'Electricity',
    // ---- ControlPanel ----
    amPeak: 'AM PEAK',
    pmPeak: 'PM PEAK',
    nowShort: 'NOW',
    simShort: 'SIM',
    expand: 'Expand',
    collapse: 'Collapse',
    firstBusLabel: 'FIRST',
    lastBusLabel: 'LAST',
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
    // ---- SchoolInfoPanel ----
    schoolLabel: 'SCHOOL',
    schoolSystem: 'SYSTEM',
    schoolSystemPrivate: 'Private school',
    schoolSystemPublic: 'Public school',
    schoolSystemTertiary: 'Tertiary institution',
    schoolStages: 'STAGES',
    schoolBuilding: 'BUILDING',
    schoolCampus: 'CAMPUS',
    schoolBuildings: (n: number) => `${n} building${n === 1 ? '' : 's'}`,
    schoolCode: 'DSEDJ CODE',
    schoolSource: 'SOURCE',
    // ---- ToiletInfoPanel ----
    toiletLabel: 'TOILET',
    toiletAccessible: 'Barrier-free',
    toiletFamily: 'Family cubicle',
    toiletClosed: 'Temporarily closed',
    toiletOpenHours: 'HOURS',
    toiletAddress: 'ADDRESS',
    toiletPhone: 'PHONE',
    toiletCode: 'IAM CODE',
    toiletPhoto: 'Photo',
    toiletSource: 'SOURCE',
    // ---- CarParkInfoPanel ----
    carParkLabel: 'CAR PARK',
    carParkLocation: 'LOCATION',
    carParkEntrance: 'ENTRANCE',
    carParkHeightLimit: 'HEIGHT LIMIT',
    carParkPhone: 'PHONE',
    carParkFees: 'FEES',
    carParkFeeLight: 'Light vehicles',
    carParkFeeHeavy: 'Heavy vehicles',
    carParkFeeMoto: 'Motorcycles',
    carParkFeeRemark: 'Notes',
    carParkVacancy: 'VACANT SPACES',
    carParkVacancyCar: 'Cars',
    carParkVacancyMoto: 'Motorcycles',
    carParkVacancyECar: 'Electric cars',
    carParkVacancyEMoto: 'Electric motorcycles',
    carParkVacancyDisabled: 'Disabled',
    carParkVacancyUpdated: 'Updated',
    carParkVacancyPaused: 'Publication suspended',
    carParkVacancyOnlyAtRealtime: 'Live vacancy shows only while the clock is at the present',
    carParkSource: 'SOURCE',
    waterLabel: 'WATER',
    waterTypePlant: 'Treatment plant',
    waterTypeReservoir: 'Reservoir',
    waterTypeTank: 'Elevated tank',
    waterTypeRawPumping: 'Raw water pumping station',
    waterTypePumping: 'Pumping station',
    // The Zhuhai raw-water inlet — a node of our schematic network, not one of
    // the 22 facilities Macao Water lists.
    waterTypeInlet: 'Raw water inlet',
    waterInletNote: 'About 96% of the raw water Macau uses comes from the Xijiang, delivered through Zhuhai.',
    // Shown wherever the pipes are: they are our own drawing, snapped to roads,
    // not Macao Water's real mains.
    waterNetworkNote: 'Schematic pipe network',
    waterPipes: (n: number) => `${n} pipe${n === 1 ? '' : 's'} connected`,
    // Legend key rows for the pipe styles.
    waterPipeRaw: 'Raw-water main',
    waterPipeTreated: 'Treated-water main',
    waterPipeFallback: 'Straight-line stand-in',
    // The basemap's roads restyled as thin pipes — a plausible distribution
    // network, not a surveyed one, which is what the wording has to convey.
    waterLegendDistribution: 'Distribution network (schematic, along every road)',
    // Ownership. Most of the overlay is the concessionaire's; the government
    // raw-water reservoirs are not, and the panel has to say so.
    waterOperatorMacaoWater: 'Macao Water facility',
    waterOperatorDsama: 'Government raw-water reservoir (DSAMA) · not a Macao Water facility',
    waterNo: 'FACILITY No.',
    waterApproximate: 'Approximate location',
    waterCoLocatedWith: (name: string) => `Sited at ${name}`,
    waterBuildings: (n: number) => `${n} footprint${n === 1 ? '' : 's'}`,
    waterFootprints: 'FOOTPRINTS',
    waterSource: 'SOURCE',
    // ---- POWER overlay (CEM) ----
    powerLabel: 'POWER',
    powerTypePlant: 'Power station',
    powerTypeIncinerator: 'Waste-to-energy plant',
    powerTypeSub220: '220 kV substation',
    powerTypeSub110: '110 kV substation',
    powerTypeSub66: '66 kV substation',
    // The three points where the Guangdong grid lands — nodes of our schematic
    // network, not CEM stations.
    powerTypeInlet: 'Grid import point',
    powerInletNote: 'Imported from the Guangdong grid: about 91% of the electricity Macau used in 2025.',
    // Shown wherever the HV network is drawn or described: it is OUR diagram,
    // not CEM's cable routes, which are underground and not public.
    powerNetworkNote: 'Schematic grid',
    powerLines: (n: number) => `${n} line${n === 1 ? '' : 's'} connected`,
    powerLineVoltage: (kv: number) => `${kv} kV line`,
    powerLegendDistribution: 'Distribution network (schematic, along every road)',
    // The incinerator is a government plant that sells into the grid, not a CEM
    // asset, and the panel has to say so.
    powerOperatorCem: 'CEM (Companhia de Electricidade de Macau) facility',
    powerOperatorDspa: 'Government waste-to-energy plant · sells power to CEM',
    powerVoltage: 'VOLTAGE',
    powerVoltageValue: (kv: number) => `${kv} kV`,
    powerApproximate: 'Approximate location',
    powerCoLocatedWith: (name: string) => `Sited at ${name}`,
    powerBuildings: (n: number) => `${n} footprint${n === 1 ? '' : 's'}`,
    powerFootprints: 'FOOTPRINTS',
    powerUnits: 'UNITS',
    powerCapacity: 'CAPACITY',
    powerCommissioned: 'IN SERVICE',
    powerCapacityMw: (mw: number) => `${mw} MW`,
    powerSource: 'SOURCE',
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
    schools: '學校',
    schoolsCount: (n: number) => `${n} 所學校`,
    schoolLevelKindergarten: '幼稚園',
    schoolLevelPrimary: '小學',
    schoolLevelSecondary: '中學',
    schoolLevelUniversity: '大學',
    schoolLevelAllThrough: '一條龍',
    schoolsExpandTitle: '展開／收合各類學校',
    schoolsToggleAllTitle: '開關整層',
    toilets: '公廁',
    toiletsCount: (n: number) => `${n} 間公廁`,
    cityLayers: '城市資料',
    carParks: '公共停車場',
    carParksCount: (n: number) => `${n} 個停車場`,
    water: '供水設施',
    waterCount: (n: number) => `${n} 項供水設施`,
    power: '電力設施',
    powerCount: (n: number) => `${n} 項電力設施`,
    noServiceToday: '本日無服務',
    mapSettings: '地圖設定',
    plan2D: '2D 平面',
    terrain3D: '3D 立體',
    buildings: '建築群',
    darkMode: '深色模式',
    lightMode: '淺色模式',
    timeBar: '時間列',
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
    dataSourceSchoolsLabel: '學校',
    dataSourceToiletsLabel: '公廁',
    dataSourceCarParksLabel: '停車場',
    dataSourceWaterLabel: '供水設施',
    dataSourcePowerLabel: '電力',
    amPeak: '早尖峰',
    pmPeak: '晚尖峰',
    nowShort: '現在',
    simShort: '模擬',
    expand: '展開',
    collapse: '收合',
    firstBusLabel: '首班',
    lastBusLabel: '末班',
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
    schoolLabel: '學校',
    schoolSystem: '類型',
    schoolSystemPrivate: '私立學校',
    schoolSystemPublic: '公立學校',
    schoolSystemTertiary: '高等院校',
    schoolStages: '教育階段',
    schoolBuilding: '樓宇',
    schoolCampus: '校舍',
    schoolBuildings: (n: number) => `${n} 棟建築`,
    schoolCode: '教青局編號',
    schoolSource: '來源',
    toiletLabel: '公廁',
    toiletAccessible: '無障礙',
    toiletFamily: '親子廁所',
    toiletClosed: '暫停使用',
    toiletOpenHours: '開放時間',
    toiletAddress: '地址',
    toiletPhone: '電話',
    toiletCode: '編號',
    toiletPhoto: '相片',
    toiletSource: '來源',
    carParkLabel: '停車場',
    carParkLocation: '位置',
    carParkEntrance: '出入口',
    carParkHeightLimit: '限高',
    carParkPhone: '電話',
    carParkFees: '收費',
    carParkFeeLight: '輕型車輛',
    carParkFeeHeavy: '重型車輛',
    carParkFeeMoto: '電單車',
    carParkFeeRemark: '備註',
    carParkVacancy: '即時空位',
    carParkVacancyCar: '汽車',
    carParkVacancyMoto: '電單車',
    carParkVacancyECar: '電動汽車',
    carParkVacancyEMoto: '電動電單車',
    carParkVacancyDisabled: '傷殘人士',
    carParkVacancyUpdated: '更新於',
    carParkVacancyPaused: '暫停發佈',
    carParkVacancyOnlyAtRealtime: '即時空位只在時間為「現在」時顯示',
    carParkSource: '來源',
    waterLabel: '供水',
    waterTypePlant: '水廠',
    waterTypeReservoir: '水塘',
    waterTypeTank: '高位水池',
    waterTypeRawPumping: '原水泵站',
    waterTypePumping: '泵站',
    waterTypeInlet: '原水輸入',
    waterInletNote: '澳門約 96% 的原水取自西江，經珠海輸澳。',
    waterNetworkNote: '管網為示意',
    waterPipes: (n: number) => `連接 ${n} 條管線`,
    waterPipeRaw: '原水管',
    waterPipeTreated: '淨水管',
    waterPipeFallback: '示意直線',
    waterLegendDistribution: '配水管網（示意，沿全澳道路）',
    waterOperatorMacaoWater: '澳門自來水設施',
    waterOperatorDsama: '政府原水水庫（海事及水務局）· 非自來水公司設施',
    waterNo: '設施編號',
    waterApproximate: '約略位置',
    waterCoLocatedWith: (name: string) => `位於${name}`,
    waterBuildings: (n: number) => `${n} 個範圍`,
    waterFootprints: '建築範圍',
    waterSource: '來源',
    powerLabel: '電力',
    powerTypePlant: '發電廠',
    powerTypeIncinerator: '垃圾焚化中心',
    powerTypeSub220: '220 kV 變電站',
    powerTypeSub110: '110 kV 變電站',
    powerTypeSub66: '66 kV 變電站',
    powerTypeInlet: '廣東電網輸入',
    powerInletNote: '廣東電網輸入 · 2025 年約 91% 用電來自輸入。',
    powerNetworkNote: '電網為示意',
    powerLines: (n: number) => `連接 ${n} 條線路`,
    powerLineVoltage: (kv: number) => `${kv} kV 線路`,
    powerLegendDistribution: '配電網（示意，沿全澳道路）',
    powerOperatorCem: '澳門電力股份有限公司（澳電）設施',
    powerOperatorDspa: '政府垃圾焚化中心 · 售電予澳電',
    powerVoltage: '電壓',
    powerVoltageValue: (kv: number) => `${kv} kV`,
    powerApproximate: '約略位置',
    powerCoLocatedWith: (name: string) => `位於${name}`,
    powerBuildings: (n: number) => `${n} 個範圍`,
    powerFootprints: '建築範圍',
    powerUnits: '機組',
    powerCapacity: '裝機容量',
    powerCommissioned: '投產年份',
    powerCapacityMw: (mw: number) => `${mw} MW`,
    powerSource: '來源',
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
    schools: 'Escolas',
    schoolsCount: (n: number) => `${n} escolas`,
    schoolLevelKindergarten: 'Jardim de infância',
    schoolLevelPrimary: 'Primária',
    schoolLevelSecondary: 'Secundária',
    schoolLevelUniversity: 'Universidade',
    schoolLevelAllThrough: 'Contínua (K–12)',
    schoolsExpandTitle: 'Mostrar ou ocultar tipos de escola',
    schoolsToggleAllTitle: 'Ligar ou desligar a camada',
    toilets: 'Sanitários públicos',
    toiletsCount: (n: number) => `${n} sanitários`,
    cityLayers: 'Camadas urbanas',
    carParks: 'Parques de estacionamento',
    carParksCount: (n: number) => `${n} parques`,
    water: 'Abastecimento de água',
    waterCount: (n: number) => `${n} instalações`,
    power: 'Electricidade',
    powerCount: (n: number) => `${n} instalações`,
    noServiceToday: 'Sem serviço hoje',
    mapSettings: 'Definições',
    plan2D: '2D Plano',
    terrain3D: '3D Relevo',
    buildings: 'Edifícios',
    darkMode: 'Modo Escuro',
    lightMode: 'Modo Claro',
    timeBar: 'Barra de Hora',
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
    dataSourceSchoolsLabel: 'Escolas',
    dataSourceToiletsLabel: 'Sanitários',
    dataSourceCarParksLabel: 'Estacionamentos',
    dataSourceWaterLabel: 'Abastecimento de água',
    dataSourcePowerLabel: 'Electricidade',
    amPeak: 'PICO MANHÃ',
    pmPeak: 'PICO TARDE',
    nowShort: 'AGORA',
    simShort: 'SIM',
    expand: 'Expandir',
    collapse: 'Recolher',
    firstBusLabel: 'PRIM',
    lastBusLabel: 'ÚLT',
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
    schoolLabel: 'ESCOLA',
    schoolSystem: 'REDE',
    schoolSystemPrivate: 'Escola particular',
    schoolSystemPublic: 'Escola oficial',
    schoolSystemTertiary: 'Ensino superior',
    schoolStages: 'NÍVEIS',
    schoolBuilding: 'EDIFÍCIO',
    schoolCampus: 'CAMPUS',
    schoolBuildings: (n: number) => `${n} edifício${n === 1 ? '' : 's'}`,
    schoolCode: 'CÓDIGO DSEDJ',
    schoolSource: 'FONTE',
    toiletLabel: 'SANITÁRIO',
    toiletAccessible: 'Sem barreiras',
    toiletFamily: 'Compartimento familiar',
    toiletClosed: 'Encerrado temporariamente',
    toiletOpenHours: 'HORÁRIO',
    toiletAddress: 'MORADA',
    toiletPhone: 'TELEFONE',
    toiletCode: 'CÓDIGO',
    toiletPhoto: 'Foto',
    toiletSource: 'FONTE',
    carParkLabel: 'ESTACIONAMENTO',
    carParkLocation: 'LOCALIZAÇÃO',
    carParkEntrance: 'ENTRADA',
    carParkHeightLimit: 'ALTURA MÁX.',
    carParkPhone: 'TELEFONE',
    carParkFees: 'TARIFAS',
    carParkFeeLight: 'Veículos ligeiros',
    carParkFeeHeavy: 'Veículos pesados',
    carParkFeeMoto: 'Motociclos',
    carParkFeeRemark: 'Notas',
    carParkVacancy: 'LUGARES LIVRES',
    carParkVacancyCar: 'Automóveis',
    carParkVacancyMoto: 'Motociclos',
    carParkVacancyECar: 'Automóveis eléctricos',
    carParkVacancyEMoto: 'Motociclos eléctricos',
    carParkVacancyDisabled: 'Deficientes',
    carParkVacancyUpdated: 'Actualizado',
    carParkVacancyPaused: 'Publicação suspensa',
    carParkVacancyOnlyAtRealtime: 'Lugares livres só aparecem com o relógio no presente',
    carParkSource: 'FONTE',
    waterLabel: 'ÁGUA',
    waterTypePlant: 'Estação de tratamento',
    waterTypeReservoir: 'Reservatório',
    waterTypeTank: 'Tanque elevado',
    waterTypeRawPumping: 'Bombagem de água bruta',
    waterTypePumping: 'Estação de bombagem',
    waterTypeInlet: 'Entrada de água bruta',
    waterInletNote: 'Cerca de 96% da água bruta usada em Macau vem do rio Xijiang, através de Zhuhai.',
    waterNetworkNote: 'Rede de condutas esquemática',
    waterPipes: (n: number) => `${n} conduta${n === 1 ? '' : 's'} ligada${n === 1 ? '' : 's'}`,
    waterPipeRaw: 'Conduta de água bruta',
    waterPipeTreated: 'Conduta de água tratada',
    waterPipeFallback: 'Traçado em linha recta',
    waterLegendDistribution: 'Rede de distribuição (esquemática, ao longo das vias)',
    waterOperatorMacaoWater: 'Instalação da Macao Water',
    waterOperatorDsama: 'Reservatório de água bruta do Governo (DSAMA) · não é uma instalação da Macao Water',
    waterNo: 'N.º DA INSTALAÇÃO',
    waterApproximate: 'Localização aproximada',
    waterCoLocatedWith: (name: string) => `Junto a ${name}`,
    waterBuildings: (n: number) => `${n} implantaç${n === 1 ? 'ão' : 'ões'}`,
    waterFootprints: 'IMPLANTAÇÕES',
    waterSource: 'FONTE',
    powerLabel: 'ENERGIA',
    powerTypePlant: 'Central eléctrica',
    powerTypeIncinerator: 'Central de incineração',
    powerTypeSub220: 'Subestação de 220 kV',
    powerTypeSub110: 'Subestação de 110 kV',
    powerTypeSub66: 'Subestação de 66 kV',
    powerTypeInlet: 'Ponto de importação da rede',
    powerInletNote: 'Importação da rede de Guangdong: cerca de 91% da electricidade usada em Macau em 2025.',
    powerNetworkNote: 'Rede eléctrica esquemática',
    powerLines: (n: number) => `${n} linha${n === 1 ? '' : 's'} ligada${n === 1 ? '' : 's'}`,
    powerLineVoltage: (kv: number) => `Linha de ${kv} kV`,
    powerLegendDistribution: 'Rede de distribuição (esquemática, ao longo das vias)',
    powerOperatorCem: 'Instalação da CEM (Companhia de Electricidade de Macau)',
    powerOperatorDspa: 'Central de incineração do Governo · vende energia à CEM',
    powerVoltage: 'TENSÃO',
    powerVoltageValue: (kv: number) => `${kv} kV`,
    powerApproximate: 'Localização aproximada',
    powerCoLocatedWith: (name: string) => `Junto a ${name}`,
    powerBuildings: (n: number) => `${n} implantaç${n === 1 ? 'ão' : 'ões'}`,
    powerFootprints: 'IMPLANTAÇÕES',
    powerUnits: 'GRUPOS',
    powerCapacity: 'CAPACIDADE',
    powerCommissioned: 'EM SERVIÇO',
    powerCapacityMw: (mw: number) => `${mw} MW`,
    powerSource: 'FONTE',
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
  schools: string
  schoolsCount: (n: number) => string
  schoolLevelKindergarten: string
  schoolLevelPrimary: string
  schoolLevelSecondary: string
  schoolLevelUniversity: string
  schoolLevelAllThrough: string
  schoolsExpandTitle: string
  schoolsToggleAllTitle: string
  toilets: string
  toiletsCount: (n: number) => string
  cityLayers: string
  carParks: string
  carParksCount: (n: number) => string
  water: string
  waterCount: (n: number) => string
  power: string
  powerCount: (n: number) => string
  noServiceToday: string
  mapSettings: string
  plan2D: string
  terrain3D: string
  buildings: string
  darkMode: string
  lightMode: string
  timeBar: string
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
  dataSourceSchoolsLabel: string
  dataSourceToiletsLabel: string
  dataSourceCarParksLabel: string
  dataSourceWaterLabel: string
  dataSourcePowerLabel: string
  amPeak: string
  pmPeak: string
  nowShort: string
  simShort: string
  expand: string
  collapse: string
  firstBusLabel: string
  lastBusLabel: string
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
  schoolLabel: string
  schoolSystem: string
  schoolSystemPrivate: string
  schoolSystemPublic: string
  schoolSystemTertiary: string
  schoolStages: string
  schoolBuilding: string
  schoolCampus: string
  schoolBuildings: (n: number) => string
  schoolCode: string
  schoolSource: string
  toiletLabel: string
  toiletAccessible: string
  toiletFamily: string
  toiletClosed: string
  toiletOpenHours: string
  toiletAddress: string
  toiletPhone: string
  toiletCode: string
  toiletPhoto: string
  toiletSource: string
  carParkLabel: string
  carParkLocation: string
  carParkEntrance: string
  carParkHeightLimit: string
  carParkPhone: string
  carParkFees: string
  carParkFeeLight: string
  carParkFeeHeavy: string
  carParkFeeMoto: string
  carParkFeeRemark: string
  carParkVacancy: string
  carParkVacancyCar: string
  carParkVacancyMoto: string
  carParkVacancyECar: string
  carParkVacancyEMoto: string
  carParkVacancyDisabled: string
  carParkVacancyUpdated: string
  carParkVacancyPaused: string
  carParkVacancyOnlyAtRealtime: string
  carParkSource: string
  waterLabel: string
  waterTypePlant: string
  waterTypeReservoir: string
  waterTypeTank: string
  waterTypeRawPumping: string
  waterTypePumping: string
  waterTypeInlet: string
  waterInletNote: string
  waterNetworkNote: string
  waterPipes: (n: number) => string
  waterPipeRaw: string
  waterPipeTreated: string
  waterPipeFallback: string
  waterLegendDistribution: string
  waterOperatorMacaoWater: string
  waterOperatorDsama: string
  waterNo: string
  waterApproximate: string
  waterCoLocatedWith: (name: string) => string
  waterBuildings: (n: number) => string
  waterFootprints: string
  waterSource: string
  powerLabel: string
  powerTypePlant: string
  powerTypeIncinerator: string
  powerTypeSub220: string
  powerTypeSub110: string
  powerTypeSub66: string
  powerTypeInlet: string
  powerInletNote: string
  powerNetworkNote: string
  powerLines: (n: number) => string
  powerLineVoltage: (kv: number) => string
  powerLegendDistribution: string
  powerOperatorCem: string
  powerOperatorDspa: string
  powerVoltage: string
  powerVoltageValue: (kv: number) => string
  powerApproximate: string
  powerCoLocatedWith: (name: string) => string
  powerBuildings: (n: number) => string
  powerFootprints: string
  powerUnits: string
  powerCapacity: string
  powerCommissioned: string
  powerCapacityMw: (mw: number) => string
  powerSource: string
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
