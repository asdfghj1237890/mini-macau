// Complete Harvard sheets. Native scan pixels; preserve every margin and annotation.
// Rubber-sheet shoreline curves allow local scale and shape changes while holding
// landmark centres. Later outlines are display references, not same-year surveys.
const policy = 'https://library.harvard.edu/about/policies/policy-access-digital-reproductions-works-public-domain'
const harvard = (identifier, file) => ({
  holder: 'Harvard Map Collection, Harvard Library', via: 'Wikimedia Commons', identifier,
  url: `https://commons.wikimedia.org/wiki/File:${file}`, leaves: [],
  license: 'Public domain — Harvard Map Collection identifies this openly available scan as public domain and permits commercial and non-commercial reproduction. Credit: Courtesy of Harvard Map Collection, Harvard Library.',
})
const references = (catalog) => [
  { name: 'Harvard Library — catalogue record', url: `https://id.lib.harvard.edu/alma/${catalog}/catalog` },
  { name: 'Harvard Library — public-domain digital reproduction policy', url: policy },
  { name: 'OpenStreetMap — reference coordinates', url: 'https://www.openstreetmap.org/copyright' },
]
const bellinFile = 'Plan_de_la_ville_et_du_port_de_Macao_1749_21554947.jpg'
const hoggFile = 'Sketch_of_the_Typa_and_Macao_1780_22924837.jpg'
const common = { lambda: 0, resM: 5, marginKm: 2, gcpSpace: 'sheet', tiles: { maxzoom: 15 } }

export const BELLIN_1749 = {
  ...common, id: 'bellin-1749', year: 1749, published: 1749,
  coastSnap: { radiusM: 1400, steps: 32, cellM: 8 },
  // Keep engraved labels and hill strokes readable even when a coast fit improves.
  distortionChecks: [
    { name: 'peninsula engraving', sourceBounds: [1050, 1360, 2190, 2510], maxMetresPerPixel: 10 },
  ],
  name: { zh: '貝林・澳門城廓與內港', en: 'Bellin · walled Macao and Inner Harbour', pt: 'Bellin · Macau muralhada e Porto Interior' },
  title: { zh: '澳門城與港圖（貝林，1749 年，法荷雙語版）', en: 'Plan de la ville et du port de Macao (Bellin, 1749, French–Dutch edition)', pt: 'Plan de la ville et du port de Macao (Bellin, 1749, edição franco-neerlandesa)' },
  author: 'Jacques-Nicolas Bellin; engraved by Jacob van der Schley',
  attribution: 'Jacques-Nicolas Bellin, 1749. Courtesy of Harvard Map Collection, Harvard Library, via Wikimedia Commons; public domain. Approximate georeferencing by mini-macau.',
  work: 'Plan de la ville et du port de Macao / Grondtekening der stad en haven van Makao',
  scan: harvard('Harvard 990125229050203941 / G7823.M2 1749 .B4', bellinFile), references: references('990125229050203941'),
  source: { kind: 'sheet', file: 'harvard-bellin-1749.jpg', url: `https://upload.wikimedia.org/wikipedia/commons/1/1e/${bellinFile}`, registrationOrigin: [0, 0], shrink: 1 },
  gcps: [
    ['Monte 大炮台', 1715, 1906, 113.54237, 22.19703, 'centre of the labelled square fort; OSM fort centroid; schematic engraving'],
    ['Guia 東望洋炮台', 1924, 2016, 113.54969, 22.19654, 'centre of the named four-bastion symbol; OSM fort centroid, not the later lighthouse'],
    ['Barra 聖地牙哥炮台', 1152, 2327, 113.53071, 22.18268, 'centre of St Jago et St Philippo fort enclosure; approximate symbol; OSM'],
    ['Bomparto 燒灰爐炮台', 1427, 2284, 113.53698, 22.18647, 'larger inland square beside N.D. de Bomparto; demolished fort location from the 1889 survey'],
    ['Ilha Verde 青洲', 1414, 1584, 113.53764, 22.21143, 'centre of the small labelled island; approximate island-centre correspondence, OSM peak'],
    ['Portas do Cerco 關閘', 1986, 1409, 113.54921, 22.21594, 'gate opening in the wall across the isthmus; approximate position of historic crossing, not the 1870 arch footprint'],
    ['A-Ma 媽閣廟', 1212, 2169, 'MM020', null, 'centre of the labelled Pagode Chinoise compound; IC heritage coordinates'],
    ['S Francisco 嘉思欄炮台', 1730, 2058, 113.5442, 22.19099, 'curved Batterie enclosure at the southeastern city wall; fort position from the registered 1889 survey'],
  ],
  notes: {
    zh: "哈佛館藏編目為 1749 年，2699×3380 原掃描，法文與荷蘭文並列，可見城廓、炮台、青洲、內港及前山。採用溫和的布料式彈性校準：固定八處炮台、島嶼、關閘及媽閣廟地標，十四段岸線以較疏的控制點、減半的拉動幅度調整，保留文字、街區和山紋的可讀性。容許岸線與參照輪廓留有間距，西北岸尤其明顯；各區比例仍會改變。參照十八世紀末岸線重建，供疊圖比對，並非復原 1749 年精確岸線或測繪比例；沒有套用現代填海邊界。前山、灣仔及控制範圍外仍較不確定。完整保留紙邊、館藏章、手寫編號與原圖內容。",
    en: "Catalogued by Harvard as 1749; native scan 2699×3380, with French and Dutch labels for walls, forts, Green Island, Inner Harbour and Qianshan. Gentle rubber-sheet registration holds eight fort, island, gate and temple landmarks. Sparse controls along fourteen shoreline stretches apply half the displacement toward the reference outline, retaining more readable lettering, streets and relief. Shoreline gaps are intentionally retained, especially in the northwest; local scale still varies. The late-eighteenth-century coast reconstruction is a display reference for overlay comparison, not a recovery of the exact 1749 shore or survey scale. Modern reclamation is excluded. Qianshan, Wanzai and areas outside the controls remain less certain. The complete sheet, margins, stamps, handwritten references and original content are retained.",
    pt: "Catalogada por Harvard em 1749; digitalização original de 2699×3380, com legendas francesas e neerlandesas. O ajuste elástico suave mantém oito marcos de fortalezas, ilha, porta e templo. Controlos mais espaçados em catorze trechos costeiros aplicam metade do deslocamento em direcção ao contorno de referência, preservando a legibilidade das letras, ruas e relevo. Mantêm-se intencionalmente afastamentos da costa de referência, sobretudo a noroeste; a escala local ainda varia. A reconstrução costeira do final do século XVIII serve para comparação por sobreposição, não para recuperar a costa exacta de 1749 ou a escala de um levantamento. Exclui aterros modernos. Qianshan, Wanzai e áreas fora dos marcos permanecem menos certas. Conserva a folha completa, margens, carimbos, referências manuscritas e conteúdo original.",
  },
}

