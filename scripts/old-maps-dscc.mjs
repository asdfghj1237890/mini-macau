// Two survey sheets of the Direcção dos Serviços de Cartografia e Cadastro (DSCC), the
// predecessor of today's DSSCU, from the Library of Congress via Wikimedia Commons.
//
// Unlike the older plates these are registered on their own printed MACAU GRID, not on
// landmarks: every control point is a grid cross read on the scan, its Macao Grid
// coordinates (EPSG:8433, Macao 1920 / Macao Grid) converted to WGS 84 with the official
// Molodensky-Badekas transformation (EPSG:8438, the same pyproj pipeline that reproduces
// the February 2017 datum document's worked example to 0.005 m). The crosses were located
// by the longest dark horizontal / vertical run in a window round their predicted position
// and refined to the ink centre; crosses buried in dense street ink were rejected. One
// affine per sheet is enough: the residuals are a few metres, the paper shows no fold
// distortion worth a spline. Landmarks (the Guia lighthouse survey mark, Portas do Cerco,
// Monte fortress, Penha) were projected back onto the scans as an independent check.
//
// Rights basis: the Library of Congress's statement for both items, "no known copyright
// restrictions" (the licence template on their Wikimedia Commons pages).

const RIGHTS = 'Library of Congress, Geography and Map Division: no known copyright restrictions (Wikimedia Commons licence “Library of Congress – no known copyright restrictions”). Credit: Library of Congress, Geography and Map Division.'

