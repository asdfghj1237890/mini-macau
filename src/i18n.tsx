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
import type { InstallHintKey } from './pwaInstall'

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

// The add-to-home-screen card's one sentence per browser (see
// `pwaInstall.ts` for how the key is chosen). Menu item names follow each
// browser's own UI wording.
const INSTALL_HINTS_EN: Record<InstallHintKey, string> = {
  'ios-safari': 'In Safari, tap Share, then Add to Home Screen to open Mini Map Macau like an app.',
  'ios-chrome': 'In Chrome, tap Share, then Add to Home Screen to open Mini Map Macau like an app.',
  'ios-edge': 'In Edge, tap Share, then Add to Home Screen to open Mini Map Macau like an app.',
  'android-install': 'Tap Install to add Mini Map Macau to your home screen and open it like an app.',
  'android-chrome-menu': 'In Chrome, open the menu, then choose Install app or Add to Home screen.',
  'android-edge': 'In Edge for Android, open the menu, then choose Install app or Add to Home screen.',
  'android-firefox': 'In Firefox, open the menu, then choose Install or Add to Home screen.',
  'android-opera': 'In Opera, open the menu, then choose Install app or Add to Home screen.',
  'android-samsung': 'In Samsung Internet, open the menu, then choose Add page to → Home screen or Install app.',
  'android-huawei': 'In Huawei Browser, open the menu, then choose Add to Home screen or Install app.',
  'android-xiaomi': 'In Mi Browser, open the menu, then choose Add to Home screen or Install app.',
  'android-oppo': 'In OPPO / HeyTap Browser, open the menu, then choose Add to Home screen or Install app.',
  'android-vivo': 'In vivo Browser, open the menu, then choose Add to Home screen or Install app.',
  'android-honor': 'In HONOR Browser, open the menu, then choose Add to Home screen or Install app.',
}

const INSTALL_HINTS_ZH: Record<InstallHintKey, string> = {
  'ios-safari': '在 Safari 按分享按鈕，再選擇「加入主畫面」，即可像 App 一樣開啟 Mini Map Macau。',
  'ios-chrome': '在 Chrome 按分享按鈕，再選擇「加入主畫面」，即可像 App 一樣開啟 Mini Map Macau。',
  'ios-edge': '在 Edge 按分享按鈕，再選擇「加入主畫面」，即可像 App 一樣開啟 Mini Map Macau。',
  'android-install': '按「安裝」把 Mini Map Macau 加入主畫面，之後可像 App 一樣開啟。',
  'android-chrome-menu': '在 Chrome 開啟選單，再選擇「安裝應用程式」或「加入主畫面」。',
  'android-edge': '在 Android 版 Edge 開啟選單，再選擇「安裝應用程式」或「加入主畫面」。',
  'android-firefox': '在 Firefox 開啟選單，再選擇「安裝」或「加入主畫面」。',
  'android-opera': '在 Opera 開啟選單，再選擇「安裝應用程式」或「加入主畫面」。',
  'android-samsung': '在 Samsung Internet 開啟選單，再選擇「新增頁面至」→「主畫面」或「安裝應用程式」。',
  'android-huawei': '在華為瀏覽器開啟選單，再選擇「加入主畫面」或「安裝應用程式」。',
  'android-xiaomi': '在小米瀏覽器開啟選單，再選擇「加入主畫面」或「安裝應用程式」。',
  'android-oppo': '在 OPPO／HeyTap 瀏覽器開啟選單，再選擇「加入主畫面」或「安裝應用程式」。',
  'android-vivo': '在 vivo 瀏覽器開啟選單，再選擇「加入主畫面」或「安裝應用程式」。',
  'android-honor': '在 HONOR 瀏覽器開啟選單，再選擇「加入主畫面」或「安裝應用程式」。',
}