export const HOGG_1780S = {
  ...common, id: 'hogg-1780s', year: 1780, yearPrecision: 'decade', published: null,
  // Seven landmark centres remain fixed as the entire island coastline stretches.
  // Southeastern bay curvature is interpretive; do not add unverified hill pins.
  coastSnap: { radiusM: 1600, steps: 32, cellM: 16 },
  // Limit magnification of the original hill/street strokes, not just coast error.
  distortionChecks: [
    { name: 'peninsula relief', sourceBounds: [1470, 1710, 1790, 2010], maxMetresPerPixel: 20 },
    // Include the water gap between the former Taipa islands and offshore wash.
    { name: 'Taipa islands and channel', sourceBounds: [1630, 2200, 2260, 2530], maxMetresPerPixel: 60 },
    { name: 'Coloane relief and coast', sourceBounds: [1780, 2620, 2490, 3180], maxMetresPerPixel: 45 },
  ],
  resM: 12, tiles: { maxzoom: 14 },
  name: { zh: '霍格版・澳門與離島航道', en: 'Hogg edition · Macao and island channels', pt: 'Edição Hogg · Macau e canais das ilhas' },
  title: { zh: '澳門與十字門航海草圖（霍格版，1780 年代）', en: 'Sketch of the Typa and Macao (Hogg edition, 1780s)', pt: 'Sketch of the Typa and Macao (edição Hogg, década de 1780)' },
  author: 'Alexander Hogg (publisher); chart associated with Cook’s third voyage',
  work: 'Sketch of the Typa and Macao — Harvard G7822.T27 178- .H6',
  scan: harvard('Harvard 990125230640203941 / G7822.T27 178- .H6', hoggFile),
  references: [...references('990125230640203941'), { name: 'DSSCU — historical land extent (1912, approximate island-shape reference)', url: 'https://web.gis.gov.mo/arcgis/rest/services/ThematicMap/evol_v2/MapServer/0' }, { name: 'Harvard Library — original image viewer', url: 'https://nrs.harvard.edu/urn-3:FHCL:4723721?buttons=y' }, { name: 'University of Macau — historical meaning of Typa', url: 'https://cms.um.edu.mo/wp-content/uploads/2022/05/2021_98-Taipa得名考源.pdf' }],
  source: { kind: 'sheet', file: 'harvard-hogg-1780s.jpg', url: `https://upload.wikimedia.org/wikipedia/commons/6/69/${hoggFile}`, registrationOrigin: [0, 0], shrink: 1 },
  gcps: [
    ['Monte 大炮台', 1655, 1738, 113.54237, 22.19703, 'square fort west of the ridge, opposite Guia; approximate engraved symbol, OSM fort centroid'],
    ['Guia 東望洋炮台', 1778, 1728, 113.54969, 22.19654, 'square fort on the eastern ridge; approximate engraved symbol, not the later lighthouse'],
    ['Ilha Verde 青洲', 1600, 1504, 113.53764, 22.21143, 'centre of the explicitly labelled Isla Verte; OSM peak'],
    ['Taipa Pequena 小潭山', 1744, 2317, 113.5475519, 22.1612782, 'centre of the western Taipa hill hachures; approximate relief symbol, OSM n2992376895'],
    ['Taipa Grande 大潭山', 2040, 2354, 113.5657964, 22.1588902, 'main central summit hachures on eastern Taipa; approximate relief symbol, OSM n2992376894'],
    ['Alto de Coloane 疊石塘山', 1979, 2907, 113.5612955, 22.1206541, 'dominant southwestern summit hachures on Coloane; approximate relief symbol, OSM n2992376898'],
    ['Portas do Cerco 關閘', 1737, 1490, 113.54921, 22.21594, 'opening in the wall across the isthmus; approximate historic crossing, not the later arch footprint'],
  ],
  attribution: 'Alexander Hogg, 1780s. Courtesy of Harvard Map Collection, Harvard Library, via Wikimedia Commons; public domain. Approximate georeferencing by mini-macau.',
  notes: {
    zh: "3179×3812 手工設色原掃描，涵蓋半島、氹仔、路環、灣仔、橫琴和航道。此霍格版編目為 1780 年代（178-）；圖上 1780 是觀測資料年份，並非確切出版年。Typa 指十字門水域，圖中明言澳門港為目測草繪。採用布料式彈性校準：固定七處炮台、關閘、青洲和山頂地標，媽閣西岸與半島南岸沿墨線作局部推移，兩端減弱拉伸以保留山紋與街區細節，半島東岸沿連續岸線校準；大小氹仔及路環以較疏的控制點固定大形，再沿海岸作局部推移，減少山紋與設色被拉長，包含黑沙至竹灣的東南岸；各區毋須維持相同比例，山形與文字會一起變形。半島參照十八世紀末岸線重建，離島參照 DSSCU 的 1912 年陸地輪廓。跨年代岸線只作疊圖定位參照，海灣曲率屬幾何調整，並非當時海灣細節的復原，也不是精確測繪底圖。沒有套用現代填海邊界或補畫新內容；旗幟、航海說明、紙邊與館藏註記完整保留。",
    en: "Hand-coloured native scan, 3179×3812, covering the peninsula, Taipa, Coloane, Wanzai, Hengqin and surrounding channels. The Hogg impression is catalogued to the 1780s (178-); printed 1780 dates observations, not a confirmed publication year. Typa refers to the Cross Gate waters, and the chart describes Macao Harbour as drawn by eye. Rubber-sheet registration holds seven fort, gate, island and summit landmarks with sparse local corrections along the Barra west and southern peninsula ink shorelines, tapered at their ends to retain relief and street detail, while retaining the continuous eastern peninsula fit. Taipa and Coloane use broader shape controls followed by sparse normal shoreline corrections to reduce relief and colour-wash stretching, including southeastern Coloane from Hac Sa to Cheoc Van. Local scale can vary; relief and lettering deform with the image. References are the late-eighteenth-century peninsula coast reconstruction and DSSCU’s 1912 island land outlines. Cross-date shores guide display alignment; bay curvature is a geometric interpretation, not recovered historical bay detail or a precise survey basemap. No modern reclamation matching or newly drawn content. The complete flags, navigation notes, paper margins and library annotations remain.",
    pt: "Digitalização original colorida à mão, 3179×3812, abrangendo a península, ilhas e canais vizinhos. A edição Hogg é catalogada na década de 1780 (178-); o ano impresso refere-se a observações, não a uma publicação confirmada. Typa designa as águas de Cross Gate, e a carta declara que o porto foi desenhado à vista. O ajuste elástico mantém sete marcos de fortalezas, porta, ilha e cumes, com correcções locais esparsas da linha de costa desenhada a oeste da Barra e no sul da península, atenuadas nas extremidades para conservar o relevo e as ruas, mantendo o ajuste contínuo no leste da península. Na Taipa e em Coloane, controlos mais espaçados definem a forma geral, seguidos de correcções locais normais à costa para reduzir o alongamento do relevo e da aguada, incluindo o sudeste de Coloane entre Hác Sá e Cheoc Van. A escala varia localmente; relevo e letras acompanham a deformação. Usa a reconstrução costeira da península do final do século XVIII e os contornos insulares de 1912 da DSSCU. São referências de outras épocas para sobreposição; a curvatura das enseadas é uma interpretação geométrica, não a recuperação de pormenores históricos nem um levantamento preciso. Sem ajuste a aterros modernos ou conteúdo novo desenhado. Conserva bandeiras, notas náuticas, margens e anotações.",
  },
}

export const EARLY_OLD_MAPS = [BELLIN_1749, HOGG_1780S]
