// Native, unrotated scan pixels. Main-map features only: never register an inset.
const atlas = {
  author: 'Comissão de Cartografia, Ministério das Colónias', year: 1912, published: 1912,
  lambda: 0, resM: 2.5, marginKm: 2, gcpSpace: 'sheet', tiles: { maxzoom: 16 },
}
const bnp = (page) => ({
  holder: 'Biblioteca Nacional de Portugal', via: 'Biblioteca Nacional Digital',
  identifier: `ca-88-a / catalogue 280142 / purl.pt/27811 / page ${page}`,
  url: `https://permalinkbnd.bnportugal.gov.pt/viewer/14533/?offset=#page=${page}&viewer=picture`, leaves: [String(page)],
  license: 'Public domain — Biblioteca Nacional de Portugal marks the digitised content freely reusable, Public Domain Mark 1.0.',
})
const atlasSource = (island, page, width, height) => ({
  kind: 'sheet', file: `bnp-1912-${island}.png`, iiif: { width, height },
  url: `https://permalinkbnd.bnportugal.gov.pt/i/?IIIF=/c1/e7/80/ba/c1e780ba-5760-4e90-b758-d8b9c56db9c7/iiif/ca-88-a_0000_capa-capa_t24-C-R0150_${String(page).padStart(6, '0')}.tif`,
  registrationOrigin: [0, 0], shrink: 2,
})
const atlasReferences = [
  { name: 'BNP — Atlas de Macau, catalogue and public-domain statement', url: 'https://permalinkbnd.bnportugal.gov.pt/en/records/item/14533-atlas-de-macau' },
  { name: 'AHU — map titles, dates and scales', url: 'https://ahu.dglab.gov.pt/wp-content/uploads/sites/24/2016/09/PT-AHU-CARTI-MACAU.pdf' },
  { name: 'OpenStreetMap — reference coordinates', url: 'https://www.openstreetmap.org/copyright' },
]

