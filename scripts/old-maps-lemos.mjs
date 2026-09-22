// Picks below are in native Mindat sheet pixels. The final map converts them
// to the enhanced sheet's pixel centres: u' = 2(u + 0.5) - 0.5.
// These are approximate feature picks, not a surveyed control network.
export const LEMOS_1963 = {
  id: 'lemos-1963',
  name: { zh: '澳門地質略圖', en: 'Geological sketch of Macau', pt: 'Esboço geológico de Macau' },
  title: {
    zh: '澳門地質略圖（M. J. Lemos de Sousa，1963，1:25,000）',
    en: 'Esboço Geológico da Província Ultramarina de Macau (1963, 1:25,000)',
    pt: 'Esboço Geológico da Província Ultramarina de Macau (1963, 1:25.000)',
  },
  author: 'M. J. Lemos de Sousa', year: 1963, published: 1963,
  work: 'Esboço Geológico da Província Ultramarina de Macau; Imprensa Nacional de Macau',
  scan: {
    holder: 'IICT — Centro de Documentação e Informação (as described by Mindat / USJ)',
    via: 'Mindat.org / Rui Nunes', identifier: 'mindat:1:4:695342:0',
    url: 'https://www.mindat.org/photo-695342.html', leaves: [],
    license: 'Mindat photo 695342 is marked public domain and free to use by its uploader. This records the provider statement; the underlying 1963 publication rights have not been independently established.',
  },
  attribution: 'M. J. Lemos de Sousa, 1963. Scan: Rui Nunes / Mindat.org, photo 695342 (marked public domain by provider). Approximate georeferencing: mini-macau; reference coordinates © OpenStreetMap contributors.',
  references: [
    { name: 'Mindat — original 1000 × 1386 scan and reuse statement', url: 'https://www.mindat.org/photo-695342.html' },
    { name: 'USJ — historical geological maps and bibliography', url: 'https://ise.usj.edu.mo/research/projects/geologia-de-macau/' },
    { name: 'OpenStreetMap — Main Storage Reservoir', url: 'https://www.openstreetmap.org/relation/10266785' },
    { name: 'OpenStreetMap — Taipa Pequena', url: 'https://www.openstreetmap.org/node/2992376895' },
    { name: 'OpenStreetMap — Taipa Grande', url: 'https://www.openstreetmap.org/node/2992376894' },
    { name: 'OpenStreetMap — Alto de Coloane', url: 'https://www.openstreetmap.org/node/2992376898' },
  ],
  source: {
    kind: 'sheet',
    url: 'https://www.mindat.org/xpic.php?fname=03774760014369907928232.jpg&h=3546fbd128e2762a6e5afb7cc79c28bd',
    file: 'lemos-1963-2x.png', originalFile: 'lemos-1963-original.jpg', manual: true,
    enhance: { scale: 2, sharpen: { sigma: 0.6, m1: 0.4, m2: 0.8 } },
    registrationOrigin: [140, 438],
  },
  projection: 'affine', lambda: null, resM: 7, marginKm: 5,
  // Preserve the territory-wide affine fit; correct only the adjacent rock coast.
  coastSnap: { radiusM: 350, steps: 24 },
  tiles: { maxzoom: 14 }, gcpSpace: 'sheet',
  gcps: [
    ['Ilha Verde 青洲山頂', 267, 288, 113.53764, 22.21143, 'centre of hill symbol; approximate, OSM peak used by the earlier plates'],
    ['Reservoir NE 大水塘東北堤角', 432, 347, 113.560456, 22.204279, 'water-side bend, OSM r10266785; simplified line at this scale'],
    ['Reservoir SE 大水塘東南堤角', 442, 377, 113.561683, 22.199913, 'water-side bend, OSM r10266785; simplified line at this scale'],
    ['Taipa Pequena 小潭山', 338, 686, 113.5475519, 22.1612782, 'summit symbol; OSM n2992376895; approximate symbol centre'],
    ['Taipa Grande 大潭山', 475, 704, 113.5657964, 22.1588902, 'summit symbol; OSM n2992376894; approximate symbol centre'],
    ['Alto de Coloane 疊石塘山', 445, 1004, 113.5612955, 22.1206541, 'summit symbol; OSM n2992376898; approximate symbol centre'],
    // Coastal controls participate in the affine baseline but are not fixed by
    // the local coastal correction (the "coast " prefix selects this behaviour). The
    // broad coastline stroke limits these picks to roughly a few native pixels.
    ['coast Hac Sa north rocky shoulder 黑沙北端岩岸', 546, 965, 113.5754065, 22.1253149, 'centre of the generalised rock-coast stroke at the north end of Hac Sa; OSM coastline w1428329118'],
    ['coast Long Chao Kok south rocky tip 龍爪角南側岩岬', 505, 1077, 113.5694684, 22.1117282, 'centre of the generalised southern rock-coast stroke, not the reclaimed north face; OSM coastline w1428329118'],
    ['coast Cheoc Van east rocky headland 竹灣東側岩岬', 450.5, 1078.5, 113.5623028, 22.1115436, 'centre of the rock-headland stroke east of Cheoc Van beach, not the sand waterline; OSM coastline w1428329118'],
  ].map(([name, u, v, ...location]) => [name, u * 2 + 0.5, v * 2 + 0.5, ...location]),
  notes: {
    zh: '1963 年、1:25,000 的全澳地質略圖，涵蓋半島、氹仔及路環，可比較舊岸線、填海區與地質分區。來源掃描為 1000×1386，以傳統 2× 放大及輕度銳化處理成 2000×2772，沒有生成或補寫文字及地物；細節仍受原始解析度限制。以全圖仿射定位為基礎，參照大水塘東側堤角、青洲與離島山頂，以及黑沙、龍爪角、竹灣岩岬；再對九澳村正北、舊九澳灣東側仍存的岩岬，九澳東南岸及龍爪角南岸至竹灣東側作局部岩岸校正。校正只影響岩岸附近，網格在該範圍內隨影像微調，半島、氹仔及既有內陸定位維持。保留沙灘、北側填海區與離岸岩石的年代差異。控制點為人工判讀的概括地物，配準誤差不等同測繪精度。粗岸線與低解析度仍會造成局部數十米差異；適合全澳尺度比較。完整圖例與原件見來源連結。',
    en: 'A 1963 geological sketch at 1:25,000 covering the peninsula, Taipa and Coloane, including historical coastlines and reclaimed ground. The 1000×1386 source scan is enlarged to 2000×2772 using conventional 2× resampling and gentle sharpening, without generating or reconstructing lettering or features. Detail remains limited by the original resolution. A territory-wide affine baseline uses the reservoir’s eastern dam corners, hilltops and rock-coast controls. A compact local correction aligns the surviving rock promontory north of Ka Ho village (east of the historical Baia de Caho), the southeastern Ka Ho coast and the southern rock shore from Long Chao Kok to east of Cheoc Van. The grid adjusts with the image only near these shores; the peninsula, Taipa and existing inland controls stay in place. Beaches, northern reclaimed frontage and detached rocks retain their historical differences. Hand-read generalised features are approximate; fit residuals are not survey accuracy. Generalised coastline strokes and the low-resolution scan still leave local differences of tens of metres. Best viewed at territory scale. See the source for the complete legend and sheet.',
    pt: 'Esboço geológico de 1963, à escala 1:25.000, da península, Taipa e Coloane, incluindo a costa antiga e os aterros. A digitalização de 1000×1386 foi ampliada para 2000×2772 por reamostragem convencional 2× e nitidez suave, sem gerar ou reconstruir letras ou elementos. Os pormenores continuam limitados pela resolução original. A base afim usa cantos dos diques orientais do reservatório, cumes e pontos na costa rochosa. Uma correcção local alinha o promontório rochoso preservado a norte da aldeia de Ká Hó (a leste da antiga Baía de Caho), a costa sudeste de Ká Hó e a costa rochosa a sul de Long Chao Kok até leste de Cheoc Van. A quadrícula acompanha a imagem apenas junto destas costas; a península, a Taipa e os pontos interiores existentes mantêm a posição. Praias, aterros a norte e rochas isoladas mantêm as diferenças históricas. Os pontos generalizados foram lidos manualmente; os resíduos não representam precisão topográfica. A costa generalizada e a baixa resolução ainda deixam diferenças locais de dezenas de metros. Adequado à escala de todo o território. A legenda completa está na fonte.',
  },
}
