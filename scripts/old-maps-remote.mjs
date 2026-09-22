// Public, provider-georeferenced services. These are references, not vendored scans.
// Metadata and use notice checked against the provider viewer / WMTS on 2026-09-20.
// A full rebuild must retain these entries without downloading or re-warping tiles.
export const REMOTE_OLD_MAPS = [{
  id: 'macau-1996',
  name: { zh: '澳門地區全圖', en: 'Territory of Macau', pt: 'Território de Macau' },
  title: { zh: '澳門地區（1996，1:20,000）', en: 'Territorio de Macau (1996, 1:20,000)', pt: 'Território de Macau (1996, 1:20.000)' },
  author: 'Not identified in the WMTS catalogue',
  year: 1996,
  published: 1996,
  work: null,
  bounds: { west: 113.499818, east: 113.6164622, north: 22.2329483, south: 22.0808828 },
  coordinates: [[113.499818, 22.2329483], [113.6164622, 22.2329483], [113.6164622, 22.0808828], [113.499818, 22.0808828]],
  remoteTiles: {
    url: 'https://gis.sinica.edu.tw/macau/file-exists.php?img=Macau_20K_1996-png-{z}-{x}-{y}',
    tileSize: 256,
    minzoom: 0,
    maxzoom: 17,
  },
  scan: {
    holder: 'Academia Sinica / 中央研究院',
    via: 'Macau historical maps WMTS',
    identifier: 'Macau_20K_1996',
    url: 'https://gis.sinica.edu.tw/showwmts/index.php?l=Macau_20K_1996&s=macau',
    leaves: [],
    license: '中央研究院版權所有，非經允許，不得作為商業使用。 / Copyright Academia Sinica; commercial use requires permission. Imagery is served by the provider and is not covered by this repository’s MIT licence.',
  },
  references: [
    { name: 'Academia Sinica Macau WMTS catalogue', url: 'https://gis.sinica.edu.tw/macau/' },
    { name: 'WMTS capabilities (bounds, tile template and matrix)', url: 'https://gis.sinica.edu.tw/macau/wmts' },
  ],
  notes: {
    zh: '涵蓋澳門半島、氹仔、路環與機場，可比較九十年代的海岸與路氹變化。沿用中研院的配準，未提供控制點或精度數據；細小街名清晰度有限。圖中圍合或規劃範圍不代表當年全部已填成陸地。線上圖源需連網，商業使用須先取得中研院許可。',
    en: 'Covers the peninsula, Taipa, Coloane and the airport, for comparing 1990s coastlines and Cotai. Uses the provider’s georeferencing; control points and accuracy figures are not supplied. Small street labels are soft. Enclosed or planned areas do not establish completed reclamation. Requires an internet connection; commercial use requires Academia Sinica’s permission.',
    pt: 'Abrange a península, a Taipa, Coloane e o aeroporto, permitindo comparar a costa e o Cotai nos anos 1990. Usa a georreferenciação do fornecedor, sem pontos de controlo ou dados de precisão publicados. As legendas pequenas têm nitidez limitada. Áreas delimitadas ou planeadas não comprovam aterros concluídos. Requer ligação à Internet; o uso comercial exige autorização da Academia Sinica.',
  },
  attribution: '© Academia Sinica · Macau 1996. Commercial use requires permission.',
}]