export const TAIPA_1912 = {
  ...atlas, id: 'taipa-1912',
  // Same-year historical land outlines; keep all five interior landmarks fixed.
  coastSnap: { radiusM: 700, steps: 32 },
  name: { zh: '氹仔群島圖', en: 'Islands of Taipa', pt: 'Ilhas da Taipa' },
  title: { zh: '氹仔群島略圖（1912，1:10,000）', en: 'Esboço das Ilhas da Taipa (1912, 1:10,000)', pt: 'Esboço das Ilhas da Taipa (1912, 1:10.000)' },
  work: 'Atlas de Macau — Esboço das Ilhas da Taipa, 1:10,000',
  scan: bnp(5), references: [
    ...atlasReferences,
    { name: 'Cultural Affairs Bureau — Taipa Fortress, surviving plan and barracks', url: 'https://www.gcs.gov.mo/news/detail/zh-hans/M21LItBoMQ' },
    { name: 'OpenStreetMap — Taipa Fortress grounds (Scout Association headquarters)', url: 'https://www.openstreetmap.org/way/1018716374' },
    { name: 'Cultural Affairs Bureau — Kuan Tai and Tin Hau Temple, MT008', url: 'https://www.culturalheritage.mo/detail/100002' },
    { name: 'Cultural Affairs Bureau — Taipa heritage locations and buffer zones', url: 'https://www.culturalheritage.mo/map' },
    { name: 'DSSCU Macau Webmap — 1912 land extent, Evolution since the 20th century', url: 'https://webmap.gis.gov.mo/MapGIS/index.html' },
    { name: 'DSSCU — Macao Grid / WGS84 transformation parameters', url: 'https://geomatics.dsscu.gov.mo/files/geographical_geodetic_control/ENG/Macaucoord_2009_web_EN_v201702.pdf' },
  ],
  source: atlasSource('taipa', 5, 4528, 6046),
  gcps: [
    ['Taipa Grande 大潭山', 2586, 2375, 113.5657964, 22.1588902, 'centre of the 160 m summit hachures; OSM n2992376894, approximate historical symbol'],
    // The former pixel 2130,4170 is labelled 77 m on the scan. Its identity as
    // today's 110 m summit is unverified; use the explicitly named fort instead.
    ['Fortaleza da Taipa 氹仔炮台', 2788, 5250, 113.54234344, 22.15717038, 'centre of the labelled irregular fort enclosure; surviving fortress grounds, OSM w1018716374; approximate historical outline, not the modern barracks centroid'],
    ['Carmo 嘉模聖母堂', 3390, 3320, 'MT001', null, 'rectangular building with crossed diagonals on the village hill; IC heritage coordinates'],
    ['Kun Iam 觀音岩', 1716, 3184, 113.555999, 22.164341, 'building within the labelled Pagode de Cuna Miu enclosure on the north shore; OSM w681663121 (not the Kuan Tai temple in Chok Ka village)'],
    // Quanta Miu is the separate temple immediately north of Choc-ca village.
    // Read the western connected footprint beside that label, not the label text.
    // The small historical building symbol is approximate, not survey precision.
    ['Kuan Tai 關帝殿及天后宮', 2263, 3258, 'MT008', null, 'western connected building beside Quanta Miu, north of Choc-ca; approximate hand-read footprint, IC MT008; historical symbol/centroid uncertainty remains'],
  ],
  notes: {
    zh: '《澳門地圖集》的氹仔專圖，1:10,000，原掃描 4528×6046。可查看大氹、小氹的舊岸線、聚落、道路與山形。以大潭山、嘉模聖母堂、觀音岩、氹仔炮台及卓家村關帝殿及天后宮配準；Quanta Miu 按卓家村北側廟宇圖形作近似定位。小氹西、北、東岸，以及大氹北岸海灣、Ponta Cabrita 岬角與東南岸，另參照澳門官方地圖的 1912 年土地範圍作局部校正，保留五個地標位置及完整原圖。官方歷史輪廓與原圖均有概括化；觀音岩、北澳山一帶及舊城濱岸仍有配準差異，不套用現代填海邊界，並非測量底圖。',
    en: 'The 1:10,000 Taipa sheet from Atlas de Macau, scanned at 4528×6046. Shows historical islands, shores, settlements, paths and relief. Registered at Taipa Grande, Carmo Church, Kun Iam Rock, Taipa Fortress and Kuan Tai and Tin Hau Temple north of Cheok Ka village, using the approximate footprint beside Quanta Miu. Local corrections match the west, north and east of Taipa Pequena, and the northern bay, Ponta Cabrita and southeastern headland of Taipa Grande to the official Macau Webmap 1912 land extent, preserving all five landmarks and the complete sheet. Both historical outlines are generalised; Kun Iam / Pak O hill and the old-town waterfront remain approximate. No matching to modern reclamation; not a survey basemap.',
    pt: 'Folha da Taipa do Atlas de Macau, a 1:10.000, digitalizada a 4528×6046. Mostra as ilhas, costas, povoações, caminhos e relevo antigos. Registada pela Taipa Grande, Igreja do Carmo, Pequeno Templo de Kun Iam, Fortaleza da Taipa e Templo de Kuan Tai e Tin Hau a norte de Cheok Ka, pela planta aproximada junto à legenda Quanta Miu. Correcções locais ajustam as costas oeste, norte e leste da Taipa Pequena e a baía norte, Ponta Cabrita e promontório sudeste da Taipa Grande ao território de 1912 do mapa oficial de Macau, preservando os cinco marcos e a folha integral. Ambos os contornos históricos são generalizados; Kun Iam / colina de Pak O e a frente ribeirinha antiga continuam aproximados. Não ajusta aos aterros actuais; não é uma base topográfica.',
  },
}