export const DSCC_OLD_MAPS = [
  {
    id: 'dscc-1990',
    name: { zh: '《澳門》1:5,000', en: 'Macau, 1:5,000', pt: 'Macau, escala 1:5000' },
    title: {
      zh: '澳門（地圖繪製暨地籍司，1990，1:5,000）',
      en: 'Macau, escala 1:5000 (Direcção dos Serviços de Cartografia e Cadastro, 1990)',
      pt: 'Macau, escala 1:5000 (Direcção dos Serviços de Cartografia e Cadastro, 1990)',
    },
    author: 'Direcção dos Serviços de Cartografia e Cadastro, Macau',
    year: 1990,
    published: 1990,
    work: 'Macau, escala 1:5000 = [Ao-men, pi li] 1:5000; Library of Congress G7823.M2 1990 .M3 MLC',
    scan: {
      holder: 'Library of Congress, Geography and Map Division',
      via: 'Wikimedia Commons',
      identifier: '92684644 / g7823m.ct000641',
      url: 'https://www.loc.gov/item/92684644/',
      leaves: [],
      license: RIGHTS,
    },
    attribution: 'Macau 1:5000, Direcção dos Serviços de Cartografia e Cadastro, 1990. Scan: Library of Congress, Geography and Map Division, via Wikimedia Commons. Georeferenced on the printed Macau grid by mini-macau.',
    references: [
      { name: 'Wikimedia Commons — original 10,555 × 11,442 px scan', url: 'https://commons.wikimedia.org/wiki/File:Macau,_escala_1-5000_%3D_(Ao-men,_pi_li)_1-5000._LOC_92684644.jpg' },
      { name: 'EPSG:8433 — Macao 1920 / Macao Grid (the printed grid)', url: 'https://epsg.io/8433' },
      { name: 'EPSG:8438 — Macao 1920 to WGS 84 transformation', url: 'https://epsg.io/8438' },
    ],
    source: {
      kind: 'sheet',
      url: 'https://upload.wikimedia.org/wikipedia/commons/6/61/Macau%2C_escala_1-5000_%3D_%28Ao-men%2C_pi_li%29_1-5000._LOC_92684644.jpg',
      file: 'loc-92684644.jpg',
      registrationOrigin: [0, 0],
      // One scan pixel is 0.41 m on the grid; box-shrink 3× before the 2 m/px single image.
      shrink: 3,
    },
    projection: 'affine',
    lambda: null,
    resM: 2,
    // z17 is 0.55 m/px, just coarser than the scan; z18 would invent resolution.
    tiles: { maxzoom: 17 },
    marginKm: 1,
    gcpSpace: 'sheet',
    // Printed Macau-grid crosses every 500 m, E 19 000–23 000 / N 16 500–20 500: 55 of the 81.
    // The rest sit in dense street ink; any detection more than 12 px from the grid prediction
    // (E20000 N19500, E20500 N18000, E20500 N18500) was rejected as an arm latched onto a street.
    gcps: [
    ['grid E19000 N20500', 425.84, 853.71, 113.5297750, 22.2157188],
    ['grid E19500 N20500', 1641.23, 855.79, 113.5346244, 22.2157170],
    ['grid E20000 N20500', 2855.41, 857.38, 113.5394739, 22.2157150],
    ['grid E20500 N20500', 4069.83, 857.06, 113.5443233, 22.2157129],
    ['grid E21500 N20500', 6498.89, 857.47, 113.5540222, 22.2157082],
    ['grid E22000 N20500', 7713.95, 856.02, 113.5588717, 22.2157057],
    ['grid E22500 N20500', 8926.34, 856.55, 113.5637211, 22.2157030],
    ['grid E23000 N20500', 10141.52, 855.06, 113.5685706, 22.2157001],
    ['grid E19000 N20000', 430.31, 2073.15, 113.5297731, 22.2112034],
    ['grid E19500 N20000', 1646.99, 2075.13, 113.5346224, 22.2112016],
    ['grid E21500 N20000', 6500.71, 2077.43, 113.5540196, 22.2111928],
    ['grid E22000 N20000', 7715.53, 2075.40, 113.5588689, 22.2111903],
    ['grid E23000 N20000', 10142.89, 2073.78, 113.5685674, 22.2111847],
    ['grid E19000 N19500', 435.23, 3290.94, 113.5297712, 22.2066881],
    ['grid E19500 N19500', 1652.10, 3292.16, 113.5346204, 22.2066862],
    ['grid E20500 N19500', 4076.57, 3293.42, 113.5443186, 22.2066821],
    ['grid E21000 N19500', 5289.89, 3294.98, 113.5491678, 22.2066799],
    ['grid E22000 N19500', 7717.46, 3293.94, 113.5588660, 22.2066749],
    ['grid E22500 N19500', 8930.00, 3293.23, 113.5637152, 22.2066722],
    ['grid E23000 N19500', 10143.00, 3292.17, 113.5685643, 22.2066693],
    ['grid E19000 N19000', 438.00, 4508.11, 113.5297693, 22.2021727],
    ['grid E19500 N19000', 1653.93, 4508.10, 113.5346183, 22.2021708],
    ['grid E21000 N19000', 5293.17, 4508.96, 113.5491652, 22.2021645],
    ['grid E21500 N19000', 6507.31, 4508.77, 113.5540142, 22.2021620],
    ['grid E22000 N19000', 7721.78, 4508.77, 113.5588632, 22.2021595],
    ['grid E22500 N19000', 8936.32, 4508.26, 113.5637122, 22.2021568],
    ['grid E23000 N19000', 10149.79, 4507.38, 113.5685612, 22.2021539],
    ['grid E19000 N18000', 444.44, 6926.18, 113.5297655, 22.1931419],
    ['grid E22000 N18000', 7727.85, 6921.75, 113.5588576, 22.1931287],
    ['grid E22500 N18000', 8941.86, 6920.69, 113.5637062, 22.1931260],
    ['grid E23000 N18000', 10155.85, 6921.94, 113.5685549, 22.1931232],
    ['grid E19000 N17500', 452.24, 8141.22, 113.5297637, 22.1886265],
    ['grid E20000 N17500', 2878.43, 8140.11, 113.5394607, 22.1886226],
    ['grid E20500 N17500', 4091.48, 8140.14, 113.5443092, 22.1886205],
    ['grid E21000 N17500', 5304.02, 8140.37, 113.5491577, 22.1886183],
    ['grid E21500 N17500', 6516.19, 8139.10, 113.5540062, 22.1886159],
    ['grid E22000 N17500', 7728.00, 8139.08, 113.5588547, 22.1886133],
    ['grid E22500 N17500', 8943.03, 8139.33, 113.5637033, 22.1886106],
    ['grid E23000 N17500', 10155.16, 8139.17, 113.5685518, 22.1886078],
    ['grid E19000 N17000', 452.47, 9359.31, 113.5297618, 22.1841111],
    ['grid E19500 N17000', 1668.20, 9356.23, 113.5346101, 22.1841092],
    ['grid E20000 N17000', 2880.59, 9357.45, 113.5394585, 22.1841072],
    ['grid E20500 N17000', 4093.54, 9359.54, 113.5443068, 22.1841051],
    ['grid E21000 N17000', 5307.45, 9358.99, 113.5491552, 22.1841029],
    ['grid E21500 N17000', 6522.07, 9358.29, 113.5540036, 22.1841004],
    ['grid E22000 N17000', 7734.63, 9357.71, 113.5588519, 22.1840979],
    ['grid E22500 N17000', 8949.56, 9357.66, 113.5637003, 22.1840952],
    ['grid E23000 N17000', 10161.67, 9356.02, 113.5685486, 22.1840924],
    ['grid E19000 N16500', 451.43, 10578.86, 113.5297599, 22.1795956],
    ['grid E20000 N16500', 2882.82, 10576.16, 113.5394563, 22.1795918],
    ['grid E20500 N16500', 4096.62, 10578.87, 113.5443045, 22.1795897],
    ['grid E21500 N16500', 6525.81, 10574.65, 113.5540009, 22.1795850],
    ['grid E22000 N16500', 7740.35, 10574.75, 113.5588491, 22.1795825],
    ['grid E22500 N16500', 8955.29, 10574.89, 113.5636973, 22.1795798],
    ['grid E23000 N16500', 10168.26, 10572.32, 113.5685455, 22.1795769],
    ].map(([name, u, v, lng, lat]) => [name, u, v, lng, lat, 'printed Macau-grid cross; EPSG:8433 → WGS 84 (EPSG:8438)']),
    notes: {
      zh: '地圖繪製暨地籍司 1990 年出版的澳門半島 1:5,000 地圖，逐棟繪出建築、街道及 10 米等高線，外港可見新口岸一帶填海工程的範圍線；圖上的範圍線不代表當時已全部成陸。以圖上印製的澳門座標格網配準：每 500 米一個十字，共用 55 個，按官方澳門 1920 基準至 WGS 84 轉換（EPSG:8438）換算，單一仿射擬合均方根 2.0 米，留一驗證最大 3.9 米。另把東望洋燈塔測量點、關閘、大炮台，以及文化局的聖老楞佐堂、西望洋聖堂、聖奧斯定堂座標反投到原圖，均落在對應地物上或其十米之內。以上是對圖面格網的擬合與抽查，不等於原圖本身的測繪精度。掃描為美國國會圖書館藏本，館方列明無已知版權限制。',
      en: 'The 1990 Macau peninsula sheet at 1:5,000 by the Direcção dos Serviços de Cartografia e Cadastro, drawing individual buildings, streets and 10 m contours; outlines in the Outer Harbour mark the reclamation works around NAPE and do not establish completed land. Registered on the printed Macau grid: 55 grid crosses at 500 m spacing, converted with the official Macao 1920 to WGS 84 transformation (EPSG:8438), one affine fit with 2.0 m RMS and a worst leave-one-out residual of 3.9 m. Modern coordinates of the Guia lighthouse survey mark, Portas do Cerco, Monte fortress and the IC heritage points of São Lourenço, Penha and Santo Agostinho, projected back onto the scan, land on those buildings or within ten metres of them. These are fit diagnostics against the sheet’s own grid and spot checks, not the survey accuracy of the original. Library of Congress copy, listed by the Library with no known copyright restrictions.',
      pt: 'Folha da península de Macau na escala 1:5000, publicada em 1990 pela Direcção dos Serviços de Cartografia e Cadastro, com edifícios, ruas e curvas de nível de 10 m; os contornos no Porto Exterior assinalam as obras de aterro junto ao NAPE e não comprovam terreno concluído. Georreferenciada pela quadrícula de Macau impressa: 55 cruzes a cada 500 m, convertidas com a transformação oficial Macau 1920 para WGS 84 (EPSG:8438), um único ajuste afim com EMQ de 2,0 m e resíduo máximo de 3,9 m por validação deixando um de fora. As coordenadas actuais do marco geodésico do farol da Guia, das Portas do Cerco, da Fortaleza do Monte e os pontos do IC de São Lourenço, Penha e Santo Agostinho, projectados na digitalização, caem sobre esses edifícios ou a menos de dez metros deles. São diagnósticos do ajuste à quadrícula da própria folha e verificações pontuais, não a precisão do levantamento original. Exemplar da Library of Congress, que não indica restrições de direitos de autor conhecidas.',
    },
  },
  {
    id: 'dscc-1991',
    name: { zh: '《澳門地區》1:20,000', en: 'Território de Macau, 1:20,000', pt: 'Território de Macau, escala 1:20 000' },
    title: {
      zh: '澳門地區（地圖繪製暨地籍司，1991，1:20,000）',
      en: 'Território de Macau, escala 1:20 000 (Direcção dos Serviços de Cartografia e Cadastro, 1991)',
      pt: 'Território de Macau, escala 1:20 000 (Direcção dos Serviços de Cartografia e Cadastro, 1991)',
    },
    author: 'Direcção dos Serviços de Cartografia e Cadastro, Macau',
    year: 1991,
    published: 1991,
    work: 'Território de Macau, escala 1:20 000 = [Ao-men ti chʻü, pi li] 1:20 000; Library of Congress G7823.M2 1991 .M3 MLC',
    scan: {
      holder: 'Library of Congress, Geography and Map Division',
      via: 'Wikimedia Commons',
      identifier: '92684636 / g7823m.ct000642',
      url: 'https://www.loc.gov/item/92684636/',
      leaves: [],
      license: RIGHTS,
    },
    attribution: 'Território de Macau 1:20 000, Direcção dos Serviços de Cartografia e Cadastro, 1991. Scan: Library of Congress, Geography and Map Division, via Wikimedia Commons. Georeferenced on the printed Macau grid by mini-macau.',
    references: [
      { name: 'Wikimedia Commons — original 6,258 × 8,663 px scan', url: 'https://commons.wikimedia.org/wiki/File:Territ%C3%B3rio_de_Macau,_escala_1-20_000_%3D_(Ao-men_ti_ch%CA%BB%C3%BC,_pi_li)_1-20_000._LOC_92684636.jpg' },
      { name: 'EPSG:8433 — Macao 1920 / Macao Grid (the printed grid)', url: 'https://epsg.io/8433' },
      { name: 'EPSG:8438 — Macao 1920 to WGS 84 transformation', url: 'https://epsg.io/8438' },
    ],
    source: {
      kind: 'sheet',
      url: 'https://upload.wikimedia.org/wikipedia/commons/9/96/Territ%C3%B3rio_de_Macau%2C_escala_1-20_000_%3D_%28Ao-men_ti_ch%CA%BB%C3%BC%2C_pi_li%29_1-20_000._LOC_92684636.jpg',
      file: 'loc-92684636.jpg',
      registrationOrigin: [0, 0],
    },
    projection: 'affine',
    lambda: null,
    resM: 3,
    // One scan pixel is 1.65 m; z16 (1.1 m/px) keeps the lettering and contours legible.
    tiles: { maxzoom: 16 },
    marginKm: 1,
    gcpSpace: 'sheet',
    // Printed Macau-grid crosses every 2 km, E 17 000–27 000 / N 7 000–21 000. Three crosses
    // on busy ground (E21000 N19000, E25000 N19000, E25000 N11000) were not accepted.
    gcps: [
    ['grid E19000 N19000', 1336.13, 1287.31, 113.5297693, 22.2021727],
    ['grid E23000 N19000', 3766.34, 1310.82, 113.5685612, 22.2021539],
    ['grid E19000 N17000', 1323.78, 2500.27, 113.5297618, 22.1841111],
    ['grid E21000 N17000', 2539.15, 2512.15, 113.5491552, 22.1841029],
    ['grid E23000 N17000', 3753.68, 2522.62, 113.5685486, 22.1840924],
    ['grid E25000 N17000', 4965.23, 2533.71, 113.5879421, 22.1840795],
    ['grid E19000 N15000', 1308.92, 3713.40, 113.5297542, 22.1660494],
    ['grid E21000 N15000', 2525.59, 3724.26, 113.5491452, 22.1660412],
    ['grid E23000 N15000', 3740.15, 3734.85, 113.5685361, 22.1660307],
    ['grid E25000 N15000', 4951.71, 3745.68, 113.5879271, 22.1660179],
    ['grid E19000 N13000', 1295.98, 4926.44, 113.5297466, 22.1479877],
    ['grid E21000 N13000', 2512.74, 4936.98, 113.5491351, 22.1479795],
    ['grid E23000 N13000', 3726.59, 4945.96, 113.5685236, 22.1479690],
    ['grid E25000 N13000', 4939.01, 4956.84, 113.5879121, 22.1479562],
    ['grid E19000 N11000', 1283.19, 6140.11, 113.5297391, 22.1299260],
    ['grid E21000 N11000', 2500.11, 6149.40, 113.5491251, 22.1299178],
    ['grid E23000 N11000', 3715.20, 6158.68, 113.5685111, 22.1299073],
    ['grid E19000 N9000', 1270.64, 7353.19, 113.5297315, 22.1118642],
    ['grid E21000 N9000', 2486.44, 7362.97, 113.5491151, 22.1118561],
    ['grid E23000 N9000', 3700.69, 7370.09, 113.5684986, 22.1118456],
    ['grid E25000 N9000', 4913.26, 7379.06, 113.5878822, 22.1118328],
    ].map(([name, u, v, lng, lat]) => [name, u, v, lng, lat, 'printed Macau-grid cross; EPSG:8433 → WGS 84 (EPSG:8438)']),
    notes: {
      zh: '地圖繪製暨地籍司 1991 年出版的全澳 1:20,000 地圖，涵蓋半島、氹仔與路環，以及嘉樂庇總督大橋，氹仔至路環的連貫公路橫越仍是海面的水域；10 米等高線。海上的範圍線標示進行中或規劃的工程，不代表當時已成陸。以圖上印製的澳門座標格網配準：每 2 公里一個十字，共用 21 個，按官方澳門 1920 基準至 WGS 84 轉換（EPSG:8438）換算，單一仿射擬合均方根 2.8 米，留一驗證最大 6.4 米。另把東望洋、關閘及西望洋的現代座標反投到原圖，均落在對應地物上。以上是對圖面格網的擬合與抽查，不等於原圖本身的測繪精度。掃描為美國國會圖書館藏本，館方列明無已知版權限制。',
      en: 'The 1991 1:20,000 map of the whole territory by the Direcção dos Serviços de Cartografia e Cadastro: the peninsula, Taipa and Coloane with the Governor Nobre de Carvalho Bridge and the Taipa–Coloane causeway across still-open water, and 10 m contours. Outlines in the water mark works under way or planned, not completed land. Registered on the printed Macau grid: 21 grid crosses at 2 km spacing, converted with the official Macao 1920 to WGS 84 transformation (EPSG:8438), one affine fit with 2.8 m RMS and a worst leave-one-out residual of 6.4 m. Modern coordinates of Guia, Portas do Cerco and Penha, projected back onto the scan, land on those features. These are fit diagnostics against the sheet’s own grid and spot checks, not the survey accuracy of the original. Library of Congress copy, listed by the Library with no known copyright restrictions.',
      pt: 'Mapa de todo o território na escala 1:20 000, publicado em 1991 pela Direcção dos Serviços de Cartografia e Cadastro: a península, a Taipa e Coloane, com a Ponte Governador Nobre de Carvalho e o istmo Taipa–Coloane a atravessar mar ainda aberto, e curvas de nível de 10 m. Os contornos no mar assinalam obras em curso ou projectadas, não terreno concluído. Georreferenciado pela quadrícula de Macau impressa: 21 cruzes a cada 2 km, convertidas com a transformação oficial Macau 1920 para WGS 84 (EPSG:8438), um único ajuste afim com EMQ de 2,8 m e resíduo máximo de 6,4 m por validação deixando um de fora. As coordenadas actuais da Guia, das Portas do Cerco e da Penha, projectadas na digitalização, caem sobre esses elementos. São diagnósticos do ajuste à quadrícula da própria folha e verificações pontuais, não a precisão do levantamento original. Exemplar da Library of Congress, que não indica restrições de direitos de autor conhecidas.',
    },
  },
]