const INSTALL_HINTS_PT: Record<InstallHintKey, string> = {
  'ios-safari': 'No Safari, toque em Partilhar e depois em Adicionar ao ecrã principal para abrir o Mini Map Macau como uma app.',
  'ios-chrome': 'No Chrome, toque em Partilhar e depois em Adicionar ao ecrã principal para abrir o Mini Map Macau como uma app.',
  'ios-edge': 'No Edge, toque em Partilhar e depois em Adicionar ao ecrã principal para abrir o Mini Map Macau como uma app.',
  'android-install': 'Toque em Instalar para adicionar o Mini Map Macau ao ecrã principal e abri-lo como uma app.',
  'android-chrome-menu': 'No Chrome, abra o menu e escolha Instalar aplicação ou Adicionar ao ecrã principal.',
  'android-edge': 'No Edge para Android, abra o menu e escolha Instalar aplicação ou Adicionar ao ecrã principal.',
  'android-firefox': 'No Firefox, abra o menu e escolha Instalar ou Adicionar ao ecrã principal.',
  'android-opera': 'No Opera, abra o menu e escolha Instalar aplicação ou Adicionar ao ecrã principal.',
  'android-samsung': 'No Samsung Internet, abra o menu e escolha Adicionar página a → Ecrã principal ou Instalar aplicação.',
  'android-huawei': 'No Huawei Browser, abra o menu e escolha Adicionar ao ecrã principal ou Instalar aplicação.',
  'android-xiaomi': 'No Mi Browser, abra o menu e escolha Adicionar ao ecrã principal ou Instalar aplicação.',
  'android-oppo': 'No OPPO ou HeyTap Browser, abra o menu e escolha Adicionar ao ecrã principal ou Instalar aplicação.',
  'android-vivo': 'No vivo Browser, abra o menu e escolha Adicionar ao ecrã principal ou Instalar aplicação.',
  'android-honor': 'No HONOR Browser, abra o menu e escolha Adicionar ao ecrã principal ou Instalar aplicação.',
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
    schoolsRampHint: 'Shade = era founded',
    publicHousing: 'Public housing',
    publicHousingCount: (n: number) => `${n} estates`,
    publicHousingSocial: 'Social housing',
    publicHousingEconomic: 'Economic housing',
    publicHousingOther: 'Other public housing',
    publicHousingOtherHint: 'Elderly, replacement, temporary & sandwich-class housing',
    publicHousingCategory: 'CATEGORY',
    publicHousingCategoryElderly: 'Government elderly apartments',
    publicHousingCategoryReplacement: 'Replacement housing (urban renewal)',
    publicHousingCategoryTemporary: 'Temporary housing (urban renewal)',
    publicHousingCategorySandwich: 'Sandwich-class housing',
    publicHousingExpandTitle: 'Show or hide housing types',
    publicHousingToggleAllTitle: 'Toggle the whole layer',
    publicHousingRampHint: 'Shade = decade first occupied',
    cityFocusOneAtATime: 'one at a time',
    publicHousingFocusNote: 'Focus mode — every layer but the schools is hidden while this is on',
    parishes: 'Parishes',
    parishesCount: (n: number) => `${n} areas`,
    parishesTitle: 'Seven parishes and the Cotai reclamation zone',
    parishesTransitNote: 'Hides the LRT lines and bus routes while on',
    toilets: 'Public toilets',
    toiletsCount: (n: number) => `${n} toilets`,
    cityLayers: 'City layers',
    carParks: 'Public car parks',
    carParksCount: (n: number) => `${n} car parks`,
    water: 'Water supply',
    waterCount: (n: number) => `${n} facilities`,
    power: 'Electricity',
    powerCount: (n: number) => `${n} facilities`,
    grandPrix: 'Grand Prix circuit',
    grandPrixCount: (n: number) => `${n} named corners`,
    mapInitFailed: 'The map could not be displayed on this device.',
    mapRetry: 'Reload map',
    mapFallbackTitle: '2D compatibility map',
    mapFallbackNote: 'Graphics rendering failed. Showing routes and locations without 3D buildings or animated network flows.',
    waste: 'Waste & recycling',
    wasteCount: (n: number) => `${n} collection points`,
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
    dataSourcePublicHousingLabel: 'Public housing',
    dataSourceParishesLabel: 'Parishes',
    dataSourceToiletsLabel: 'Public toilets',
    dataSourceCarParksLabel: 'Car parks',
    dataSourceWaterLabel: 'Water supply',
    dataSourcePowerLabel: 'Electricity',
    dataSourceWasteLabel: 'Waste & recycling',
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
    schoolFounded: 'FOUNDED',
    schoolBuilding: 'BUILDING',
    schoolCampus: 'CAMPUS',
    schoolBuildings: (n: number) => `${n} building${n === 1 ? '' : 's'}`,
    schoolCode: 'DSEDJ CODE',
    schoolSource: 'SOURCE',
    // ---- PublicHousingInfoPanel ----
    publicHousingLabel: 'HOUSING',
    publicHousingDistrict: 'DISTRICT',
    publicHousingDistrictMacau: 'Macau Peninsula',
    publicHousingDistrictTaipa: 'Taipa',
    publicHousingDistrictColoane: 'Coloane',
    publicHousingAddress: 'ADDRESS',
    publicHousingYearLabel: 'YEAR',
    publicHousingOccupiedLabel: 'OCCUPIED',
    publicHousingCompletedLabel: 'COMPLETED',
    publicHousingExpectedLabel: 'EXPECTED',
    publicHousingStatus: 'STATUS',
    publicHousingStatusOccupied: 'Occupied',
    publicHousingStatusCompleted: 'Completed, not yet occupied',
    publicHousingStatusUnderConstruction: 'Under construction',
    publicHousingUnits: 'UNITS',
    publicHousingStoreys: 'STOREYS',
    publicHousingBuilding: 'BUILDING',
    publicHousingBlocks: 'BLOCKS',
    publicHousingFootprints: 'FOOTPRINTS',
    publicHousingBuildingsCount: (n: number) => `${n} building${n === 1 ? '' : 's'}`,
    publicHousingPartialNote: 'Only part of this estate is public housing',
    publicHousingSource: 'SOURCE',
    // ---- ParishInfoPanel ----
    parishLabel: 'PARISH',
    parishKind: 'KIND',
    parishKindParish: 'Civil parish',
    parishKindReclamation: 'Reclamation zone',
    parishIsland: 'ISLAND',
    parishIslandMacau: 'Macau Peninsula',
    parishIslandTaipa: 'Taipa',
    parishIslandColoane: 'Coloane',
    parishIslandCotai: 'Cotai',
    parishArea: 'AREA',
    parishPopulation: 'POPULATION',
    parishCensusYear: (n: number) => `${n} census`,
    parishDensity: 'DENSITY',
    parishSource: 'SOURCE',
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
    // the 22 facilities Macao Water lists. The share and import figure come
    // from Macao Water's 供澳原水 and 統計數據 pages via `facts`, not a
    // hard-coded percentage (see WaterFacts in types.ts).
    waterTypeInlet: 'Raw water inlet',
    waterInletNote: (facts: { minPct: number; year: number; importedM3: number } | null) =>
      facts
        ? `Over ${facts.minPct}% of Macau's raw water comes from the Xijiang's Modaomen waterway, delivered through Zhuhai; ${(facts.importedM3 / 1e6).toFixed(1)} million m³ were imported in ${facts.year}.`
        : 'Most of the raw water Macau uses comes from the Xijiang, delivered through Zhuhai.',
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
    // The bright wave on the map and the numbered chain in the legend: the
    // stages light in this order, inlet to street.
    waterPulse: 'Pulse: supply sequence ① → ⑦',
    waterStage: (n: number) => `Stage ${n}`,
    // An inlet whose real crossing is not published: the marker is a chosen
    // point, and the panel must say so before the reader trusts it.
    waterSchematicPosition: 'Schematic position',
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
    powerInletNote: (share: { pct: number; year: number } | null) =>
      share
        ? `Imported from the Guangdong grid: about ${share.pct}% of the electricity Macau used in ${share.year}.`
        : 'Imported from the Guangdong grid.',
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
    // The bright wave on the map and the numbered chain in the legend: the
    // stages light in this order, import point to street.
    powerPulse: 'Pulse: supply sequence ① → ⑤',
    powerStage: (n: number) => `Stage ${n}`,
    powerCoLocatedWith: (name: string) => `Sited at ${name}`,
    powerBuildings: (n: number) => `${n} footprint${n === 1 ? '' : 's'}`,
    powerFootprints: 'FOOTPRINTS',
    powerUnits: 'UNITS',
    powerCapacity: 'CAPACITY',
    powerCommissioned: 'IN SERVICE',
    powerCapacityMw: (mw: number) => `${mw} MW`,
    powerSource: 'SOURCE',
    // ---- GRAND PRIX overlay (the Guia Circuit) ----
    grandPrixLabel: 'GRAND PRIX',
    grandPrixCircuit: 'Circuit',
    grandPrixTrack: 'Racing line, in race direction',
    grandPrixPitLane: 'Pit lane',
    grandPrixWake: 'Wake: the 600 m behind the car, fading',
    // Legend rows are one line (~190 px at 10 px); the panel carries the
    // long form, so these stay short in all three languages.
    grandPrixCar: 'Car: laps on the clock, braking for corners',
    // The lap time is a secondary source (Wikipedia); the panel says so.
    grandPrixCarAtRecord: (time: string) => `Car: ${time} a lap, braking for corners`,
    // Shown wherever the corners are drawn or listed: the NAMES are the
    // organiser's, the POSITIONS are ours (it publishes no coordinates).
    grandPrixNote: 'Corner positions schematic',
    grandPrixCornerOrder: (n: number) => `No. ${n} in race order`,
    grandPrixKindStartFinish: 'Start / finish line',
    grandPrixKindBend: 'Corner',
    grandPrixKindSection: 'Section of track',
    grandPrixLength: 'LAP LENGTH',
    grandPrixLengthValue: (officialKm: number, measuredKm: number) =>
      `${officialKm} km official · ${measuredKm.toFixed(2)} km as drawn`,
    grandPrixMinWidth: 'MIN. WIDTH',
    grandPrixDirection: 'DIRECTION',
    grandPrixClockwise: 'Clockwise',
    grandPrixLapRecord: 'LAP RECORD',
    grandPrixLapRecordValue: (time: string, driver: string, year: number) => `${time} · ${driver}, ${year}`,
    grandPrixSecondarySource: 'Wikipedia figure, not from the organiser',
    grandPrixAtKm: (km: number) => `${km.toFixed(2)} km into the lap`,
    grandPrixSpanKm: (fromKm: number, toKm: number) => `km ${fromKm.toFixed(2)} – ${toKm.toFixed(2)} of the lap`,
    grandPrixApproximate: 'Schematic position',
    grandPrixApproximateNote: 'The organiser publishes no coordinates: this point was placed on the OpenStreetMap track by the rule below.',
    grandPrixRule: 'PLACEMENT RULE',
    grandPrixCorners: 'CORNERS',
    grandPrixSource: 'SOURCE',
    // ---- WASTE overlay (IAM + DSPA) ----
    wasteLabel: 'WASTE',
    wasteTypeRefuseRoom: 'Refuse room',
    wasteTypeCompactor: 'Compacting collection point',
    wasteTypeRefuseStation: 'Refuse collection station',
    wasteTypeSmartMachine: 'Smart recycling machine',
    wasteTypeThreeColour: 'Three-colour recycling point',
    wasteTypeEWaste: 'Computer & telecom equipment',
    wasteTypeLampBattery: 'Lamps & batteries',
    // IAM's two single-material banks, from its 環境資訊網 facility map.
    wasteTypeGlass: 'Glass bottle recycling point',
    wasteTypeClothing: 'Clothing recycling point',
    // The incineration plant — the seventh key row. Not a collection point:
    // it is where the six kinds above end up, read from the POWER dataset.
    wasteTypeIncinerator: 'Refuse incineration plant',
    wasteTypeEcoStation: 'Eco Fun Station',
    // The 處理設施 row: the incineration plant, the hazardous-waste station and
    // the two landfills, which the map toggles together.
    wasteTypeFacility: 'Treatment facilities',
    wasteTypeWwtp: 'Sewage treatment plant',
    // Shared statistics chart (DSPA monthly series).
    statsUnitTonnes: 't',
    statsUnitCubicMetres: 'm³',
    statsLatest: (period: string) => `Latest month ${period}`,
    statsNoData: 'DSPA publishes no monthly statistics for this facility',
    statsThroughput: 'THROUGHPUT',
    statsTreatedVolume: 'TREATED VOLUME',
    statsLandfilled: 'LANDFILLED',
    statsReceived: 'received',
    statsProcessed: 'processed',
    statsBasic: 'preliminary',
    statsBiological: 'biological + CEPT',
    statsTotal: 'total',
    statsMonthsAxis: (unit: string) => `Last 12 months (${unit})`,
    wasteKindHazardous: 'Hazardous waste station',
    wasteKindLandfill: 'Landfill',
    wasteHours: 'HOURS',
    wasteAccepts: 'ACCEPTS',
    wasteSince: 'OPEN SINCE',
    wasteApproximate: 'Approximate location',
    // Incinerator statistics block.
    wasteStatsElectricity: 'electricity',
    wasteStatsMetal: 'metal recovered',
    wasteStatsMwh: (n: string) => `${n} MWh`,
    wasteStatsFacts: (phases: string, lines: number, capacity: string, mw: number) =>
      `${phases} · ${lines} incineration lines · ~${capacity} t/day · ${mw} MW`,
    wasteStatsPhases: (years: string) => `Three phases (${years})`,
    wasteIncineratorNote: 'The government incineration plant at Pac On, Taipa. It burns Macau’s collected refuse and sells the electricity it generates to CEM through the Incinerator substation.',
    wasteOperatorDspa: 'Environmental Protection Bureau (DSPA) facility',
    wasteOperator: 'OPERATOR',
    // Shown under the six type rows: the counts are the whole published
    // register, not what is on screen at this zoom.
    wasteTypesHint: 'Tap a type to show or hide it',
    // WASTE is a focus mode like WATER and POWER: the row's tooltip and the
    // key's caption both carry what that means for the rest of the map.
    wasteFocusNote: 'Focus mode — every other layer is hidden while this is on',
    wasteExpandTitle: 'Show or hide the collection types',
    wasteToggleAllTitle: 'Toggle the whole layer',
    wasteClosed: 'Temporarily out of use',
    wasteAddress: 'ADDRESS',
    wasteTel: 'PHONE',
    wastePhoto: 'Photo',
    wasteUpdated: 'DATA UPDATED',
    wasteSource: 'SOURCE',
    wasteSourceIam: 'Municipal Affairs Bureau (IAM)',
    wasteSourceDspa: 'Environmental Protection Bureau (DSPA)',
    // ---- VehicleInfoPanel ----
    terminalStop: 'End',
    // ---- Add to Home Screen ----
    installAppTitle: 'Add to Home Screen',
    installAppMenu: 'Install app',
    installAppHint: (key: InstallHintKey) => INSTALL_HINTS_EN[key],
    installAppNow: 'Install',
    installAppLater: 'Later',
    installAppDismiss: 'Got it',
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
    schoolsRampHint: '深淺＝創校年代',
    publicHousing: '公共房屋',
    publicHousingCount: (n: number) => `${n} 個屋邨`,
    publicHousingSocial: '社會房屋',
    publicHousingEconomic: '經濟房屋',
    publicHousingOther: '其他公共房屋',
    publicHousingOtherHint: '長者公寓、置換房、暫住房、夾心房屋',
    publicHousingCategory: '類別',
    publicHousingCategoryElderly: '政府長者公寓',
    publicHousingCategoryReplacement: '置換房（都市更新）',
    publicHousingCategoryTemporary: '暫住房（都市更新）',
    publicHousingCategorySandwich: '夾心房屋',
    publicHousingExpandTitle: '展開／收合房屋類型',
    publicHousingToggleAllTitle: '開關整層',
    publicHousingRampHint: '深淺＝首次入伙年代',
    cityFocusOneAtATime: '一次只開一個',
    publicHousingFocusNote: '專注模式 — 開啟時除學校外其他圖層會隱藏',
    parishes: '堂區',
    parishesCount: (n: number) => `${n} 個區`,
    parishesTitle: '七個堂區及路氹填海區',
    parishesTransitNote: '開啟時隱藏輕軌與巴士路線',
    toilets: '公廁',
    toiletsCount: (n: number) => `${n} 間公廁`,
    cityLayers: '城市資料',
    carParks: '公共停車場',
    carParksCount: (n: number) => `${n} 個停車場`,
    water: '供水設施',
    waterCount: (n: number) => `${n} 項供水設施`,
    power: '電力設施',
    powerCount: (n: number) => `${n} 項電力設施`,
    grandPrix: '大賽車跑道',
    grandPrixCount: (n: number) => `${n} 個官方彎道`,
    mapInitFailed: '此裝置目前無法顯示地圖。',
    mapRetry: '重新載入地圖',
    mapFallbackTitle: '2D 相容地圖',
    mapFallbackNote: '圖形渲染失敗，改用平面路線與位置標記；不顯示 3D 建築與管網流動動畫。',
    waste: '垃圾回收',
    wasteCount: (n: number) => `${n} 個回收／收集點`,
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
    dataSourcePublicHousingLabel: '公共房屋',
    dataSourceParishesLabel: '堂區',
    dataSourceToiletsLabel: '公廁',
    dataSourceCarParksLabel: '停車場',
    dataSourceWaterLabel: '供水設施',
    dataSourcePowerLabel: '電力',
    dataSourceWasteLabel: '垃圾回收',
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
    schoolFounded: '創校',
    schoolBuilding: '樓宇',
    schoolCampus: '校舍',
    schoolBuildings: (n: number) => `${n} 棟建築`,
    schoolCode: '教青局編號',
    schoolSource: '來源',
    // ---- PublicHousingInfoPanel ----
    publicHousingLabel: '居屋',
    publicHousingDistrict: '地區',
    publicHousingDistrictMacau: '澳門半島',
    publicHousingDistrictTaipa: '氹仔',
    publicHousingDistrictColoane: '路環',
    publicHousingAddress: '地址',
    publicHousingYearLabel: '年份',
    publicHousingOccupiedLabel: '入伙',
    publicHousingCompletedLabel: '落成',
    publicHousingExpectedLabel: '預計',
    publicHousingStatus: '狀態',
    publicHousingStatusOccupied: '已入伙',
    publicHousingStatusCompleted: '已落成，尚未入伙',
    publicHousingStatusUnderConstruction: '興建中',
    publicHousingUnits: '單位',
    publicHousingStoreys: '層數',
    publicHousingBuilding: '樓宇',
    publicHousingBlocks: '座數',
    publicHousingFootprints: '建築',
    publicHousingBuildingsCount: (n: number) => `${n} 棟建築`,
    publicHousingPartialNote: '僅部分單位屬公共房屋',
    publicHousingSource: '來源',
    parishLabel: '堂區',
    parishKind: '類型',
    // 民政堂區, not bare 堂區: the panel's signboard already says 堂區, and the
    // civil parish is what this means (the ecclesiastical parish is a different
    // thing that shares the word). Mirrors the English "Civil parish".
    parishKindParish: '民政堂區',
    parishKindReclamation: '填海區',
    parishIsland: '所在',
    parishIslandMacau: '澳門半島',
    parishIslandTaipa: '氹仔',
    parishIslandColoane: '路環',
    parishIslandCotai: '路氹城',
    parishArea: '面積',
    parishPopulation: '人口',
    parishCensusYear: (n: number) => `${n} 年人口普查`,
    parishDensity: '人口密度',
    parishSource: '來源',
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
    waterInletNote: (facts: { minPct: number; year: number; importedM3: number } | null) =>
      facts
        ? `澳門逾 ${facts.minPct}% 的原水來自西江磨刀門水道，經珠海輸澳；${facts.year} 年輸入原水 ${(facts.importedM3 / 1e8).toFixed(2)} 億立方米。`
        : '澳門的原水主要取自西江，經珠海輸澳。',
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
    waterPulse: '脈衝：供水順序 ① → ⑦',
    waterStage: (n: number) => `第 ${n} 階段`,
    waterSchematicPosition: '示意位置',
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
    powerInletNote: (share: { pct: number; year: number } | null) =>
      share
        ? `廣東電網輸入 · ${share.year} 年約 ${share.pct}% 用電來自輸入。`
        : '廣東電網輸入。',
    powerNetworkNote: '電網為示意',
    powerLines: (n: number) => `連接 ${n} 條線路`,
    powerLineVoltage: (kv: number) => `${kv} kV 線路`,
    powerLegendDistribution: '配電網（示意，沿全澳道路）',
    powerOperatorCem: '澳門電力股份有限公司（澳電）設施',
    powerOperatorDspa: '政府垃圾焚化中心 · 售電予澳電',
    powerVoltage: '電壓',
    powerVoltageValue: (kv: number) => `${kv} kV`,
    powerApproximate: '約略位置',
    powerPulse: '脈衝：供電順序 ① → ⑤',
    powerStage: (n: number) => `第 ${n} 階段`,
    powerCoLocatedWith: (name: string) => `位於${name}`,
    powerBuildings: (n: number) => `${n} 個範圍`,
    powerFootprints: '建築範圍',
    powerUnits: '機組',
    powerCapacity: '裝機容量',
    powerCommissioned: '投產年份',
    powerCapacityMw: (mw: number) => `${mw} MW`,
    powerSource: '來源',
    grandPrixLabel: '大賽車',
    grandPrixCircuit: '賽道',
    grandPrixTrack: '賽道線（依比賽方向）',
    grandPrixPitLane: '維修道',
    grandPrixWake: '尾流：賽車後方 600 m 漸隱',
    grandPrixCar: '賽車：依模擬時鐘繞圈，彎道減速',
    grandPrixCarAtRecord: (time: string) => `賽車：一圈 ${time}，彎道減速`,
    grandPrixNote: '彎道位置為示意',
    grandPrixCornerOrder: (n: number) => `比賽順序第 ${n}`,
    grandPrixKindStartFinish: '起點／終點線',
    grandPrixKindBend: '彎道',
    grandPrixKindSection: '路段',
    grandPrixLength: '圈長',
    grandPrixLengthValue: (officialKm: number, measuredKm: number) =>
      `官方 ${officialKm} km · 圖上 ${measuredKm.toFixed(2)} km`,
    grandPrixMinWidth: '最窄寬度',
    grandPrixDirection: '方向',
    grandPrixClockwise: '順時針',
    grandPrixLapRecord: '最快圈速',
    grandPrixLapRecordValue: (time: string, driver: string, year: number) => `${time} · ${driver}，${year} 年`,
    grandPrixSecondarySource: '數字取自維基百科，非主辦單位',
    grandPrixAtKm: (km: number) => `距起點 ${km.toFixed(2)} km`,
    grandPrixSpanKm: (fromKm: number, toKm: number) => `距起點 ${fromKm.toFixed(2)} – ${toKm.toFixed(2)} km`,
    grandPrixApproximate: '位置為示意',
    grandPrixApproximateNote: '主辦單位未公布彎道座標：此點依下列規則置於 OpenStreetMap 的賽道線上。',
    grandPrixRule: '定位規則',
    grandPrixCorners: '彎道',
    grandPrixSource: '來源',
    wasteLabel: '垃圾回收',
    wasteTypeRefuseRoom: '垃圾房',
    wasteTypeCompactor: '壓縮式垃圾收集點',
    wasteTypeRefuseStation: '垃圾站',
    wasteTypeSmartMachine: '智能回收機',
    wasteTypeThreeColour: '三色資源回收點',
    wasteTypeEWaste: '電腦及通訊設備回收點',
    wasteTypeLampBattery: '光管及電池回收點',
    wasteTypeGlass: '玻璃樽回收點',
    wasteTypeClothing: '衣物回收點',
    wasteTypeIncinerator: '垃圾焚化中心',
    wasteTypeEcoStation: '環保加Fun站',
    wasteTypeFacility: '處理設施',
    wasteTypeWwtp: '污水處理廠',
    statsUnitTonnes: '公噸',
    statsUnitCubicMetres: 'm³',
    statsLatest: (period: string) => `最新月份 ${period}`,
    statsNoData: '環境保護局未有公佈此設施的每月數據',
    statsThroughput: '處理量',
    statsTreatedVolume: '污水處理量',
    statsLandfilled: '每月堆埋體積',
    statsReceived: '接收',
    statsProcessed: '處理',
    statsBasic: '基本處理',
    statsBiological: '生物處理及 CEPT',
    statsTotal: '合計',
    statsMonthsAxis: (unit: string) => `近 12 個月（${unit}）`,
    wasteKindHazardous: '危險廢物處理站',
    wasteKindLandfill: '堆填區',
    wasteHours: '開放時間',
    wasteAccepts: '回收種類',
    wasteSince: '啟用年份',
    wasteApproximate: '約略位置',
    wasteStatsElectricity: '發電',
    wasteStatsMetal: '回收金屬',
    wasteStatsMwh: (n: string) => `${n} MWh`,
    wasteStatsFacts: (phases: string, lines: number, capacity: string, mw: number) =>
      `${phases} · ${lines} 條焚化線 · 約 ${capacity} 公噸／日 · ${mw} MW`,
    wasteStatsPhases: (years: string) => `三期（${years}）`,
    wasteIncineratorNote: '政府設於氹仔北安的垃圾焚化中心，焚燒全澳收集的垃圾，並透過焚化爐變電站將所發電力售予澳電。',
    wasteOperatorDspa: '環境保護局 (DSPA) 設施',
    wasteOperator: '營運',
    wasteTypesHint: '點擊類別以顯示或隱藏',
    wasteFocusNote: '專注模式 — 開啟時其他圖層會隱藏',
    wasteExpandTitle: '顯示或隱藏回收類別',
    wasteToggleAllTitle: '開關整個圖層',
    wasteClosed: '暫停使用',
    wasteAddress: '地址',
    wasteTel: '電話',
    wastePhoto: '相片',
    wasteUpdated: '資料更新',
    wasteSource: '來源',
    wasteSourceIam: '市政署 (IAM)',
    wasteSourceDspa: '環境保護局 (DSPA)',
    terminalStop: '終站',
    installAppTitle: '加入主畫面',
    installAppMenu: '安裝 App',
    installAppHint: (key: InstallHintKey) => INSTALL_HINTS_ZH[key],
    installAppNow: '安裝',
    installAppLater: '稍後',
    installAppDismiss: '知道了',
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
    schoolsRampHint: 'Tom = época de fundação',
    publicHousing: 'Habitação pública',
    publicHousingCount: (n: number) => `${n} conjuntos`,
    publicHousingSocial: 'Habitação social',
    publicHousingEconomic: 'Habitação económica',
    publicHousingOther: 'Outra habitação pública',
    publicHousingOtherHint: 'Idosos, substituição, temporária e classe intermédia',
    publicHousingCategory: 'CATEGORIA',
    publicHousingCategoryElderly: 'Residência do Governo para Idosos',
    publicHousingCategoryReplacement: 'Habitação de substituição (renovação urbana)',
    publicHousingCategoryTemporary: 'Habitação temporária (renovação urbana)',
    publicHousingCategorySandwich: 'Habitação intermédia (classe sanduíche)',
    publicHousingExpandTitle: 'Mostrar ou ocultar tipos de habitação',
    publicHousingToggleAllTitle: 'Ligar ou desligar a camada',
    publicHousingRampHint: 'Tom = década da primeira ocupação',
    cityFocusOneAtATime: 'um de cada vez',
    publicHousingFocusNote: 'Modo de foco — todas as camadas ficam ocultas, exceto as escolas',
    parishes: 'Freguesias',
    parishesCount: (n: number) => `${n} áreas`,
    parishesTitle: 'Sete freguesias e a zona de aterros do Cotai',
    parishesTransitNote: 'Oculta as linhas do metro ligeiro e dos autocarros enquanto activo',
    toilets: 'Sanitários públicos',
    toiletsCount: (n: number) => `${n} sanitários`,
    cityLayers: 'Camadas urbanas',
    carParks: 'Parques de estacionamento',
    carParksCount: (n: number) => `${n} parques`,
    water: 'Abastecimento de água',
    waterCount: (n: number) => `${n} instalações`,
    power: 'Electricidade',
    powerCount: (n: number) => `${n} instalações`,
    grandPrix: 'Circuito do Grande Prémio',
    grandPrixCount: (n: number) => `${n} curvas oficiais`,
    mapInitFailed: 'Não foi possível apresentar o mapa neste dispositivo.',
    mapRetry: 'Recarregar mapa',
    mapFallbackTitle: 'Mapa 2D de compatibilidade',
    mapFallbackNote: 'Falha na renderização gráfica. A mostrar percursos e localizações, sem edifícios 3D nem fluxos de rede animados.',
    waste: 'Resíduos e reciclagem',
    wasteCount: (n: number) => `${n} pontos de recolha`,
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
    dataSourcePublicHousingLabel: 'Habitação pública',
    dataSourceParishesLabel: 'Freguesias',
    dataSourceToiletsLabel: 'Sanitários',
    dataSourceCarParksLabel: 'Estacionamentos',
    dataSourceWaterLabel: 'Abastecimento de água',
    dataSourcePowerLabel: 'Electricidade',
    dataSourceWasteLabel: 'Resíduos e reciclagem',
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
    schoolFounded: 'FUNDAÇÃO',
    schoolBuilding: 'EDIFÍCIO',
    schoolCampus: 'CAMPUS',
    schoolBuildings: (n: number) => `${n} edifício${n === 1 ? '' : 's'}`,
    schoolCode: 'CÓDIGO DSEDJ',
    schoolSource: 'FONTE',
    // ---- PublicHousingInfoPanel ----
    publicHousingLabel: 'HABITAÇÃO',
    publicHousingDistrict: 'ZONA',
    publicHousingDistrictMacau: 'Península de Macau',
    publicHousingDistrictTaipa: 'Taipa',
    publicHousingDistrictColoane: 'Coloane',
    publicHousingAddress: 'ENDEREÇO',
    publicHousingYearLabel: 'ANO',
    publicHousingOccupiedLabel: 'OCUPAÇÃO',
    publicHousingCompletedLabel: 'CONCLUSÃO',
    publicHousingExpectedLabel: 'PREVISTO',
    publicHousingStatus: 'ESTADO',
    publicHousingStatusOccupied: 'Ocupado',
    publicHousingStatusCompleted: 'Concluído, ainda não ocupado',
    publicHousingStatusUnderConstruction: 'Em construção',
    publicHousingUnits: 'FRACÇÕES',
    publicHousingStoreys: 'PISOS',
    publicHousingBuilding: 'EDIFÍCIO',
    publicHousingBlocks: 'BLOCOS',
    publicHousingFootprints: 'EDIFÍCIOS',
    publicHousingBuildingsCount: (n: number) => `${n} edifício${n === 1 ? '' : 's'}`,
    publicHousingPartialNote: 'Apenas parte deste conjunto é habitação pública',
    publicHousingSource: 'FONTE',
    parishLabel: 'FREGUESIA',
    parishKind: 'TIPO',
    parishKindParish: 'Freguesia',
    parishKindReclamation: 'Zona de aterros',
    parishIsland: 'ILHA',
    parishIslandMacau: 'Península de Macau',
    parishIslandTaipa: 'Taipa',
    parishIslandColoane: 'Coloane',
    parishIslandCotai: 'Cotai',
    parishArea: 'ÁREA',
    parishPopulation: 'POPULAÇÃO',
    parishCensusYear: (n: number) => `Censos de ${n}`,
    parishDensity: 'DENSIDADE',
    parishSource: 'FONTE',
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
    waterInletNote: (facts: { minPct: number; year: number; importedM3: number } | null) =>
      facts
        ? `Mais de ${facts.minPct}% da água bruta de Macau vem do canal de Modaomen do rio Xijiang, através de Zhuhai; em ${facts.year} foram importados ${(facts.importedM3 / 1e6).toFixed(1)} milhões de m³.`
        : 'A maior parte da água bruta usada em Macau vem do rio Xijiang, através de Zhuhai.',
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
    waterPulse: 'Impulso: sequência de abastecimento ① → ⑦',
    waterStage: (n: number) => `Fase ${n}`,
    waterSchematicPosition: 'Posição esquemática',
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
    powerInletNote: (share: { pct: number; year: number } | null) =>
      share
        ? `Importação da rede de Guangdong: cerca de ${share.pct}% da electricidade usada em Macau em ${share.year}.`
        : 'Importação da rede de Guangdong.',
    powerNetworkNote: 'Rede eléctrica esquemática',
    powerLines: (n: number) => `${n} linha${n === 1 ? '' : 's'} ligada${n === 1 ? '' : 's'}`,
    powerLineVoltage: (kv: number) => `Linha de ${kv} kV`,
    powerLegendDistribution: 'Rede de distribuição (esquemática, ao longo das vias)',
    powerOperatorCem: 'Instalação da CEM (Companhia de Electricidade de Macau)',
    powerOperatorDspa: 'Central de incineração do Governo · vende energia à CEM',
    powerVoltage: 'TENSÃO',
    powerVoltageValue: (kv: number) => `${kv} kV`,
    powerApproximate: 'Localização aproximada',
    powerPulse: 'Impulso: sequência de alimentação ① → ⑤',
    powerStage: (n: number) => `Fase ${n}`,
    powerCoLocatedWith: (name: string) => `Junto a ${name}`,
    powerBuildings: (n: number) => `${n} implantaç${n === 1 ? 'ão' : 'ões'}`,
    powerFootprints: 'IMPLANTAÇÕES',
    powerUnits: 'GRUPOS',
    powerCapacity: 'CAPACIDADE',
    powerCommissioned: 'EM SERVIÇO',
    powerCapacityMw: (mw: number) => `${mw} MW`,
    powerSource: 'FONTE',
    grandPrixLabel: 'GRANDE PRÉMIO',
    grandPrixCircuit: 'Circuito',
    grandPrixTrack: 'Traçado, no sentido da corrida',
    grandPrixPitLane: 'Via das boxes',
    grandPrixWake: 'Rasto: os 600 m atrás do carro, a desvanecer',
    grandPrixCar: 'Carro: volta ao relógio, trava nas curvas',
    grandPrixCarAtRecord: (time: string) => `Carro: volta ${time}, trava nas curvas`,
    grandPrixNote: 'Posição das curvas esquemática',
    grandPrixCornerOrder: (n: number) => `N.º ${n} na ordem da corrida`,
    grandPrixKindStartFinish: 'Linha de partida / chegada',
    grandPrixKindBend: 'Curva',
    grandPrixKindSection: 'Troço',
    grandPrixLength: 'EXTENSÃO',
    grandPrixLengthValue: (officialKm: number, measuredKm: number) =>
      `${officialKm} km oficial · ${measuredKm.toFixed(2)} km desenhado`,
    grandPrixMinWidth: 'LARGURA MÍN.',
    grandPrixDirection: 'SENTIDO',
    grandPrixClockwise: 'Sentido horário',
    grandPrixLapRecord: 'RECORDE',
    grandPrixLapRecordValue: (time: string, driver: string, year: number) => `${time} · ${driver}, ${year}`,
    grandPrixSecondarySource: 'Valor da Wikipédia, não do organizador',
    grandPrixAtKm: (km: number) => `${km.toFixed(2)} km após a partida`,
    grandPrixSpanKm: (fromKm: number, toKm: number) => `km ${fromKm.toFixed(2)} – ${toKm.toFixed(2)} da volta`,
    grandPrixApproximate: 'Posição esquemática',
    grandPrixApproximateNote: 'O organizador não publica coordenadas: este ponto foi colocado no traçado do OpenStreetMap pela regra abaixo.',
    grandPrixRule: 'REGRA DE POSIÇÃO',
    grandPrixCorners: 'CURVAS',
    grandPrixSource: 'FONTE',
    wasteLabel: 'RESÍDUOS',
    wasteTypeRefuseRoom: 'Depósito de lixo',
    wasteTypeCompactor: 'Ponto de recolha compactada',
    wasteTypeRefuseStation: 'Posto de recolha de lixo',
    wasteTypeSmartMachine: 'Máquina de reciclagem inteligente',
    wasteTypeThreeColour: 'Ponto de reciclagem tricolor',
    wasteTypeEWaste: 'Equipamento informático e de telecomunicações',
    wasteTypeLampBattery: 'Lâmpadas e pilhas',
    wasteTypeGlass: 'Ponto de recolha de garrafas de vidro',
    wasteTypeClothing: 'Ponto de recolha de roupa',
    wasteTypeIncinerator: 'Central de incineração de resíduos',
    wasteTypeEcoStation: 'Centro Ambiental Alegria',
    wasteTypeFacility: 'Instalações de tratamento',
    wasteTypeWwtp: 'ETAR',
    statsUnitTonnes: 't',
    statsUnitCubicMetres: 'm³',
    statsLatest: (period: string) => `Mês mais recente ${period}`,
    statsNoData: 'A DSPA não publica estatísticas mensais desta instalação',
    statsThroughput: 'TRATAMENTO',
    statsTreatedVolume: 'VOLUME TRATADO',
    statsLandfilled: 'VOLUME DEPOSITADO',
    statsReceived: 'recebido',
    statsProcessed: 'tratado',
    statsBasic: 'preliminar',
    statsBiological: 'biológico + CEPT',
    statsTotal: 'total',
    statsMonthsAxis: (unit: string) => `Últimos 12 meses (${unit})`,
    wasteKindHazardous: 'Estação de resíduos perigosos',
    wasteKindLandfill: 'Aterro',
    wasteHours: 'HORÁRIO',
    wasteAccepts: 'ACEITA',
    wasteSince: 'EM SERVIÇO DESDE',
    wasteApproximate: 'Localização aproximada',
    wasteStatsElectricity: 'electricidade',
    wasteStatsMetal: 'metal recuperado',
    wasteStatsMwh: (n: string) => `${n} MWh`,
    wasteStatsFacts: (phases: string, lines: number, capacity: string, mw: number) =>
      `${phases} · ${lines} linhas de incineração · ~${capacity} t/dia · ${mw} MW`,
    wasteStatsPhases: (years: string) => `Três fases (${years})`,
    wasteIncineratorNote: 'Central de incineração do Governo em Pac On, Taipa. Queima os resíduos recolhidos em Macau e vende a electricidade produzida à CEM através da subestação da incineradora.',
    wasteOperatorDspa: 'Instalação da Direcção dos Serviços de Protecção Ambiental (DSPA)',
    wasteOperator: 'OPERADOR',
    wasteTypesHint: 'Toque num tipo para mostrar ou esconder',
    wasteFocusNote: 'Modo de foco — as outras camadas ficam ocultas',
    wasteExpandTitle: 'Mostrar ou esconder os tipos de recolha',
    wasteToggleAllTitle: 'Ligar ou desligar toda a camada',
    wasteClosed: 'Temporariamente fora de serviço',
    wasteAddress: 'MORADA',
    wasteTel: 'TELEFONE',
    wastePhoto: 'Foto',
    wasteUpdated: 'DADOS ACTUALIZADOS',
    wasteSource: 'FONTE',
    wasteSourceIam: 'Instituto para os Assuntos Municipais (IAM)',
    wasteSourceDspa: 'Direcção dos Serviços de Protecção Ambiental (DSPA)',
    terminalStop: 'Terminal',
    installAppTitle: 'Adicionar ao ecrã principal',
    installAppMenu: 'Instalar app',
    installAppHint: (key: InstallHintKey) => INSTALL_HINTS_PT[key],
    installAppNow: 'Instalar',
    installAppLater: 'Mais tarde',
    installAppDismiss: 'Entendido',
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
  schoolsRampHint: string
  publicHousing: string
  publicHousingCount: (n: number) => string
  publicHousingSocial: string
  publicHousingEconomic: string
  publicHousingOther: string
  publicHousingOtherHint: string
  publicHousingCategory: string
  publicHousingCategoryElderly: string
  publicHousingCategoryReplacement: string
  publicHousingCategoryTemporary: string
  publicHousingCategorySandwich: string
  publicHousingExpandTitle: string
  publicHousingToggleAllTitle: string
  publicHousingRampHint: string
  cityFocusOneAtATime: string
  publicHousingFocusNote: string
  parishes: string
  parishesCount: (n: number) => string
  parishesTitle: string
  parishesTransitNote: string
  toilets: string
  toiletsCount: (n: number) => string
  cityLayers: string
  carParks: string
  carParksCount: (n: number) => string
  water: string
  waterCount: (n: number) => string
  power: string
  powerCount: (n: number) => string
  grandPrix: string
  grandPrixCount: (n: number) => string
  mapInitFailed: string
  mapRetry: string
  mapFallbackTitle: string
  mapFallbackNote: string
  waste: string
  wasteCount: (n: number) => string
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
  dataSourcePublicHousingLabel: string
  dataSourceParishesLabel: string
  dataSourceToiletsLabel: string
  dataSourceCarParksLabel: string
  dataSourceWaterLabel: string
  dataSourcePowerLabel: string
  dataSourceWasteLabel: string
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
  schoolFounded: string
  schoolBuilding: string
  schoolCampus: string
  schoolBuildings: (n: number) => string
  schoolCode: string
  schoolSource: string
  // ---- PublicHousingInfoPanel ----
  publicHousingLabel: string
  publicHousingDistrict: string
  publicHousingDistrictMacau: string
  publicHousingDistrictTaipa: string
  publicHousingDistrictColoane: string
  publicHousingAddress: string
  publicHousingYearLabel: string
  publicHousingOccupiedLabel: string
  publicHousingCompletedLabel: string
  publicHousingExpectedLabel: string
  publicHousingStatus: string
  publicHousingStatusOccupied: string
  publicHousingStatusCompleted: string
  publicHousingStatusUnderConstruction: string
  publicHousingUnits: string
  publicHousingStoreys: string
  publicHousingBuilding: string
  publicHousingBlocks: string
  publicHousingFootprints: string
  publicHousingBuildingsCount: (n: number) => string
  publicHousingPartialNote: string
  publicHousingSource: string
  // ---- ParishInfoPanel ----
  parishLabel: string
  parishKind: string
  parishKindParish: string
  parishKindReclamation: string
  parishIsland: string
  parishIslandMacau: string
  parishIslandTaipa: string
  parishIslandColoane: string
  parishIslandCotai: string
  parishArea: string
  parishPopulation: string
  parishCensusYear: (n: number) => string
  parishDensity: string
  parishSource: string
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
  waterInletNote: (facts: { minPct: number; year: number; importedM3: number } | null) => string
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
  waterPulse: string
  waterStage: (n: number) => string
  waterSchematicPosition: string
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
  powerInletNote: (share: { pct: number; year: number } | null) => string
  powerNetworkNote: string
  powerLines: (n: number) => string
  powerLineVoltage: (kv: number) => string
  powerLegendDistribution: string
  powerOperatorCem: string
  powerOperatorDspa: string
  powerVoltage: string
  powerVoltageValue: (kv: number) => string
  powerApproximate: string
  powerPulse: string
  powerStage: (n: number) => string
  powerCoLocatedWith: (name: string) => string
  powerBuildings: (n: number) => string
  powerFootprints: string
  powerUnits: string
  powerCapacity: string
  powerCommissioned: string
  powerCapacityMw: (mw: number) => string
  powerSource: string
  grandPrixLabel: string
  grandPrixCircuit: string
  grandPrixTrack: string
  grandPrixPitLane: string
  grandPrixWake: string
  grandPrixCar: string
  grandPrixCarAtRecord: (time: string) => string
  grandPrixNote: string
  grandPrixCornerOrder: (n: number) => string
  grandPrixKindStartFinish: string
  grandPrixKindBend: string
  grandPrixKindSection: string
  grandPrixLength: string
  grandPrixLengthValue: (officialKm: number, measuredKm: number) => string
  grandPrixMinWidth: string
  grandPrixDirection: string
  grandPrixClockwise: string
  grandPrixLapRecord: string
  grandPrixLapRecordValue: (time: string, driver: string, year: number) => string
  grandPrixSecondarySource: string
  grandPrixAtKm: (km: number) => string
  grandPrixSpanKm: (fromKm: number, toKm: number) => string
  grandPrixApproximate: string
  grandPrixApproximateNote: string
  grandPrixRule: string
  grandPrixCorners: string
  grandPrixSource: string
  wasteLabel: string
  wasteTypeRefuseRoom: string
  wasteTypeCompactor: string
  wasteTypeRefuseStation: string
  wasteTypeSmartMachine: string
  wasteTypeThreeColour: string
  wasteTypeEWaste: string
  wasteTypeLampBattery: string
  wasteTypeGlass: string
  wasteTypeClothing: string
  wasteTypeIncinerator: string
  wasteTypeEcoStation: string
  wasteTypeFacility: string
  wasteTypeWwtp: string
  statsUnitTonnes: string
  statsUnitCubicMetres: string
  statsLatest: (period: string) => string
  statsNoData: string
  statsThroughput: string
  statsTreatedVolume: string
  statsLandfilled: string
  statsReceived: string
  statsProcessed: string
  statsBasic: string
  statsBiological: string
  statsTotal: string
  statsMonthsAxis: (unit: string) => string
  wasteKindHazardous: string
  wasteKindLandfill: string
  wasteHours: string
  wasteAccepts: string
  wasteSince: string
  wasteApproximate: string
  wasteStatsElectricity: string
  wasteStatsMetal: string
  wasteStatsMwh: (n: string) => string
  wasteStatsFacts: (phases: string, lines: number, capacity: string, mw: number) => string
  wasteStatsPhases: (years: string) => string
  wasteIncineratorNote: string
  wasteOperatorDspa: string
  wasteOperator: string
  wasteTypesHint: string
  wasteFocusNote: string
  wasteExpandTitle: string
  wasteToggleAllTitle: string
  wasteClosed: string
  wasteAddress: string
  wasteTel: string
  wastePhoto: string
  wasteUpdated: string
  wasteSource: string
  wasteSourceIam: string
  wasteSourceDspa: string
  terminalStop: string
  installAppTitle: string
  installAppMenu: string
  installAppHint: (key: InstallHintKey) => string
  installAppNow: string
  installAppLater: string
  installAppDismiss: string
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