export const COLOANE_1912 = {
  ...atlas, id: 'coloane-1912',
  // Surviving rock references at Ka Ho / eastern capes, plus historical northwest / Lai Chi Vun outlines.
  coastSnap: { radiusM: 400, steps: 24 },
  name: { zh: '路環島圖', en: 'Island of Coloane', pt: 'Ilha de Coloane' },
  title: { zh: '路環島圖（1912，1:10,000）', en: 'Planta da Ilha de Coloane (1912, 1:10,000)', pt: 'Planta da Ilha de Coloane (1912, 1:10.000)' },
  work: 'Atlas de Macau — Planta da Ilha de Coloane, 1:10,000',
  scan: bnp(7), references: [
    ...atlasReferences,
    { name: 'DSSCU Macau Webmap — 1912 land extent, Evolution since the 20th century', url: 'https://webmap.gis.gov.mo/MapGIS/index.html' },
    { name: 'DSSCU — Macao Grid / WGS84 transformation parameters', url: 'https://geomatics.dsscu.gov.mo/files/geographical_geodetic_control/ENG/Macaucoord_2009_web_EN_v201702.pdf' },
  ],
  source: atlasSource('coloane', 7, 4624, 5972),
  gcps: [
    ['Alto de Coloane 疊石塘山', 2737, 4108, 113.5612955, 22.1206541, 'summit triangle and innermost contour; OSM n2992376898'],
    ['Monte de Ka Ho 九澳山', 1266, 1235, 113.5846547, 22.1299772, 'summit triangle; OSM n6056592519'],
    ['Ponto Central 中央山', 1648, 3105, 113.5700017, 22.1284492, 'summit triangle; OSM n6057634907'],
    ['Tin Hau 天后古廟', 3552, 5215, 'MC003', null, 'building at the inland Pagode label above Coloane village; IC heritage coordinates'],
    // Bound south/east extrapolation with rock edges. Do not use the reclaimed
    // north face of Long Chao Kok, a beach waterline or detached offshore rocks.
    ['Hac Sa north rocky shoulder 黑沙北端岩岸', 1969, 2364, 113.5754065, 22.1253149, 'mainland rock edge at the north end of Hac Sa bay; OSM coastline w1428329118'],
    ['Long Chao Kok south rocky tip 龍爪角南側岩岬', 3877, 2898, 113.5694684, 22.1117282, 'mainland rock-coast tip south of the hill, excluding detached boulders; OSM coastline w1428329118; hand-read correspondence'],
    ['Cheoc Van east rocky headland 竹灣東側岩岬', 3890, 3848, 113.5623028, 22.1115436, 'rock headland east of Cheoc Van beach, not the sand waterline; OSM coastline w1428329118'],
  ],
  notes: {
    zh: '《澳門地圖集》的路環專圖，1:10,000，原掃描 4624×5972。保留全島岸線、等高線、道路、村落及聚落放大附圖。主圖以山頂、天后古廟及黑沙北端、龍爪角南側、竹灣東側岩岬配準，減少南岸外推偏移；九澳村正北、舊九澳灣東側仍存的岩岬，大擔角北側弧岸、東側岬角及凹灣，以及龍爪角東側岩岸，另以成對岬角、岩壁及凹灣位置作局部影像校正，並固定原有山頂與南岸定位；沙灘水線、離岸散石及後期護岸不作定位點。附圖保留原版位置，不對應下方現代地理位置。山頂與歷史地物為人工判讀，控制點之間仍有配準偏差，不以現代填海岸線取代舊岸線。石排灣舊灣口、西北岸，以及荔枝碗南段至路環村北側兵營，另參照澳門官方地圖的 1912 年土地範圍作局部校正；保留原有地標、已核對的岩岬及完整原圖。阿婆秧、黑沙與部分東南岩岸的官方概略輪廓仍與其他參考不一致，未據此強行調整，並非測量底圖。',
    en: 'The 1:10,000 Coloane sheet from Atlas de Macau, scanned at 4624×5972, with coasts, contours, paths, villages and an enlarged settlement inset. Main-map hilltops and Tin Hau Temple are supplemented by rock-coast controls at northern Hac Sa, southern Long Chao Kok and the headland east of Cheoc Van, reducing southern extrapolation. A compact local image correction additionally aligns the surviving rock promontory directly north of Ka Ho village (east of historical Baia de Caho), the northern arc, eastern cape and rock cove at Tai Tam Kok, and the eastern rock face of Long Chao Kok using corresponding tips, flanks and coves while holding the existing hilltop and southern controls. Beach waterlines, detached rocks and later concrete frontages are not controls. The inset retains its printed position and does not match the geography beneath it. Hilltops and historical features are hand-read; alignment between control points remains approximate, preserving historical shores rather than modern reclamation. Additional local corrections use the official Macau Webmap 1912 land extent at the old Siac Pai Van bay mouth, northwestern shore, southern Lai Chi Vun and the northern village barracks, retaining existing landmarks, verified rock capes and the full sheet. The generalised official outline disagrees with other references around A Po Ioeng, Hac Sa and some southeastern rock coasts; those areas are not forced to match it. Not a survey basemap.',
    pt: 'Folha de Coloane do Atlas de Macau, a 1:10.000, digitalizada a 4624×5972, com costas, curvas de nível, caminhos, aldeias e uma inserção ampliada da povoação. Os cumes e o Templo de Tin Hau da carta principal são complementados por pontos na costa rochosa a norte de Hac Sa, a sul de Long Chao Kok e a leste de Cheoc Van, reduzindo a extrapolação a sul. Uma correcção local da imagem alinha também o promontório rochoso preservado a norte da aldeia de Ká Hó (a leste da antiga Baía de Caho), o arco norte, o cabo oriental e a enseada rochosa de Tai Tam Kok, e a costa rochosa oriental de Long Chao Kok, por pontas, flancos e enseadas correspondentes, mantendo os cumes e os pontos de controlo a sul. A linha de água das praias, rochas isoladas e obras costeiras posteriores não são pontos de controlo. A inserção mantém a posição impressa e não corresponde à geografia por baixo. Cumes e marcos são lidos manualmente; o alinhamento entre pontos é aproximado e mantém a costa antiga, não os aterros actuais. Correcções locais adicionais usam o território de 1912 do mapa oficial de Macau na antiga baía de Siac Pai Van, costa noroeste, sul de Lai Chi Vun e quartel a norte da povoação, preservando os marcos, cabos rochosos verificados e a folha integral. O contorno oficial generalizado diverge de outras referências em A Po Ioeng, Hac Sa e algumas costas rochosas a sudeste; essas zonas não são forçadas a coincidir. Não é uma base topográfica.',
  },
}

const chartFile = 'Admiralty_Chart_No_1290_Macao_Surveyed_By_Captn._Peter_Heywood_H.M.S._Dedaigneuse_1804,_Published_1840,_Corrections_to_1858.jpg'
export const ADMIRALTY_1858 = {
  // The selector dates this copy by its last correction, not its original survey.
  // Original publication (1840) stays explicit in the title/work/notes.
  id: 'admiralty-1858', year: 1858, published: null,
  name: { zh: '澳門及離島海圖（1858 修訂）', en: 'Macao and islands (1858 corrections)', pt: 'Macau e ilhas (correcções de 1858)' },
  title: { zh: '英國海軍部第 1290 號澳門海圖（1804 測繪、1840 出版、1858 修訂）', en: 'Admiralty Chart 1290: Macao (surveyed 1804, published 1840, corrected to 1858)', pt: 'Carta do Almirantado 1290: Macau (levantamento de 1804, edição de 1840, correcções até 1858)' },
  author: 'British Admiralty / UK Hydrographic Office; survey by Captain Peter Heywood',
  work: 'Admiralty Chart No. 1290 — China, Macao; survey 1804, publication 1840, corrections to 1858',
  scan: {
    holder: 'Barry Lawrence Ruderman Antique Maps', via: 'Wikimedia Commons', identifier: 'Admiralty Chart 1290 / raremaps 61653',
    url: `https://commons.wikimedia.org/wiki/File:${chartFile}`, leaves: [],
    license: 'Public domain — Wikimedia Commons marks the British Admiralty chart PD-UKGov (expired Crown copyright).',
  },
  references: [
    { name: 'Wikimedia Commons — full-resolution scan and public-domain statement', url: `https://commons.wikimedia.org/wiki/File:${chartFile}` },
    { name: 'Barry Lawrence Ruderman — source copy', url: 'https://www.raremaps.com/gallery/detail/61653/macao-surveyed-by-captn-peter-heywood-hms-dedaigneuse-18-british-admiralty' },
    { name: 'OpenStreetMap — reference coordinates', url: 'https://www.openstreetmap.org/copyright' },
  ],
  source: { kind: 'sheet', file: 'admiralty-1290-1858.jpg', url: `https://commons.wikimedia.org/wiki/Special:FilePath/${chartFile}`, registrationOrigin: [0, 0], shrink: 4 },
  lambda: 0, resM: 5, marginKm: 4, gcpSpace: 'sheet', tiles: { maxzoom: 16 },
  gcps: [
    ['Ilha Verde 青洲山頂', 4105, 3193, 113.53764, 22.21143, 'centre of summit hachures; OSM peak'],
    ['Mongha 望廈炮台', 4881, 3562, 113.54767, 22.20797, 'centre of fort enclosure; OSM'],
    ['D Maria II 馬交石炮台', 5612, 4042, 113.55562, 22.20340, 'centre of fort enclosure; OSM'],
    ['Monte 大炮台', 4270, 4606, 113.54237, 22.19703, 'centre of Monte fort enclosure; OSM'],
    ['Guia 東望洋炮台', 5038, 4658, 113.54971, 22.19644, 'fort symbol on the hill, approximate; the lighthouse was built later'],
    ['S Francisco 嘉思欄炮台', 4588, 5223, 113.5442, 22.19099, 'fort promontory; reference from the registered 1889 survey'],
    ['Barra 聖地牙哥炮台', 3310, 6070, 113.53071, 22.18268, 'centre of the Barra fort enclosure; OSM'],
    ['Taipa Grande 大潭山', 6580, 8747, 113.5657964, 22.1588902, '470-foot summit region, approximate; OSM n2992376894'],
    ['Taipa Pequena 小潭山', 4830, 8400, 113.5475519, 22.1612782, 'summit region, approximate; OSM n2992376895'],
    ['Alto de Coloane 疊石塘山', 6745, 12220, 113.5612955, 22.1206541, 'Hump summit symbol, approximate; OSM n2992376898'],
    ['Monte de Ka Ho 九澳山', 8410, 11820, 113.5846547, 22.1299772, '410-foot hill, approximate; OSM n6056592519'],
  ],
  notes: {
    zh: '標示年份為此版的最後修訂年 1858；原測繪於 1804 年，1840 年初版，並非整張圖於 1858 年重新測量。11894×15260 原掃描涵蓋半島、氹仔、路環及周邊水道，保留航海水深、羅盤、紙邊與裝裱接縫。按炮台及山形作近似配準，離島地形較概括；零控制點殘差不代表實地精度。岸線保留歷史畫法，適合區域尺度比較。',
    en: '1858 is this edition’s final correction date: originally surveyed in 1804 and published in 1840, not wholly resurveyed in 1858. The 11894×15260 scan covers the peninsula, Taipa, Coloane and neighbouring channels, retaining soundings, compass roses, margins and mounting seams. Approximate registration uses forts and generalised hill symbols, especially on the islands. Zero fit residuals are not ground accuracy. Historical coastlines are preserved; best for regional comparison.',
    pt: '1858 indica a última correcção desta edição: levantamento original de 1804, publicado em 1840, sem implicar um novo levantamento completo em 1858. A digitalização de 11894×15260 abrange a península, Taipa, Coloane e canais vizinhos, mantendo sondagens, rosas-dos-ventos, margens e juntas da montagem. Registo aproximado por fortalezas e símbolos generalizados de montanhas, sobretudo nas ilhas. Resíduos nulos não significam precisão no terreno. Mantém a costa histórica; adequado à comparação regional.',
  },
  attribution: 'British Admiralty, survey 1804; published 1840; corrected to 1858. Scan: Barry Lawrence Ruderman Antique Maps via Wikimedia Commons (public domain, PD-UKGov). Approximate georeferencing: mini-macau; reference coordinates © OpenStreetMap contributors.',
}

export const ISLAND_OLD_MAPS = [ADMIRALTY_1858, TAIPA_1912, COLOANE_1912]
