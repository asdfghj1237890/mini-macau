// Build the HISTORICAL MAPS (古地圖) overlay: download the public-domain scans, straighten,
// crop (and, for a plate bound across a fold, stitch) them, rubbersheet each plate onto modern
// coordinates with a thin-plate spline over hand-picked control points, and write
// public/data/old-maps/<id>.webp + public/data/old-maps.json.
//
//   node scripts/build-old-maps.mjs                    # all maps
//   node scripts/build-old-maps.mjs guignes-1792       # one map (the JSON keeps the others)
//   node scripts/build-old-maps.mjs baker-1796 --preview --lambda=0.1
//   node scripts/build-old-maps.mjs baker-1796 --gcps
//   node scripts/build-old-maps.mjs --check
//       --preview writes <scratch>/old-maps-preview-<id>.png (the warped plate with the true
//       control-point positions in red, so a misread point shows as a marker off its feature);
//       --gcps writes <scratch>/old-maps-gcps-<id>.png, a contact sheet with a 2× window of the
//       scan around every control point and a crosshair on the pixel the table names;
//       --check fits one affine per map and prints each control point's residual and its
//       leave-one-out residual (a pick on the wrong building shows up there, not in the TPS);
//       --lambda overrides the smoothing for that run without touching the JSON's recipe.
//
// sharp is borrowed from wrangler's miniflare, like build-pwa-icons.mjs. Source scans are
// cached under .cache/old-maps/ (gitignored); only the derived WebP and the JSON are committed.
//
// Georeferencing notes:
//   - Control points are buildings from each map's own legend matched to today's coordinates:
//     IC heritage GPS from religion.json where the site is classified (given as the IC code),
//     else OSM. Both 18th-century plans draw the peninsula shorter than it is (the isthmus
//     north of the city most of all), so a single affine leaves errors of hundreds of metres.
//     The plates are therefore treated as cloth: the thin-plate spline interpolates EXACTLY
//     (λ = 0), so every control point lands on its feature and the paper between the pins is
//     stretched or pinched as needed. The residuals the JSON quotes are therefore zero; what
//     the fit is worth between the pins is said in each map's notes. Far from the control
//     points (open sea, the Zhuhai shore) the spline extrapolates — decoration, not data.
//   - The two 18th-century plates get a second stage, the COAST SNAP (buildCoastSnap, switched
//     on by `coastSnap: {}` in the table): scripts/old-maps-coast/<id>.json holds dense pairs of
//     a pixel on the plate's drawn coast line and the point of the coast of 1794 it stands for
//     (the 1889 survey's shoreline where it was still the old one; along the Inner Harbour the
//     line through the streets the 1993 Geografia names), round the whole peninsula, and the
//     paper is walked onto that shoreline in small one-to-one moves, so the whole drawn coast
//     coincides with it and not only the coast pins of the table.
//     OLD_MAPS_SNAP_DEBUG=1 lists what is left, the flipped samples of the fold check, and
//     writes .cache/old-maps/snap-debug-<id>.json (target / spline / snapped per pair).
//   - guignes-1792: the Getty Research Institute copy of the atlas on the Internet Archive
//     (gri_33125008481232), leaves n141 (north half) and n142 (south half) — the plate is
//     bound sideways across a fold, so each leaf is rotated 90° clockwise, cropped to the
//     neat line and stacked with a 68 px GAP: the binding hides a strip of the plate in the
//     gutter (see the source block), which is left blank.
//   - baker-1796: the Library of Congress sheet (loc.gov/item/2002628198, mirrored on
//     Wikimedia Commons), one scan, cropped to the inner fillet of the double border.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const sharp = require('sharp')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'old-maps')
const OUT_DIR = path.join(ROOT, 'public', 'data', 'old-maps')
const OUT_JSON = path.join(ROOT, 'public', 'data', 'old-maps.json')
fs.mkdirSync(CACHE, { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const argv = process.argv.slice(2)
const only = argv.find(a => !a.startsWith('--'))
const PREVIEW = argv.includes('--preview')
const GCPS = argv.includes('--gcps')
const CHECK = argv.includes('--check')
const LAMBDA_OVERRIDE = (() => { const a = argv.find(x => x.startsWith('--lambda=')); return a ? Number(a.slice(9)) : null })()
const PREVIEW_DIR = process.env.OLD_MAPS_PREVIEW_DIR || CACHE

// ---------------------------------------------------------------------------
// The maps, oldest first. `gcps` are [name, plate x, plate y, lng | IC code, lat | null, note]
// in the pixel space `gcpSpace` names: 'plate' = the cropped/stitched plate, 'sheet' = the
// downloaded scan before cropping (handy when the points were read off the raw scan).
// ---------------------------------------------------------------------------
const MAPS = [
  {
    id: 'guignes-1792',
    name: {
      zh: '小德金《澳門城平面圖》',
      en: 'de Guignes, Plan de la Ville de Macao',
      pt: 'de Guignes, Plan de la Ville de Macao',
    },
    title: {
      zh: '澳門城平面圖（小德金，1792 年繪、1808 年刊）',
      en: 'Plan de la Ville de Macao (de Guignes, drawn 1792, published 1808)',
      pt: 'Plan de la Ville de Macao (de Guignes, desenhado em 1792, publicado em 1808)',
    },
    author: 'Chrétien-Louis-Joseph de Guignes (1759–1845); engraved by François d’Houdan',
    year: 1792,
    published: 1808,
    work: 'Voyages à Péking, Manille et l’île de France, faits dans l’intervalle des années 1784 à 1801 — atlas, planche 94',
    scan: {
      holder: 'Getty Research Institute',
      via: 'Internet Archive',
      identifier: 'gri_33125008481232',
      url: 'https://archive.org/details/gri_33125008481232',
      leaves: ['n141', 'n142'],
      license: 'Public domain (the work is from 1808; the Getty scan carries no restrictions)',
    },
    references: [
      { name: 'BnF catalogue record', url: 'https://catalogue.bnf.fr/ark:/12148/cb30555797m' },
      { name: 'MUST Library, Global Mapping of Macao (description of this plate)', url: 'https://libspc.must.edu.mo/fullRead/000051/991003001149605076' },
    ],
    source: {
      kind: 'stitch', rotate: 90,
      leaves: { north: 'n141', south: 'n142' },
      urlFor: leaf => `https://archive.org/download/gri_33125008481232/page/${leaf}.jpg`,
      fileFor: leaf => `gri_33125008481232-${leaf}.jpg`,
      // The atlas is bound through the plate: a strip about 68 px tall (some 120 m on the ground) is
      // hidden in the gutter between the two leaves. It is left blank rather than closed up — the
      // landmark pins on either side of the seam and the east coast, which leaves the north leaf at
      // x 1897 and enters the south leaf at x 1792, both put the south leaf about 100 px lower than
      // a butt joint with the old 32 px overlap did.
      crop: { left: 224, right: 2756, northTop: 470, southBottom: 1610 }, gapPx: 68,
    },
    lambda: 0,
    resM: 2.5,
    marginKm: 2.2,
    gcpSpace: 'plate',
    // stage 2: snap the drawn coast onto the reference shoreline, the coast of 1794 (pairs in scripts/old-maps-coast/guignes-1792.json)
    coastSnap: {},
    gcps: [
      ['1 Porte de Cercle 關閘', 1626, 230, 113.54921, 22.21594, '1870 arch; the 1792 gate stood on the same isthmus'],
      ['2 I. Verte 青洲山頂', 1197, 410, 113.53764, 22.21143, 'island summit (OSM peak)'],
      ['3 Pagode de Cercle 蓮峯廟', 1603, 618, 'MM024', null, 'IC heritage GPS'],
      ['6 St Antoine 聖安多尼堂', 1351, 1000, 'MM002', null, 'IC heritage GPS'],
      ['40 Grote du Camoens 白鴿巢', 1382, 912, 113.5394, 22.2003, 'Camões grotto'],
      ['19 Fort de la Monte 大炮台', 1473, 1218, 113.54237, 22.19703, 'OSM fort centroid'],
      ['20 St Paul 大三巴', 1390, 1158, 'MM008', null, 'IC heritage GPS'],
      ['24 Le Senat 議事亭', 1306, 1480, 113.5395, 22.19335, 'Leal Senado building'],
      ['27 St Augustin 聖奧斯定堂', 1204, 1570, 'MM001', null, 'IC heritage GPS'],
      ['28 St Joseph 聖若瑟修院', 1132, 1571, 113.5376, 22.1918, 'OSM relation centroid'],
      ['29 St Laurent 聖老楞佐堂', 1127, 1647, 'MM005', null, 'the church block with its forecourt, west of the "29"; IC heritage GPS'],
      ['9 Fort S. Francisco 嘉思欄炮台', 1623, 1586, 113.5442, 22.19099, 'demolished fort; position taken from the 1889 survey'],
      ['23 Fort Bonpart 燒灰爐炮台', 1141, 1929, 113.53698, 22.18647, 'demolished fort; position taken from the 1889 survey'],
      ['32 La Pena 西望洋', 1039, 1874, 'AM002', null, 'IC heritage GPS'],
      ['12 Pagode de la Barre 媽閣廟', 712, 2000, 'MM020', null, 'the temple compound, west of the "12"; IC heritage GPS'],
      ['11 Fort de la Barre 聖地牙哥炮台', 651, 2261, 113.53071, 22.18268, 'Pousada de São Tiago'],
      ['7 St Lazare 望德堂', 1620, 1250, 'MM004', null, 'the cross-shaped church in the hospital enclosure; IC heritage GPS'],
      ['8 Fort de la Guya 東望洋炮台', 1790, 1312, 113.54969, 22.19654, 'fort centroid (OSM)'],
      ['21 St Dominique 玫瑰堂', 1365, 1308, 'MM003', null, 'IC heritage GPS'],
      ['25 La Cathédrale 主教座堂', 1420, 1470, 'MM006', null, 'the block beside the "25"; IC heritage GPS'],
      ['45 Fontaine 亞婆井', 1029, 1800, 113.53520, 22.18837, 'the Lilau spring, Largo do Lilau (approximate)'],
      ['4 Village de Moha 望廈村', 1760, 740, 113.5495, 22.2045, 'the village street; today\u2019s Mong Há (approximate)'],
      ['Ilha Verde W tip 青洲西端', 1105, 411, 113.53633, 22.21096, 'west end of the island as drawn; target from the 1889 survey'],
      ['Ilha Verde E tip 青洲東端', 1293, 411, 113.53926, 22.21100, 'east end of the island as drawn; target from the 1889 survey'],
      ['coast east gateE', 1696, 238, 113.55034, 22.21594, 'coast'],
      ['coast east gateE>rocksA 1/8', 1693, 313, 113.54994, 22.21489, 'coast'],
      ['coast east gateE>rocksA 2/8', 1699, 388, 113.54968, 22.2138, 'coast'],
      ['coast east gateE>rocksA 3/8', 1711, 463, 113.54942, 22.21271, 'coast'],
      ['coast east gateE>rocksA 4/8', 1740, 532, 113.54928, 22.21161, 'coast'],
      ['coast east gateE>rocksA 5/8', 1785, 593, 113.54941, 22.21053, 'coast'],
      ['coast east gateE>rocksA 6/8', 1848, 634, 113.54986, 22.20949, 'coast'],
      ['coast east ptA', 2006, 633, 113.55104, 22.20708, 'coast'],
      ['coast east hdB', 2121, 665, 113.55207, 22.20669, 'coast'],
      ['coast east bE', 2147, 681, 113.55205, 22.20592, 'coast'],
      ['coast east bE>knob 1/6', 2177, 686, 113.55274, 22.20504, 'coast'],
      ['coast east bE>knob 2/6', 2206, 679, 113.5538, 22.20475, 'coast'],
      ['coast east bE>knob 3/6', 2233, 667, 113.5549, 22.20438, 'coast'],
      ['coast east bE>knob 4/6', 2260, 653, 113.55613, 22.20462, 'coast'],
      ['coast east bE>knob 5/6', 2272, 625, 113.5573, 22.20493, 'coast'],
      ['coast east knob', 2291, 602, 113.55779, 22.20581, 'coast'],
      ['coast east knob>tipE 1/2', 2304, 659, 113.55836, 22.20555, 'coast'],
      ['coast east tipE', 2333, 712, 113.55872, 22.20467, 'coast'],
      ['coast east tipE>beachN 1/4', 2315, 756, 113.5579, 22.20384, 'coast'],
      ['coast east tipE>beachN 2/4', 2302, 801, 113.5574, 22.20292, 'coast'],
      ['coast east tipE>beachN 3/4', 2279, 843, 113.55641, 22.20256, 'coast'],
      ['coast east beachN', 2237, 859, 113.55569, 22.20222, 'coast'],
      ['coast east beachN>beachS 1/2', 2198, 880, 113.55527, 22.20159, 'coast'],
      ['coast east beachS', 2187, 922, 113.55488, 22.20078, 'coast'],
      ['coast east cacPt', 2206, 930, 113.55506, 22.20064, 'coast'],
      ['coast east cacPt>sfEnd 1/14', 2185, 984, 113.55504, 22.19958, 'coast'],
      ['coast east cacPt>sfEnd 2/14', 2140, 1030, 113.55511, 22.19846, 'coast'],
      ['coast east cacPt>sfEnd 3/14', 2098, 1079, 113.55496, 22.19739, 'coast'],
      ['coast east cacPt>sfEnd 4/14', 2066, 1134, 113.55388, 22.19699, 'coast'],
      ['coast east cacPt>sfEnd 5/14', 2015, 1173, 113.55293, 22.19641, 'coast'],
      ['coast east cacPt>sfEnd 6/14', 2000, 1234, 113.55224, 22.19566, 'coast'],
      ['coast east cacPt>sfEnd 7/14', 1961, 1284, 113.55144, 22.19479, 'coast'],
      ['coast east cacPt>sfEnd 8/14', 1907, 1318, 113.55025, 22.19462, 'coast'],
      ['coast east cacPt>sfEnd 11/14', 1782, 1455, 113.54739, 22.19305, 'coast'],
      ['coast east cacPt>sfEnd 12/14', 1733, 1498, 113.54654, 22.19226, 'coast'],
      ['coast east cacPt>sfEnd 13/14', 1698, 1552, 113.54561, 22.19156, 'coast'],
      ['coast south pgNE>bpTurn 1/10', 1529, 1513, 113.5432, 22.1923, 'coast'],
      ['coast south pgNE>bpTurn 2/10', 1458, 1518, 113.54208, 22.19246, 'coast'],
      ['coast south pgNE>bpTurn 3/10', 1392, 1553, 113.54099, 22.19212, 'coast'],
      ['coast south pgNE>bpTurn 4/10', 1338, 1589, 113.54003, 22.19154, 'coast'],
      ['coast south pgNE>bpTurn 5/10', 1285, 1634, 113.53936, 22.19078, 'coast'],
      ['coast south pgNE>bpTurn 6/10', 1241, 1693, 113.53879, 22.19001, 'coast'],
      ['coast south pgNE>bpTurn 7/10', 1202, 1757, 113.53824, 22.18916, 'coast'],
      ['coast south pgNE>bpTurn 8/10', 1172, 1825, 113.53785, 22.18813, 'coast'],
      ['coast south pgNE>bpTurn 9/10', 1161, 1898, 113.53766, 22.18701, 'coast'],
      ['coast south bpTurn', 1180, 1967, 113.53726, 22.18594, 'coast'],
      ['coast south bpTurn>beachE 1/2', 1161, 1979, 113.53635, 22.1859, 'coast'],
      ['coast south beachE', 1139, 1990, 113.53553, 22.18563, 'coast'],
      ['coast south beachE>chacara 1/2', 1081, 2029, 113.53496, 22.18497, 'coast'],
      ['coast south chacara', 1072, 2097, 113.53544, 22.18438, 'coast'],
      ['coast south chacara>southTip 1/5', 1006, 2127, 113.53438, 22.18442, 'coast'],
      ['coast south chacara>southTip 2/5', 957, 2198, 113.53419, 22.18366, 'coast'],
      ['coast south chacara>southTip 3/5', 907, 2267, 113.53357, 22.18334, 'coast'],
      ['coast south chacara>southTip 4/5', 876, 2348, 113.53349, 22.18226, 'coast'],
      ['coast south southTip', 832, 2410, 113.53315, 22.18126, 'coast'],
      ['coast south southTip>fortS 1/3', 768, 2379, 113.5322, 22.18125, 'coast'],
      ['coast south southTip>fortS 2/3', 702, 2349, 113.53132, 22.18175, 'coast'],
      ['coast west gateW', 1548, 239, 113.54849, 22.21583, 'coast'],
      ['coast west gateW>pagodaShore 1/6', 1567, 296, 113.54851, 22.21476, 'coast'],
      ['coast west gateW>pagodaShore 2/6', 1572, 366, 113.54835, 22.21368, 'coast'],
      ['coast west gateW>pagodaShore 3/6', 1574, 437, 113.54804, 22.21263, 'coast'],
      ['coast west gateW>pagodaShore 4/6', 1575, 508, 113.54769, 22.21158, 'coast'],
      ['coast west gateW>pagodaShore 5/6', 1570, 578, 113.54736, 22.21055, 'coast'],
      ['coast west pagodaShore', 1553, 638, 113.54691, 22.20957, 'coast'],
      ['coast west pagodaShore>bayTurn 1/3', 1536, 698, 113.54649, 22.20834, 'coast'],
      ['coast west pagodaShore>bayTurn 2/3', 1502, 751, 113.54618, 22.20718, 'coast'],
      ['coast west bayTurn', 1456, 790, 113.5462, 22.20625, 'coast'],
      ['coast west bayTurn>corner 1/9', 1432, 802, 113.54549, 22.20547, 'coast'],
      ['coast west bayTurn>corner 2/9', 1407, 815, 113.54474, 22.2047, 'coast'],
      ['coast west bayTurn>corner 3/9', 1381, 824, 113.54383, 22.20402, 'coast'],
      ['coast west bayTurn>corner 8/9', 1248, 847, 113.53862, 22.202, 'coast'],
      ['coast west corner', 1223, 857, 113.53764, 22.20146, 'coast'],
      ['coast west corner>sidakou 1/10', 1237, 934, 113.53743, 22.20045, 'coast'],
      ['coast west corner>sidakou 2/10', 1225, 1010, 113.53774, 22.19949, 'coast'],
      ['coast west corner>sidakou 3/10', 1193, 1082, 113.53811, 22.19858, 'coast'],
      ['coast west corner>sidakou 4/10', 1204, 1154, 113.53844, 22.19769, 'coast'],
      ['coast west corner>sidakou 5/10', 1187, 1209, 113.53862, 22.19674, 'coast'],
      ['coast west corner>sidakou 7/10', 1067, 1294, 113.53803, 22.19497, 'coast'],
      ['coast west corner>sidakou 9/10', 1011, 1439, 113.53616, 22.19413, 'coast'],
      ['coast west sidakou', 1000, 1514, 113.53535, 22.19365, 'coast'],
      ['coast west sidakou>temple 1/9', 953, 1558, 113.53518, 22.19271, 'coast'],
      ['coast west sidakou>temple 2/9', 918, 1616, 113.53504, 22.19174, 'coast'],
      ['coast west sidakou>temple 3/9', 927, 1686, 113.53498, 22.1907, 'coast'],
      ['coast west sidakou>temple 4/9', 866, 1720, 113.53458, 22.18974, 'coast'],
      ['coast west sidakou>temple 5/9', 817, 1763, 113.53396, 22.18886, 'coast'],
      ['coast west sidakou>temple 6/9', 785, 1826, 113.53299, 22.18858, 'coast'],
      ['coast west sidakou>temple 7/9', 740, 1882, 113.53186, 22.18815, 'coast'],
      ['coast west sidakou>temple 8/9', 709, 1946, 113.53124, 22.18705, 'coast'],
      ['coast west temple', 676, 2008, 113.53069, 22.186, 'coast'],
      ['coast west temple>fortS 1/4', 682, 2087, 113.53085, 22.18495, 'coast'],
      ['coast west temple>fortS 2/4', 673, 2165, 113.53081, 22.18393, 'coast'],
      ['coast west temple>fortS 3/4', 638, 2235, 113.53031, 22.18307, 'coast'],
    ],
    notes: {
      zh: '以曼努埃爾·德·阿格特 1792 年的平面圖為底本；城牆內的市街、炮台、教堂與各國東印度公司相當精確，城北望廈一帶的田野被畫短了約 800 公尺，配準時用薄板樣條拉伸校正。原圖跨頁裝訂，書溝遮住一條約 125 公尺寬的圖面（東望洋山東南岸有一小段因此空白），拼接時照實留白，不硬湊。整條海岸線每約 120 公尺釘在 1794 年的岸線上：1889 年實測圖尚未填海的岸段（關閘至嘉思欄的東岸、南灣、西灣、媽閣）直接取該圖的岸線，1863 年後填掉的內港岸線依《澳門地理》（1993）所述的今日街道（羅若翰神父街、渡船街、白鴿巢北麓、快艇頭街、庇山耶街、宜安街、司打口、下環街）。整條海岸線再做一次「岸線貼合」：描出圖上的海岸實線，依兩張圖都有的特徵（各個岬角、黑沙環灣沙灘的兩端、燒灰爐炮台下的轉角、半島最南端的礁角、司打口的小灣、媽閣廟前、聖地牙哥炮台）按弧長每約 12 公尺一點對到這條 1794 年的岸線，分 16 小步把紙推過去，所以畫出來的海岸與它重合。內港一帶圖上畫的是碼頭、突堤與小灣交錯的臨水線，而參考線只是今日街道連成的概略線，所以那一段對的是臨水線的大致走向，碼頭與小灣跟著移動、不會被壓平；媽閣廟到聖地牙哥炮台之間 1889 年已是船塢與填海地，改沿媽閣山腳的舊路。馬交石岬角北面圖上畫的不到實際長度的一半，東望洋山東南角幾乎畫成直線，這些地方的紙拉伸得最厲害，岸邊的山形暈滃與礁石記號會跟著變形；沙梨頭一帶圖上也畫得太短。',
      en: 'Based on Manuel de Agote’s 1792 plan; the walled town, forts, churches and the East India companies’ houses are drawn accurately, but the fields north of the city are foreshortened by about 800 m, which the thin-plate-spline georeference stretches back into place. The plate is bound across a fold and the gutter hides a strip about 125 m wide (a short piece of the coast under the Guia hill with it); the two leaves are stitched with that strip left blank rather than pushed together. The whole shoreline is pinned about every 120 m to the coast of 1794: where the 1889 survey still shows the old shore (the east coast from the Barrier Gate to the S. Francisco fort, the Praia Grande, Sai Van and the Barra) its shoreline is used directly, and along the Inner Harbour, reclaimed after 1863, the line follows the streets the 1993 Geografia de Macau names (Rua do Padre João Clímaco, Rua da Barca, the north foot of the Camões hill, Rua dos Faitiões, Rua de Camilo Pessanha, Travessa da Felicidade, Ponte e Horta, Rua da Praia do Manduco). The whole shoreline then gets a second pass, the coast snap: the solid coast line of the drawing is traced, paired about every 12 m with that coast of 1794 by arc length between features both drawings have (the headlands, both ends of the Cacilhas beach, the turn under the Bom Parto fort, the rocky spur at the peninsula’s southern end, the small dock at Ponte e Horta, the shore before the A-Ma temple, the Barra fort), and the paper is walked onto it in 16 small moves, so the drawn coast coincides with it. Along the Inner Harbour the drawing shows a waterfront of wharves, piers and small inlets while the reference is only a generalised line through today’s streets, so there it is the general run of the waterfront that is matched and the wharves and inlets ride along instead of being flattened; between the A-Ma temple and the Barra fort, where the 1889 sheet already shows a dock and made ground, the line follows the old road at the foot of the Barra hill. The north face of the promontory under the D. Maria II fort is drawn at well under half its real length and the south-east corner of the Guia hill almost as a straight line, so the paper is stretched most there and the hill shading and rock marks beside the shore are deformed with it; the Patane bay is drawn too short as well.',
      pt: 'Baseado no plano de Manuel de Agote de 1792; a cidade murada, os fortes, as igrejas e as casas das companhias das Índias estão bem desenhados, mas os campos a norte da cidade aparecem encurtados em cerca de 800 m, o que a georreferenciação por spline corrige. A estampa está encadernada sobre uma dobra e a goteira esconde uma faixa de cerca de 125 m (e com ela um pequeno troço da costa sob a colina da Guia); as duas folhas são unidas deixando essa faixa em branco, sem as encostar. Toda a linha de costa está fixada de cerca de 120 em 120 m à costa de 1794: onde o levantamento de 1889 ainda mostra a costa antiga (a costa leste das Portas do Cerco ao forte de S. Francisco, a Praia Grande, Sai Van e a Barra) usa-se directamente a sua linha de costa, e ao longo do Porto Interior, aterrado depois de 1863, a linha segue as ruas que a Geografia de Macau de 1993 nomeia (Rua do Padre João Clímaco, Rua da Barca, o sopé norte da colina de Camões, Rua dos Faitiões, Rua de Camilo Pessanha, Travessa da Felicidade, Ponte e Horta, Rua da Praia do Manduco). Toda a linha de costa recebe depois uma segunda passagem, o ajuste da costa: a linha de costa desenhada é decalcada, emparelhada de cerca de 12 em 12 m com essa costa de 1794 pelo comprimento de arco entre acidentes que ambos os desenhos têm (os promontórios, os dois extremos da praia de Cacilhas, a curva sob o forte do Bom Parto, o esporão rochoso no extremo sul da península, a pequena doca de Ponte e Horta, a margem diante do templo de A-Má, o forte da Barra), e o papel é levado até ela em 16 pequenos passos, pelo que a costa desenhada coincide com ela. Ao longo do Porto Interior o desenho mostra uma frente de cais, pontões e pequenas enseadas, enquanto a referência é apenas uma linha generalizada pelas ruas de hoje; aí ajusta-se o andamento geral da frente ribeirinha, e os cais e enseadas acompanham-no em vez de serem achatados; entre o templo de A-Má e o forte da Barra, onde a folha de 1889 já mostra uma doca e aterros, a linha segue a antiga estrada no sopé da colina da Barra. A face norte do promontório sob o forte de D. Maria II está desenhada com bem menos de metade do comprimento real e o canto sueste da colina da Guia quase em linha recta; é aí que o papel fica mais esticado, e o sombreado dos montes e os sinais de rochas junto à costa deformam-se com ele; a baía do Patane também está desenhada demasiado curta.',
    },
  },
  {
    id: 'baker-1796',
    name: {
      zh: '貝克《澳門城與港平面圖》',
      en: 'Baker, Plan of the City and Harbour of Macao',
      pt: 'Baker, Plan of the City and Harbour of Macao',
    },
    title: {
      zh: '澳門城與港平面圖（貝克刻，1796 年，斯當東《英使謁見乾隆紀實》圖冊）',
      en: 'A Plan of the City and Harbour of Macao (engraved by Benjamin Baker, 1796, for Staunton’s Authentic Account of the Macartney embassy)',
      pt: 'A Plan of the City and Harbour of Macao (gravado por Benjamin Baker, 1796, para o Authentic Account de Staunton sobre a embaixada Macartney)',
    },
    author: 'Engraved by Benjamin Baker (fl. 1766–1824), Islington; published by George Nicol, London, 12 April 1796',
    year: 1796,
    published: 1797,
    work: 'Sir George Staunton, An Authentic Account of an Embassy from the King of Great Britain to the Emperor of China (London: G. Nicol, 1797) — folio volume of plates',
    scan: {
      holder: 'Library of Congress, Geography and Map Division',
      via: 'Wikimedia Commons',
      identifier: '2002628198',
      url: 'https://www.loc.gov/item/2002628198/',
      leaves: [],
      license: 'Public domain (published 1796; the Library of Congress lists no known restrictions on publication)',
    },
    references: [
      { name: 'Wikimedia Commons file (the mirror this build downloads)', url: 'https://commons.wikimedia.org/wiki/File:A_Plan_of_the_city_and_harbour_of_Macao_-_a_colony_of_the_Portugueze,_situated_at_the_southern_extremity_of_the_Chinese_Empire_in_Lat._22_%E2%81%B012%CA%B944%CA%BA_N.,_long._113%E2%81%B035%CA%B90%CA%BA_east_of_Greenwich_LOC_2002628198.jpg' },
      { name: 'MUST Library, Global Mapping of Macao (description of this plate)', url: 'https://libspc.must.edu.mo/fullRead/000051/991003375723705076' },
    ],
    source: {
      kind: 'sheet',
      url: 'https://upload.wikimedia.org/wikipedia/commons/4/45/A_Plan_of_the_city_and_harbour_of_Macao_-_a_colony_of_the_Portugueze%2C_situated_at_the_southern_extremity_of_the_Chinese_Empire_in_Lat._22_%E2%81%B012%CA%B944%CA%BA_N.%2C_long._113%E2%81%B035%CA%B90%CA%BA_east_of_Greenwich_LOC_2002628198.jpg',
      file: 'loc-2002628198.jpg',
      // Inside the inner fillet of the double border (dark-line scan of the sheet edges).
      crop: { left: 27, top: 51, width: 6305, height: 8276 },
      // The scan is 0.845 m/px (1500 yards = 1623 px on its own scale bar); box-shrink it
      // before the warp so the 3 m/px output is a proper minification, not point sampling.
      shrink: 3,
    },
    lambda: 0,
    resM: 3,
    marginKm: 5,
    gcpSpace: 'sheet',
    // stage 2: snap the drawn coast onto the reference shoreline, the coast of 1794 (pairs in scripts/old-maps-coast/baker-1796.json)
    coastSnap: {},
    gcps: [
      ['32 Puerta del Cerco 關閘', 3830, 2490, 113.54921, 22.21594, 'the gate block on the isthmus wall'],
      ['31 Isla Verde 青洲山頂', 3068, 2790, 113.53764, 22.21143, 'island summit (OSM peak)'],
      ['34 Sang-miau, a Chinese Temple 蓮峯廟', 3783, 3190, 'MM024', null, 'IC heritage GPS'],
      ['9 S. Antonio 聖安多尼堂', 3360, 3732, 'MM002', null, 'IC heritage GPS'],
      ['11 The College of St Paul 大三巴', 3412, 4050, 'MM008', null, 'IC heritage GPS'],
      ['1 Sto Paulo del monte 大炮台', 3535, 4095, 113.54237, 22.19703, 'OSM fort centroid'],
      ['2 N.S. de Guia 東望洋炮台', 4098, 4250, 113.549678, 22.196596, 'Guia chapel (OSM)'],
      ['17 Chapel of the Hospital S. Lazaro 望德堂', 3835, 4168, 'MM004', null, 'IC heritage GPS'],
      ['14 The Dominican 玫瑰堂', 3315, 4272, 'MM003', null, 'IC heritage GPS'],
      ['7 The Cathedral 主教座堂', 3488, 4428, 'MM006', null, 'IC heritage GPS'],
      ['20 The Senate House 議事亭', 3230, 4545, 113.5395, 22.19335, 'Leal Senado building'],
      ['12 The Augustine 聖奧斯定堂', 3075, 4700, 'MM001', null, 'IC heritage GPS'],
      ['10 The Royal College of St Joseph 聖若瑟修院', 2915, 4700, 'MM007', null, 'IC heritage GPS'],
      ['8 S. Lorenzo 聖老楞佐堂', 2935, 4830, 'MM005', null, 'IC heritage GPS'],
      ['5 S. Francisco 嘉思欄炮台', 3785, 4785, 113.5442, 22.19099, 'demolished fort; position taken from the 1889 survey'],
      ['18 N.S. de la Pena de Francia 西望洋', 2755, 5228, 'AM002', null, 'IC heritage GPS'],
      ['4 N.S. de Buen Parto 燒灰爐炮台', 2915, 5385, 113.53698, 22.18647, 'demolished fort; position taken from the 1889 survey'],
      ['36 A Chinese Temple 媽閣廟', 2168, 5460, 'MM020', null, 'IC heritage GPS'],
      ['3 S. Iago de la Barra 聖地牙哥炮台', 2038, 5905, 113.53071, 22.18268, 'Pousada de São Tiago'],
      ['19 Misericordia 仁慈堂', 3312, 4461, 113.54016, 22.19373, 'the block on the NE side of the Senate square; Santa Casa (OSM)'],
      ['13 The Franciscan convent 方濟各會院', 3790, 4735, 113.5443, 22.1915, 'behind the S. Francisco fort, today the barracks (approximate)'],
      ['Isla Verde W tip 青洲西端', 2864, 2782, 113.53633, 22.21096, 'west end of the island as drawn; target from the 1889 survey'],
      ['Isla Verde E tip 青洲東端', 3233, 2782, 113.53926, 22.21100, 'east end of the island as drawn; target from the 1889 survey'],
      ['coast east gateE', 3939, 2472, 113.55034, 22.21594, 'coast'],
      ['coast east gateE>rocksA 1/8', 3939, 2585, 113.54994, 22.21489, 'coast'],
      ['coast east gateE>rocksA 2/8', 3944, 2698, 113.54968, 22.2138, 'coast'],
      ['coast east gateE>rocksA 3/8', 3954, 2810, 113.54942, 22.21271, 'coast'],
      ['coast east gateE>rocksA 4/8', 3968, 2922, 113.54928, 22.21161, 'coast'],
      ['coast east gateE>rocksA 5/8', 3985, 3034, 113.54941, 22.21053, 'coast'],
      ['coast east gateE>rocksA 6/8', 4018, 3142, 113.54986, 22.20949, 'coast'],
      ['coast east gateE>rocksA 7/8', 4083, 3232, 113.55019, 22.20848, 'coast'],
      ['coast east ptA', 4240, 3232, 113.55104, 22.20708, 'coast'],
      ['coast east hdB', 4404, 3294, 113.55207, 22.20669, 'coast'],
      ['coast east bE', 4466, 3325, 113.55205, 22.20592, 'coast'],
      ['coast east bE>knob 1/6', 4506, 3331, 113.55274, 22.20504, 'coast'],
      ['coast east bE>knob 2/6', 4545, 3324, 113.5538, 22.20475, 'coast'],
      ['coast east bE>knob 3/6', 4580, 3305, 113.5549, 22.20438, 'coast'],
      ['coast east bE>knob 4/6', 4608, 3277, 113.55613, 22.20462, 'coast'],
      ['coast east bE>knob 5/6', 4625, 3240, 113.5573, 22.20493, 'coast'],
      ['coast east knob', 4647, 3211, 113.55779, 22.20581, 'coast'],
      ['coast east knob>tipE 1/2', 4673, 3290, 113.55836, 22.20555, 'coast'],
      ['coast east tipE', 4679, 3377, 113.55872, 22.20467, 'coast'],
      ['coast east tipE>beachN 1/4', 4656, 3430, 113.5579, 22.20384, 'coast'],
      ['coast east tipE>beachN 2/4', 4642, 3486, 113.5574, 22.20292, 'coast'],
      ['coast east tipE>beachN 3/4', 4614, 3536, 113.55641, 22.20256, 'coast'],
      ['coast east beachN', 4584, 3582, 113.55569, 22.20222, 'coast'],
      ['coast east beachN>beachS 1/2', 4512, 3620, 113.55527, 22.20159, 'coast'],
      ['coast east beachS', 4491, 3699, 113.55488, 22.20078, 'coast'],
      ['coast east cacPt', 4534, 3756, 113.55506, 22.20064, 'coast'],
      ['coast east cacPt>sfEnd 1/14', 4478, 3822, 113.55504, 22.19958, 'coast'],
      ['coast east cacPt>sfEnd 2/14', 4426, 3892, 113.55511, 22.19846, 'coast'],
      ['coast east cacPt>sfEnd 3/14', 4400, 3974, 113.55496, 22.19739, 'coast'],
      ['coast east cacPt>sfEnd 4/14', 4351, 4046, 113.55388, 22.19699, 'coast'],
      ['coast east cacPt>sfEnd 5/14', 4344, 4131, 113.55293, 22.19641, 'coast'],
      ['coast east cacPt>sfEnd 6/14', 4303, 4206, 113.55224, 22.19566, 'coast'],
      ['coast east cacPt>sfEnd 7/14', 4246, 4272, 113.55144, 22.19479, 'coast'],
      ['coast east cacPt>sfEnd 8/14', 4184, 4334, 113.55025, 22.19462, 'coast'],
      ['coast east cacPt>sfEnd 9/14', 4122, 4390, 113.54924, 22.1947, 'coast'],
      ['coast east cacPt>sfEnd 10/14', 4074, 4459, 113.54836, 22.19381, 'coast'],
      ['coast east cacPt>sfEnd 11/14', 4027, 4532, 113.54739, 22.19305, 'coast'],
      ['coast east cacPt>sfEnd 12/14', 3973, 4600, 113.54654, 22.19226, 'coast'],
      ['coast east cacPt>sfEnd 13/14', 3934, 4678, 113.54561, 22.19156, 'coast'],
      ['coast south pgNE>bpTurn 1/10', 3648, 4619, 113.5432, 22.1923, 'coast'],
      ['coast south pgNE>bpTurn 2/10', 3514, 4626, 113.54208, 22.19246, 'coast'],
      ['coast south pgNE>bpTurn 3/10', 3394, 4687, 113.54099, 22.19212, 'coast'],
      ['coast south pgNE>bpTurn 4/10', 3289, 4757, 113.54003, 22.19154, 'coast'],
      ['coast south pgNE>bpTurn 5/10', 3186, 4844, 113.53936, 22.19078, 'coast'],
      ['coast south pgNE>bpTurn 6/10', 3103, 4949, 113.53879, 22.19001, 'coast'],
      ['coast south pgNE>bpTurn 7/10', 3033, 5065, 113.53824, 22.18916, 'coast'],
      ['coast south pgNE>bpTurn 8/10', 2982, 5190, 113.53785, 22.18813, 'coast'],
      ['coast south pgNE>bpTurn 9/10', 2971, 5323, 113.53766, 22.18701, 'coast'],
      ['coast south bpTurn', 2987, 5436, 113.53726, 22.18594, 'coast'],
      ['coast south bpTurn>chacara 1/3', 2884, 5466, 113.53611, 22.18586, 'coast'],
      ['coast south bpTurn>chacara 2/3', 2811, 5543, 113.53515, 22.18529, 'coast'],
      ['coast south chacara', 2805, 5643, 113.53544, 22.18438, 'coast'],
      ['coast south chacara>southTip 1/5', 2664, 5647, 113.53438, 22.18442, 'coast'],
      ['coast south chacara>southTip 2/5', 2553, 5751, 113.53419, 22.18366, 'coast'],
      ['coast south chacara>southTip 3/5', 2449, 5861, 113.53357, 22.18334, 'coast'],
      ['coast south chacara>southTip 4/5', 2354, 5980, 113.53349, 22.18226, 'coast'],
      ['coast south southTip', 2311, 6123, 113.53315, 22.18126, 'coast'],
      ['coast south southTip>fortS 1/3', 2211, 6115, 113.5322, 22.18125, 'coast'],
      ['coast south southTip>fortS 2/3', 2111, 6069, 113.53132, 22.18175, 'coast'],
      ['coast west gateW', 3699, 2514, 113.54849, 22.21583, 'coast'],
      ['coast west gateW>pagodaShore 1/6', 3727, 2604, 113.54851, 22.21476, 'coast'],
      ['coast west gateW>pagodaShore 2/6', 3738, 2723, 113.54835, 22.21368, 'coast'],
      ['coast west gateW>pagodaShore 3/6', 3751, 2842, 113.54804, 22.21263, 'coast'],
      ['coast west gateW>pagodaShore 4/6', 3744, 2962, 113.54769, 22.21158, 'coast'],
      ['coast west gateW>pagodaShore 5/6', 3731, 3080, 113.54736, 22.21055, 'coast'],
      ['coast west pagodaShore', 3699, 3192, 113.54691, 22.20957, 'coast'],
      ['coast west pagodaShore>corner 1/12', 3693, 3250, 113.54654, 22.20847, 'coast'],
      ['coast west pagodaShore>corner 2/12', 3651, 3292, 113.54623, 22.20743, 'coast'],
      ['coast west pagodaShore>corner 3/12', 3598, 3319, 113.54646, 22.20655, 'coast'],
      ['coast west pagodaShore>corner 4/12', 3552, 3354, 113.54573, 22.20573, 'coast'],
      ['coast west pagodaShore>corner 5/12', 3502, 3373, 113.54498, 22.20491, 'coast'],
      ['coast west pagodaShore>corner 6/12', 3446, 3394, 113.54406, 22.2042, 'coast'],
      ['coast west pagodaShore>corner 7/12', 3388, 3406, 113.54311, 22.20348, 'coast'],
      ['coast west pagodaShore>corner 8/12', 3329, 3416, 113.54214, 22.20276, 'coast'],
      ['coast west pagodaShore>corner 9/12', 3271, 3428, 113.54109, 22.20216, 'coast'],
      ['coast west pagodaShore>corner 10/12', 3213, 3429, 113.53987, 22.20208, 'coast'],
      ['coast west pagodaShore>corner 11/12', 3154, 3434, 113.53866, 22.202, 'coast'],
      ['coast west corner', 3098, 3449, 113.53764, 22.20146, 'coast'],
      ['coast west corner>sidakou 1/10', 3138, 3570, 113.53743, 22.20045, 'coast'],
      ['coast west corner>sidakou 2/10', 3138, 3698, 113.53774, 22.19949, 'coast'],
      ['coast west corner>sidakou 3/10', 3093, 3819, 113.53811, 22.19858, 'coast'],
      ['coast west corner>sidakou 4/10', 3038, 3935, 113.53844, 22.19769, 'coast'],
      ['coast west corner>sidakou 5/10', 2978, 4050, 113.53862, 22.19674, 'coast'],
      ['coast west corner>sidakou 6/10', 2902, 4153, 113.53877, 22.19574, 'coast'],
      ['coast west corner>sidakou 7/10', 2837, 4264, 113.53803, 22.19497, 'coast'],
      ['coast west corner>sidakou 8/10', 2787, 4382, 113.53705, 22.19457, 'coast'],
      ['coast west corner>sidakou 9/10', 2719, 4491, 113.53616, 22.19413, 'coast'],
      ['coast west sidakou', 2681, 4614, 113.53535, 22.19365, 'coast'],
      ['coast west sidakou>temple 1/9', 2605, 4699, 113.53518, 22.19271, 'coast'],
      ['coast west sidakou>temple 2/9', 2550, 4797, 113.53504, 22.19174, 'coast'],
      ['coast west sidakou>temple 3/9', 2520, 4906, 113.53498, 22.1907, 'coast'],
      ['coast west sidakou>temple 4/9', 2438, 4983, 113.53458, 22.18974, 'coast'],
      ['coast west sidakou>temple 5/9', 2363, 5062, 113.53396, 22.18886, 'coast'],
      ['coast west sidakou>temple 6/9', 2304, 5160, 113.53299, 22.18858, 'coast'],
      ['coast west sidakou>temple 7/9', 2231, 5247, 113.53186, 22.18815, 'coast'],
      ['coast west sidakou>temple 8/9', 2182, 5350, 113.53124, 22.18705, 'coast'],
      ['coast west temple', 2112, 5440, 113.53069, 22.186, 'coast'],
      ['coast west temple>fortS 1/4', 2100, 5587, 113.53085, 22.18495, 'coast'],
      ['coast west temple>fortS 2/4', 2088, 5736, 113.53081, 22.18393, 'coast'],
      ['coast west temple>fortS 3/4', 2027, 5871, 113.53031, 22.18307, 'coast'],
    ],
    notes: {
      zh: '馬戛爾尼使團隨員所繪，內港與南灣標了測深與海床底質，青洲、對面山東岸與氹仔北岸也畫進去了；半島本身被畫短了約四分之一（關閘到聖地牙哥炮台圖上 3.2 公里，實際 4.2 公里），配準時用薄板樣條拉回，城外海面與珠海一側是樣條外推，只當裝飾。整條海岸線每約 120 公尺釘在 1794 年的岸線上：1889 年實測圖尚未填海的岸段（關閘至嘉思欄的東岸、南灣、西灣、媽閣）直接取該圖的岸線，1863 年後填掉的內港岸線依《澳門地理》（1993）所述的今日街道（羅若翰神父街、渡船街、白鴿巢北麓、快艇頭街、庇山耶街、宜安街、司打口、下環街）。整條海岸線再做一次「岸線貼合」：描出圖上的海岸實線，依兩張圖都有的特徵（各個岬角、黑沙環灣沙灘的兩端、燒灰爐炮台下的轉角、半島最南端的礁角、司打口的小灣、媽閣廟前、聖地牙哥炮台）按弧長每約 12 公尺一點對到這條 1794 年的岸線，分 16 小步把紙推過去，所以畫出來的海岸與它重合。內港一帶圖上畫的是碼頭、突堤與小灣交錯的臨水線，而參考線只是今日街道連成的概略線，所以那一段對的是臨水線的大致走向，碼頭與小灣跟著移動、不會被壓平；媽閣廟到聖地牙哥炮台之間 1889 年已是船塢與填海地，改沿媽閣山腳的舊路。馬交石岬角北面圖上畫的不到實際長度的一半，東望洋山東南角幾乎畫成直線，這些地方的紙拉伸得最厲害，岸邊的山形暈滃與礁石記號會跟著變形；沙梨頭一帶圖上也畫得太短。',
      en: 'Drawn for the Macartney embassy’s account, with soundings and seabed notes across the Inner Harbour and the Praia Grande, and Ilha Verde, the Lapa shore and the north coast of Taipa around it. The peninsula itself is drawn about a quarter too short (3.2 km from the Barrier Gate to the Barra fort against 4.2 km on the ground); the thin-plate-spline georeference stretches it back, and the sea and the Zhuhai shore beyond the control points are extrapolated decoration. The whole shoreline is pinned about every 120 m to the coast of 1794: where the 1889 survey still shows the old shore (the east coast from the Barrier Gate to the S. Francisco fort, the Praia Grande, Sai Van and the Barra) its shoreline is used directly, and along the Inner Harbour, reclaimed after 1863, the line follows the streets the 1993 Geografia de Macau names (Rua do Padre João Clímaco, Rua da Barca, the north foot of the Camões hill, Rua dos Faitiões, Rua de Camilo Pessanha, Travessa da Felicidade, Ponte e Horta, Rua da Praia do Manduco). The whole shoreline then gets a second pass, the coast snap: the solid coast line of the drawing is traced, paired about every 12 m with that coast of 1794 by arc length between features both drawings have (the headlands, both ends of the Cacilhas beach, the turn under the Bom Parto fort, the rocky spur at the peninsula’s southern end, the small dock at Ponte e Horta, the shore before the A-Ma temple, the Barra fort), and the paper is walked onto it in 16 small moves, so the drawn coast coincides with it. Along the Inner Harbour the drawing shows a waterfront of wharves, piers and small inlets while the reference is only a generalised line through today’s streets, so there it is the general run of the waterfront that is matched and the wharves and inlets ride along instead of being flattened; between the A-Ma temple and the Barra fort, where the 1889 sheet already shows a dock and made ground, the line follows the old road at the foot of the Barra hill. The north face of the promontory under the D. Maria II fort is drawn at well under half its real length and the south-east corner of the Guia hill almost as a straight line, so the paper is stretched most there and the hill shading and rock marks beside the shore are deformed with it; the Patane bay is drawn too short as well.',
      pt: 'Desenhado para o relato da embaixada Macartney, com sondagens e notas sobre o fundo do Porto Interior e da Praia Grande, e com a Ilha Verde, a costa da Lapa e o norte da Taipa em redor. A península aparece cerca de um quarto mais curta do que é (3,2 km das Portas do Cerco ao forte da Barra contra 4,2 km reais); a georreferenciação por spline estica-a de volta, e o mar e a costa de Zhuhai além dos pontos de controlo são extrapolação decorativa. Toda a linha de costa está fixada de cerca de 120 em 120 m à costa de 1794: onde o levantamento de 1889 ainda mostra a costa antiga (a costa leste das Portas do Cerco ao forte de S. Francisco, a Praia Grande, Sai Van e a Barra) usa-se directamente a sua linha de costa, e ao longo do Porto Interior, aterrado depois de 1863, a linha segue as ruas que a Geografia de Macau de 1993 nomeia (Rua do Padre João Clímaco, Rua da Barca, o sopé norte da colina de Camões, Rua dos Faitiões, Rua de Camilo Pessanha, Travessa da Felicidade, Ponte e Horta, Rua da Praia do Manduco). Toda a linha de costa recebe depois uma segunda passagem, o ajuste da costa: a linha de costa desenhada é decalcada, emparelhada de cerca de 12 em 12 m com essa costa de 1794 pelo comprimento de arco entre acidentes que ambos os desenhos têm (os promontórios, os dois extremos da praia de Cacilhas, a curva sob o forte do Bom Parto, o esporão rochoso no extremo sul da península, a pequena doca de Ponte e Horta, a margem diante do templo de A-Má, o forte da Barra), e o papel é levado até ela em 16 pequenos passos, pelo que a costa desenhada coincide com ela. Ao longo do Porto Interior o desenho mostra uma frente de cais, pontões e pequenas enseadas, enquanto a referência é apenas uma linha generalizada pelas ruas de hoje; aí ajusta-se o andamento geral da frente ribeirinha, e os cais e enseadas acompanham-no em vez de serem achatados; entre o templo de A-Má e o forte da Barra, onde a folha de 1889 já mostra uma doca e aterros, a linha segue a antiga estrada no sopé da colina da Barra. A face norte do promontório sob o forte de D. Maria II está desenhada com bem menos de metade do comprimento real e o canto sueste da colina da Guia quase em linha recta; é aí que o papel fica mais esticado, e o sombreado dos montes e os sinais de rochas junto à costa deformam-se com ele; a baía do Patane também está desenhada demasiado curta.',
    },
  },
  {
    id: 'heitor-1889',
    name: {
      zh: '海托爾《澳門半島平面圖》（1889）',
      en: 'Heitor, Planta da Peninsula de Macau (1889)',
      pt: 'Heitor, Planta da Peninsula de Macau (1889)',
    },
    title: {
      zh: '澳門半島平面圖 1:5,000（安東尼奧·海托爾縮繪，澳門公物局，1889 年 3 月 15 日，國家印刷局石印）',
      en: 'Planta da Peninsula de Macau, 1:5,000 (reduced and drawn by António Heitor for the Public Works Department, Macau, 15 March 1889; lithographed by the Imprensa Nacional)',
      pt: 'Planta da Peninsula de Macau, 1:5.000 (reduzida e desenhada por António Heitor para as Obras Públicas, Macau, 15 de Março de 1889; Lithographia da Imprensa Nacional)',
    },
    author: 'António Heitor (1855–1932), conductor civil, Obras Públicas de Macau; lithographed by António José Saldanha de Assunção at the Imprensa Nacional',
    year: 1889,
    published: 1889,
    work: 'Lithographia da Imprensa Nacional, Macau — coloured lithograph, 77 × 50 cm (insignia of the Sociedade de Geografia de Lisboa above the title)',
    scan: {
      holder: 'Library of Congress, Geography and Map Division',
      via: 'Wikimedia Commons',
      identifier: '2002624048',
      url: 'https://www.loc.gov/item/2002624048/',
      leaves: [],
      license: 'Public domain (published 1889; the Library of Congress lists no known restrictions on publication)',
    },
    references: [
      { name: 'Wikimedia Commons file (the mirror this build downloads)', url: 'https://commons.wikimedia.org/wiki/File:Planta_da_peninsula_de_Macau._LOC_2002624048.jpg' },
      { name: 'MUST Library, Global Mapping of Macao (description of this plate)', url: 'https://libspc.must.edu.mo/fullRead/000051/991000435439705076' },
    ],
    source: {
      kind: 'sheet',
      url: 'https://upload.wikimedia.org/wikipedia/commons/5/5a/Planta_da_peninsula_de_Macau._LOC_2002624048.jpg',
      file: 'loc-2002624048.jpg',
      // Inside the double fillet (dark-line scan of the sheet edges).
      crop: { left: 118, top: 112, width: 6874, height: 10248 },
      // 0.54 m/px at 1:5,000; box-shrink 3× before the 2 m/px warp.
      shrink: 3,
    },
    lambda: 0,
    resM: 2,
    marginKm: 2,
    gcpSpace: 'sheet',
    gcps: [
      ['Portas do Cêrco 關閘', 4640, 490, 113.54921, 22.21594, 'the arch across the isthmus road'],
      ['Ilha Verde, alt. 48 m 青洲山頂', 1800, 1650, 113.53764, 22.21143, 'island summit (OSM peak)'],
      // No pin on the Pagode de Lin fou 蓮峯廟: the sheet draws it as a generalised lot about 90 × 105 m
      // whose centre is not the temple's. Pinned there (it used to be, 65 m east of even that lot's
      // centre, on the road) the whole isthmus sat 80–110 m west of the 1893 manuscript; without it
      // both shores of the isthmus agree with the manuscript to a few metres, and the `coast NE …`
      // pins below hold the isthmus instead.
      ['Fortaleza de Monghá 望廈炮台', 4310, 2475, 113.54767, 22.20797, 'OSM fort'],
      ['Fortaleza de D. Maria II 馬交石炮台', 6276, 3686, 113.55562, 22.20340, 'the centroid of the red pentagon (OSM fort); until 2026-09-18 this pin stood on the road 72 m north of the fort and dragged the whole promontory south'],
      ['Fortaleza da Guia, Pharol 東望洋燈塔', 4912, 5500, 113.54971, 22.19644, 'the lighthouse symbol inside the fort (OSM)'],
      ['Cemitério Catholico 聖味基墳場', 3800, 5000, 113.54553, 22.19864, 'cemetery centroid (OSM), approximate'],
      ['E. de N.S. da Esperança 望德堂', 3843, 5297, 'MM004', null, 'IC heritage GPS'],
      ['E. de S.to Antão 聖安多尼堂', 2365, 4930, 'MM002', null, 'IC heritage GPS'],
      ['Ruinas de S. Paulo 大三巴', 2742, 5300, 'MM008', null, 'the nave just behind the façade; IC heritage GPS'],
      ['Fortaleza do Monte 大炮台', 3090, 5430, 113.54237, 22.19703, 'OSM fort centroid'],
      ['E. de S. Domingos 玫瑰堂', 2640, 6070, 'MM003', null, 'IC heritage GPS'],
      ['Sé Cathedral 主教座堂', 2965, 6345, 'MM006', null, 'IC heritage GPS'],
      ['Casa da Câmara 議事亭', 2440, 6425, 113.5395, 22.19335, 'Leal Senado building, the front of the block on the Largo'],
      ['E. de S.to Agostinho 聖奧斯定堂', 2215, 6665, 'MM001', null, 'the cross on the barracks block; IC heritage GPS'],
      ['Theatro 崗頂劇院', 2120, 6800, 113.53821, 22.19191, 'Teatro Dom Pedro V (OSM)'],
      ['Seminário de S. José 聖若瑟修院', 1935, 6920, 'MM007', null, 'the cross of the seminary church; IC heritage GPS'],
      ['Fort.za de S. Francisco 嘉思欄炮台', 3682, 6938, 113.5442, 22.19099, 'the red fort on the promontory; this survey defines its position'],
      ['Fort.za de N.S.ª do Bomparto 燒灰爐炮台', 1870, 8310, 113.53698, 22.18647, 'the red star fort; this survey defines its position'],
      ['Ermida de N.S. da Penha 西望洋', 1363, 8233, 'AM002', null, 'the red chapel block; IC heritage GPS'],
      ['Quartel da Polícia marítima 港務局大樓', 560, 8070, 113.53263, 22.18737, 'Quartel dos Mouros (OSM)'],
      ['Pagode da Barra 媽閣廟', 513, 8400, 'MM020', null, 'the temple enclosure; IC heritage GPS'],
      ['Fortaleza da Barra 聖地牙哥炮台', 320, 9310, 113.53071, 22.18268, 'the red fort; Pousada de São Tiago'],
      ['coast NE 0000m', 4914, 486, 113.55034, 22.21594, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0030m', 4887, 546, 113.55024, 22.21571, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0060m', 4863, 605, 113.55014, 22.21546, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0090m', 4840, 667, 113.55004, 22.21521, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0120m', 4824, 731, 113.54997, 22.21494, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0150m', 4799, 791, 113.5499, 22.21469, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0180m', 4779, 855, 113.54983, 22.21443, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0210m', 4762, 918, 113.54977, 22.21416, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0240m', 4747, 983, 113.5497, 22.2139, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0270m', 4733, 1047, 113.54964, 22.21364, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0300m', 4724, 1112, 113.5496, 22.21338, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0330m', 4715, 1178, 113.54953, 22.21312, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0360m', 4708, 1244, 113.54946, 22.21286, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0390m', 4704, 1310, 113.54939, 22.2126, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0420m', 4701, 1376, 113.54934, 22.21234, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0450m', 4701, 1442, 113.54932, 22.21208, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0480m', 4701, 1509, 113.54929, 22.21181, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0510m', 4705, 1575, 113.54927, 22.21154, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0540m', 4710, 1642, 113.54927, 22.21128, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0570m', 4718, 1709, 113.54931, 22.21101, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0600m', 4726, 1775, 113.54935, 22.21075, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0630m', 4737, 1842, 113.54942, 22.21049, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0660m', 4751, 1908, 113.54951, 22.21023, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0690m', 4767, 1975, 113.54962, 22.20995, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0720m', 4784, 2041, 113.54974, 22.2097, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0750m', 4807, 2106, 113.54987, 22.20946, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0780m', 4834, 2170, 113.54997, 22.20921, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0810m', 4864, 2233, 113.55006, 22.20895, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0840m', 4897, 2295, 113.55013, 22.20869, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0870m', 4930, 2357, 113.55021, 22.20843, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0900m', 4955, 2422, 113.55028, 22.20817, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0930m', 4967, 2491, 113.55034, 22.20791, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0960m', 4981, 2560, 113.55044, 22.2077, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 0990m', 5013, 2613, 113.55062, 22.20756, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1020m', 5079, 2629, 113.55083, 22.20744, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1050m', 5139, 2649, 113.55099, 22.2073, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1080m', 5162, 2710, 113.55107, 22.20707, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1140m', 5127, 2812, 113.55113, 22.20689, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1200m', 5252, 2771, 113.55152, 22.20689, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1230m', 5306, 2806, 113.55175, 22.20677, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1260m', 5359, 2793, 113.55195, 22.20679, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1290m', 5408, 2833, 113.55215, 22.20663, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1320m', 5401, 2902, 113.55212, 22.2064, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1350m', 5381, 2965, 113.552, 22.20615, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1380m', 5398, 3034, 113.55206, 22.20588, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1410m', 5422, 3100, 113.55218, 22.20563, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1440m', 5450, 3166, 113.5523, 22.20539, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1470m', 5487, 3226, 113.55247, 22.20518, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1500m', 5528, 3283, 113.55268, 22.20503, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1530m', 5596, 3302, 113.55296, 22.20496, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1560m', 5662, 3327, 113.55322, 22.20487, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1590m', 5732, 3335, 113.5535, 22.20484, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1650m', 5848, 3282, 113.55385, 22.20476, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1680m', 5887, 3340, 113.55401, 22.20456, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1710m', 5940, 3383, 113.55424, 22.20443, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1740m', 6007, 3408, 113.55453, 22.20439, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1770m', 6072, 3414, 113.5548, 22.20439, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1800m', 6140, 3423, 113.55508, 22.20438, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1830m', 6210, 3410, 113.55536, 22.20444, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1860m', 6274, 3383, 113.55564, 22.20451, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1890m', 6332, 3347, 113.5559, 22.2046, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1920m', 6400, 3340, 113.55619, 22.20463, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1950m', 6471, 3337, 113.55648, 22.20466, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 1980m', 6536, 3314, 113.55676, 22.20471, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2010m', 6605, 3296, 113.55703, 22.20478, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2040m', 6670, 3272, 113.55728, 22.2049, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2070m', 6724, 3231, 113.55748, 22.2051, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2100m', 6759, 3174, 113.55757, 22.20536, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2130m', 6766, 3106, 113.55764, 22.20561, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2190m', 6756, 2995, 113.55778, 22.20584, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2250m', 6886, 3036, 113.55811, 22.2058, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2280m', 6917, 3093, 113.55826, 22.20565, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2310m', 6938, 3154, 113.55842, 22.20545, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2340m', 6957, 3216, 113.55863, 22.20518, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2370m', 6952, 3283, 113.55873, 22.2049, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2400m', 6967, 3351, 113.55874, 22.20466, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2430m', 6959, 3420, 113.55856, 22.20438, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2460m', 6914, 3467, 113.55828, 22.20418, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2490m', 6859, 3496, 113.55805, 22.20405, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2520m', 6808, 3542, 113.55788, 22.20386, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2550m', 6788, 3607, 113.55779, 22.20362, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2580m', 6772, 3673, 113.55773, 22.20339, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2610m', 6762, 3739, 113.55764, 22.20315, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2640m', 6729, 3799, 113.55743, 22.20292, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2670m', 6678, 3805, 113.55723, 22.20282, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2700m', 6620, 3824, 113.55701, 22.20268, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2730m', 6562, 3859, 113.55676, 22.20258, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2760m', 6499, 3886, 113.55651, 22.20254, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2790m', 6431, 3873, 113.55625, 22.20258, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2820m', 6387, 3906, 113.55606, 22.20246, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2880m', 6258, 3860, 113.55583, 22.20242, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2910m', 6204, 3894, 113.55565, 22.20221, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 2940m', 6179, 3947, 113.55554, 22.20205, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 3000m', 6123, 4075, 113.55534, 22.2017, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 3030m', 6096, 4139, 113.5552, 22.20146, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 3060m', 6072, 4204, 113.55509, 22.20122, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 3090m', 6048, 4269, 113.55501, 22.20097, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 3210m', 6185, 4410, 113.55504, 22.20058, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 3240m', 6152, 4468, 113.55499, 22.2004, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 3270m', 6153, 4534, 113.55498, 22.20014, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast NE 3300m', 6147, 4602, 113.55496, 22.19988, 'north-east shore pinned to the 1893 manuscript (sauvage-1893), the baseline for this stretch'],
      ['coast hold 3420m', 6227, 4846, 113.55523, 22.19892, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 3540m', 6145, 5081, 113.55484, 22.198, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 3660m', 6131, 5279, 113.55473, 22.19723, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 3780m', 5871, 5362, 113.55366, 22.19692, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 3900m', 5732, 5526, 113.55304, 22.19629, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 4020m', 5578, 5583, 113.55239, 22.19607, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 4140m', 5489, 5821, 113.55194, 22.19514, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 4260m', 5287, 5949, 113.55106, 22.19464, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 4380m', 5032, 5928, 113.55001, 22.19473, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 4500m', 4842, 5954, 113.5492, 22.19464, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 4620m', 4678, 6145, 113.54844, 22.1939, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 4740m', 4498, 6312, 113.54764, 22.19326, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 4860m', 4306, 6487, 113.5468, 22.19261, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 4980m', 4166, 6646, 113.54619, 22.19202, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
      ['coast hold 5100m', 3981, 6828, 113.54541, 22.19136, 'rest of the east shore held where the landmark pins put it, so that the north-east correction stays local'],
    ],
    notes: {
      zh: '公物局 1:5,000 實測圖的縮繪石印版：街巷齊全且多數有名，官署、教堂、軍事建築塗紅，青洲仍是離島（上有水泥廠），半島東北角還是田野。二十二個地物控制點跨全島、全部釘準；圖本身畫得準，所以釘與釘之間的街道也對得上，是這批古地圖裡最可靠的一張。東北海岸（關閘到黑沙環灣南端）另外每約 30 公尺一針釘在 1893 年手稿的岸線上，兩張圖在這一段重合；其餘東岸用固定針留在原位，讓這項修正只影響東北角。',
      en: 'A reduced lithograph of the Public Works Department’s 1:5,000 survey: every street and lane, most of them named, with government, church and military buildings in red; Ilha Verde is still an island (with its cement works) and the north-east of the peninsula still fields. Pinned exactly at twenty-two landmarks across the whole peninsula, and because the survey itself is accurate the streets between the pins line up too — the most reliable plate in this set. Its north-east shore (Barrier Gate to the south end of the Cacilhas bay) is additionally pinned about every 30 m to the shoreline of the 1893 manuscript, so the two plates coincide along that stretch; hold pins keep the rest of the east shore where the landmarks put it, so that the correction stays in the north-east.',
      pt: 'Litografia reduzida do levantamento 1:5.000 das Obras Públicas: todas as ruas e travessas, quase todas com nome, com edifícios do governo, igrejas e quartéis a vermelho; a Ilha Verde ainda é uma ilha (com a fábrica de cimento) e o nordeste da península ainda campos. Fixada exactamente em vinte e dois pontos de referência por toda a península e, como o levantamento é rigoroso, as ruas entre os pontos também coincidem — a planta mais fiável deste conjunto. A costa nordeste (das Portas do Cerco ao extremo sul da baía de Cacilhas) está ainda fixada, de cerca de 30 em 30 m, à linha de costa do manuscrito de 1893, pelo que as duas plantas coincidem nesse troço; pontos de retenção mantêm o resto da costa leste onde os pontos de referência a colocam, para que a correcção fique pelo nordeste.',
    },
  },
  {
    id: 'sauvage-1893',
    name: {
      zh: '索瓦熱《澳門半島平面圖》（1893 手稿）',
      en: 'Sauvage, Planta da Peninsula de Macau (1893 manuscript)',
      pt: 'Sauvage, Planta da Peninsula de Macau (manuscrito de 1893)',
    },
    title: {
      zh: '澳門半島平面圖 1:10,000（澳門公物局手稿，Alcino António Sauvage 簽署，1893 年 8 月 19 日，西在上）',
      en: 'Planta da Peninsula de Macau, 1:10,000 (manuscript of the Public Works Department, signed Alcino António Sauvage, Macau, 19 August 1893; west at the top)',
      pt: 'Planta da Peninsula de Macau, 1:10.000 (manuscrito da Direcção das Obras Públicas, assinado por Alcino António Sauvage, Macau, 19 de Agosto de 1893; oeste no topo)',
    },
    author: 'Direcção das Obras Públicas de Macau; signed by Alcino António Sauvage (1844–1914)',
    year: 1893,
    published: null,
    work: 'Manuscript, paper on cloth, 58 × 71 cm — Arquivo Histórico Ultramarino, PT/AHU/CARTM/062/01433 (AHU_CARTm_MACAU, D. 1433); legend of 33 numbered sites',
    scan: {
      holder: 'Arquivo Histórico Ultramarino (Lisbon)',
      via: 'DigitArq (DGLAB)',
      identifier: 'PT/AHU/CARTM/062/01433, file PT-AHU-CARTM-062-01433_m0001',
      url: 'https://digitarq.arquivos.pt/documentDetails/d1726557bef843a39756d7945439d6ba',
      leaves: ['m0001'],
      license: 'CC BY-SA 4.0 (the DigitArq digitisation, funded by the PRR); the georeferenced plate is therefore CC BY-SA 4.0 too',
    },
    references: [
      { name: 'Alcino António Sauvage (Building the Portuguese Empire)', url: 'https://www.buildingtheportugueseempire.org/sauvage-alcino-antonio.html' },
      { name: 'MUST Library, Global Mapping of Macao (description of this plate)', url: 'https://libspc.must.edu.mo/fullRead/000051/991003573202005076' },
    ],
    source: {
      kind: 'sheet',
      url: 'https://digitarq.arquivos.pt/rdigital/dissemination?fileId=89816416',
      file: 'ahu-01433-89816416.jpg',
      // Inside the drawn double border (the cloth around it is scanned against black).
      crop: { left: 500, top: 665, width: 7610, height: 5950 },
      // ~0.85 m/px at 1:10,000; box-shrink 3× before the 2.5 m/px warp.
      shrink: 3,
    },
    lambda: 0,
    resM: 2.5,
    marginKm: 4,
    gcpSpace: 'sheet',
    gcps: [
      ['Fortaleza de S. Thiago da Barra 聖地牙哥炮台', 1820, 2480, 113.53071, 22.18268, 'Pousada de São Tiago'],
      ['Pagod (da Barra) 媽閣廟', 2280, 2600, 'MM020', null, 'IC heritage GPS'],
      ['29 Igreja de N.S. da Penha 西望洋', 2395, 3000, 'AM002', null, 'the red "29" block; IC heritage GPS'],
      ['Fortaleza do Bomparto 燒灰爐炮台', 2340, 3250, 113.53698, 22.18647, 'demolished fort; position taken from the 1889 survey'],
      ['14 Igreja de S. Lourenço 聖老楞佐堂', 2886, 3195, 'MM005', null, 'IC heritage GPS'],
      ['Seminário de S. José 聖若瑟修院', 2975, 3230, 'MM007', null, 'IC heritage GPS'],
      ['27 Igreja de S.to Agostinho 聖奧斯定堂', 3105, 3392, 'MM001', null, 'IC heritage GPS'],
      ['13 Igreja de S. Domingos 玫瑰堂', 3465, 3625, 'MM003', null, 'IC heritage GPS'],
      ['12 Igreja da Sé Cathedral 主教座堂', 3255, 3785, 'MM006', null, 'IC heritage GPS'],
      ['15 Igreja de S.to António 聖安多尼堂', 3970, 3515, 'MM002', null, 'the red "15" block; IC heritage GPS'],
      ['31 Jardim da Gruta de Camões 白鴿巢', 4255, 3480, 113.53922, 22.20076, 'the round "31" garden; centroid (OSM park)'],
      ['S. Paulo 大三巴', 3837, 3652, 'MM008', null, 'the church outline beside the "S. Paulo" label; IC heritage GPS'],
      ['1 Fortaleza do Monte 大炮台', 3725, 3840, 113.54237, 22.19703, 'the red "1" fort; OSM fort centroid'],
      ['2 Fortaleza de S. Francisco 嘉思欄炮台', 2925, 4080, 113.5442, 22.19099, 'demolished fort; position taken from the 1889 survey'],
      ['Cemitério de S. Miguel Archanjo 聖味基墳場', 3930, 4215, 113.54553, 22.19864, 'the walled cemetery block; centroid (OSM), approximate'],
      ['3 Fortaleza da Guia e Pharol 東望洋燈塔', 3680, 4715, 113.54971, 22.19644, 'the lighthouse dot inside the red "3" fort (OSM)'],
      ['4 Forte do Monghá 望廈炮台', 5165, 4425, 113.54767, 22.20797, 'OSM fort'],
      ['Pagode de Linfong-Mou 蓮峯廟', 5395, 4415, 'MM024', null, 'IC heritage GPS'],
      ['Ilha Verde 青洲山頂', 5600, 3205, 113.53764, 22.21143, 'the centre of the island\u2019s hachures (OSM peak)'],
      ['Arco triumphal das Portas do Cerco 關閘', 6120, 4592, 113.54921, 22.21594, 'the 1870 arch itself'],
    ],
    notes: {
      zh: '公物局的手稿版，紙裱布、西在上，比同年代的印刷版多了街名巷名，紅色為官署、教堂與軍營，圖例列了 33 處；青洲已由 Conselheiro Borja 大馬路（今青洲大馬路）的堤路接到半島。二十一個控制點配準。',
      en: 'The Public Works Department’s manuscript version, paper on cloth with west at the top: more street and lane names than the printed plan of the same years, government, church and military buildings in red, a legend of 33 sites; Ilha Verde is already joined to the peninsula by the Avenida do Conselheiro Borja causeway. Placed with twenty-one control points.',
      pt: 'A versão manuscrita das Obras Públicas, papel sobre tela com o oeste no topo: mais nomes de ruas e travessas do que a planta impressa dos mesmos anos, edifícios do governo, igrejas e quartéis a vermelho, legenda com 33 sítios; a Ilha Verde já está ligada à península pelo aterro da Avenida do Conselheiro Borja. Colocada com vinte e um pontos de controlo.',
    },
  },
  {
    id: 'lacerda-1922',
    name: {
      zh: '港務局《澳門及鄰近地區平面圖》（1922）',
      en: 'Harbour Authority, Planta de Macau e Territorios Visinhos (1922)',
      pt: 'Capitania dos Portos, Planta de Macau e Territorios Visinhos (1922)',
    },
    title: {
      zh: '澳門及鄰近地區平面圖，附半島與氹仔島工程計劃 1:80,000（澳門港務局，1922 年，載於 Hugo de Lacerda《Macau e seu futuro porto》）',
      en: 'Planta de Macau e Territorios Visinhos com a Indicação do Projecto de Obras na Peninsula e Ilha da Taipa, 1:80,000 (Macau Harbour Authority, 1922, for Hugo de Lacerda’s Macau e seu futuro porto)',
      pt: 'Planta de Macau e Territorios Visinhos com a Indicação do Projecto de Obras na Peninsula e Ilha da Taipa, 1:80.000 (Capitania dos Portos de Macau, 1922, para Macau e seu futuro porto de Hugo de Lacerda)',
    },
    author: 'Capitania dos Portos de Macau (Macau Harbour Authority), under its captain Hugo de Lacerda (1860–1945); printed for Macau e seu futuro porto (Macau: Tip. Mercantil de N. T. Fernandes e Filhos, 1922)',
    year: 1922,
    published: 1922,
    work: 'Hugo de Lacerda (coord.), Macau e seu futuro porto (Macau, 1922) — folding plate, coloured print, 29 × 26 cm: reclamation carried out (hatched) and projected (dashed), the projected outer harbour and its channel',
    scan: {
      holder: 'National Library of Australia',
      via: 'Trove / nla.gov.au',
      identifier: 'nla.obj-229837650 (MAP Braga Collection Col./66, J. M. Braga special map collection)',
      url: 'https://nla.gov.au/nla.obj-229837650',
      leaves: [],
      license: 'Out of copyright (NLA copyright status: created/published 1922, no government copyright ownership)',
    },
    references: [
      { name: 'HathiTrust record of the book (search only outside the US)', url: 'https://catalog.hathitrust.org/Record/100579352' },
      { name: 'MUST Library, Global Mapping of Macao (description of this plate)', url: 'https://libspc.must.edu.mo/fullRead/000051/991002943749705076' },
    ],
    source: {
      kind: 'sheet',
      // nla.gov.au sits behind an Anubis proof-of-work check: fetch this URL in a browser (the
      // "Download 41Mb" TIFF on the object page) and save it under .cache/old-maps/ by hand.
      url: 'https://nla.gov.au/tarkine/nla.obj-229837650/m',
      file: 'nla-obj-229837650.tif',
      manual: true,
      // Inside the graticule border (the inner line of the double fillet).
      crop: { left: 265, top: 219, width: 3124, height: 3422 },
    },
    // Landmarks scatter ±300 m on this 1:80,000 sketch; pinned exactly like the others, the
    // paper between the pins carries that scatter.
    lambda: 0,
    resM: 8,
    marginKm: 1,
    gcpSpace: 'sheet',
    gcps: [
      ['Portas do Cerco 關閘', 2245, 1035, 113.54921, 22.21594, 'the gate on the isthmus, approximate'],
      ['I. Verde 青洲山頂', 2040, 1088, 113.53764, 22.21143, 'island summit (OSM peak)'],
      ['F.te de Mong-ha 望廈炮台', 2207, 1152, 113.54767, 22.20797, 'OSM fort'],
      ['F.te D. Maria 馬交石炮台', 2320, 1240, 113.55562, 22.20340, 'OSM fort, approximate'],
      ['Guia Farol 東望洋燈塔', 2285, 1288, 113.54971, 22.19644, 'the hill symbol\u2019s centre (OSM lighthouse)'],
      ['Penha 西望洋', 1975, 1500, 'AM002', null, 'IC heritage GPS'],
      ['F.te S. Tiago da Barra 聖地牙哥炮台', 1990, 1572, 113.53071, 22.18268, 'Pousada de São Tiago'],
      ['I. Malau-chau 大馬騮洲', 1682, 1760, 113.51339, 22.17110, 'island hill (OSM peak)'],
      ['Coloane 路環市區', 2325, 2655, 'MC001', null, 'St Francis Xavier church; IC heritage GPS'],
      ['Hac-Sá 黑沙村', 2520, 2612, 113.56669, 22.11915, 'village (OSM)'],
      ['Cahó 九澳村', 2745, 2350, 113.58136, 22.13250, 'village (OSM)'],
      ['Vila da Taipa 氹仔舊城區', 2346, 1995, 113.55662, 22.15349, 'the reclaimed village block and dock; quarter centroid (OSM), approximate'],
      ['Taipa Pequena 小潭山', 2243, 1916, 113.54755, 22.16128, 'innermost hachure ring of the western island (OSM peak), approximate'],
      ['Taipa Grande 大潭山', 2492, 1922, 113.56580, 22.15889, 'innermost hachure ring of the eastern island (OSM peak), approximate'],
      ['Alto de Coloane 疊石塘山', 2420, 2507, 113.56130, 22.12065, 'innermost hachure ring NE of Coloane village (OSM peak), approximate'],
      ['Van Chai 灣仔', 1890, 1340, 113.5292, 22.1962, 'the village houses on the Lapa shore (approximate)'],
      // The sheet's own graticule, corrected by the mean landmark offset (its longitudes run
      // 1.07′ ≈ 1.8 km too far east, its latitudes 0.11′ ≈ 200 m too far north), to hold the
      // parts of the sheet — Zhuhai, Hengqin, the sea — that have no landmark of their own.
      ['graticule NW', 300, 260, 113.42270, 22.26284, 'graticule anchor, shifted by the mean landmark offset'],
      ['graticule N', 1800, 260, 113.52060, 22.26262, 'graticule anchor, shifted by the mean landmark offset'],
      ['graticule NE', 3350, 260, 113.62176, 22.26239, 'graticule anchor, shifted by the mean landmark offset'],
      ['graticule W', 300, 1900, 113.42221, 22.16162, 'graticule anchor, shifted by the mean landmark offset'],
      ['graticule E', 3350, 1900, 113.62165, 22.16243, 'graticule anchor, shifted by the mean landmark offset'],
      ['graticule SW', 300, 3600, 113.42171, 22.05670, 'graticule anchor, shifted by the mean landmark offset'],
      ['graticule S', 1800, 3600, 113.51998, 22.05774, 'graticule anchor, shifted by the mean landmark offset'],
      ['graticule SE', 3350, 3600, 113.62153, 22.05881, 'graticule anchor, shifted by the mean landmark offset'],
    ],
    notes: {
      zh: '港務局為 Hugo de Lacerda《澳門與其未來港口》一書所印的區域圖，1:80,000，涵蓋半島、氹仔、路環、對面山、橫琴與前山：斜線為已填海、虛線為擬填海，東望洋以南標出擬建的人工港與航道。圖上經緯網比今日座標偏東約 1.8 公里，配準以 16 個地物為準、全部釘準，四周用校正後的經緯網固定；這是小比例尺草圖，釘與釘之間的誤差以百公尺計。',
      en: 'The Harbour Authority’s regional map for Hugo de Lacerda’s book Macau e seu futuro porto, 1:80,000, covering the peninsula, Taipa, Coloane, Lapa, Hengqin and Qianshan: hatching for reclamation already done, dashed lines for reclamation planned, and the projected artificial harbour and channel south of Guia. The sheet’s own graticule runs about 1.8 km east of today’s coordinates; the plate is pinned exactly at 16 landmarks, with the corrected graticule holding the edges. A small-scale sketch — between the pins expect errors of a few hundred metres.',
      pt: 'O mapa regional da Capitania dos Portos para o livro Macau e seu futuro porto de Hugo de Lacerda, 1:80.000, com a península, a Taipa, Coloane, a Lapa, Hengqin e Qianshan: tracejado para os aterros já feitos, linhas a tracinhos para os projectados, e o porto artificial e o canal projectados a sul da Guia. A graticula da própria folha fica cerca de 1,8 km a leste das coordenadas actuais; a folha está fixada exactamente em 16 marcos, com a graticula corrigida a segurar as margens. Um esboço de pequena escala — entre os pontos, erros de algumas centenas de metros.',
    },
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function download(url, file, manual = false) {
  if (fs.existsSync(file) && fs.statSync(file).size > 10_000) return file
  if (manual) throw new Error(`${path.relative(ROOT, file)} is missing. This scan sits behind a browser check: open ${url} in a browser, save the file there, and re-run.`)
  const res = await fetch(url, { headers: { 'User-Agent': 'mini-macau data pipeline (github asdfghj1237890)' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const type = res.headers.get('content-type') || ''
  if (!/^image\//.test(type) && !/octet-stream/.test(type)) throw new Error(`${url} → ${type || 'no content-type'}, not an image (a bot check or an error page?)`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}

// Metres around Macau (equirectangular is plenty for a 10 km sheet).
const LAT0 = 22.2, LNG0 = 113.54, K = 111320, KX = K * Math.cos(LAT0 * Math.PI / 180)
const toXY = (lng, lat) => [(lng - LNG0) * KX / 1000, (lat - LAT0) * K / 1000] // km
const toLL = (x, y) => [LNG0 + x * 1000 / KX, LAT0 + y * 1000 / K]

function solve(A, b) {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const pv = M[c][c]
    if (Math.abs(pv) < 1e-14) throw new Error('singular TPS system')
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / pv
      if (!f) continue
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r[n] / r[i])
}
const U = (r2) => (r2 <= 0 ? 0 : r2 * Math.log(r2) * 0.5) // r² ln r

// Thin-plate spline f(x, y) through {x, y, val} with smoothing λ (0 = exact interpolation).
function fitTPS(points, lambda) {
  const n = points.length, N = n + 3
  const A = Array.from({ length: N }, () => new Array(N).fill(0)), b = new Array(N).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y
      A[i][j] = U(dx * dx + dy * dy) + (i === j ? lambda : 0)
    }
    A[i][n] = 1; A[i][n + 1] = points[i].x; A[i][n + 2] = points[i].y
    A[n][i] = 1; A[n + 1][i] = points[i].x; A[n + 2][i] = points[i].y
    b[i] = points[i].val
  }
  const s = solve(A, b)
  return (x, y) => {
    let v = s[n] + s[n + 1] * x + s[n + 2] * y
    for (let i = 0; i < n; i++) { const dx = x - points[i].x, dy = y - points[i].y; v += s[i] * U(dx * dx + dy * dy) }
    return v
  }
}

// IC heritage coordinates come from religion.json so the two overlays agree.
const religion = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'religion.json'), 'utf8'))
function resolveGcp(map, [name, u, v, lngOrCode, lat, note]) {
  const shrink = map.source.shrink ?? 1
  let px = u, py = v
  if (map.gcpSpace === 'sheet') { px = (u - map.source.crop.left) / shrink; py = (v - map.source.crop.top) / shrink }
  if (typeof lngOrCode === 'string') {
    const site = religion.sites.find(s => s.heritage && s.heritage.code === lngOrCode)
    if (!site) throw new Error(`GCP ${name}: no religion.json site with heritage code ${lngOrCode}`)
    return { name, u: px, v: py, lng: site.coordinates[0], lat: site.coordinates[1], note: `${note} (${lngOrCode})` }
  }
  return { name, u: px, v: py, lng: lngOrCode, lat, note }
}

// The plate as raw pixels: the neat-line-cropped scan, stitched across a fold when needed.
async function buildPlate(map) {
  const s = map.source
  if (s.kind === 'stitch') {
    const leaf = async (n) => {
      const file = await download(s.urlFor(n), path.join(CACHE, s.fileFor(n)))
      return sharp(file).rotate(s.rotate).png().toBuffer()
    }
    const { crop } = s
    const overlapPx = s.gapPx !== undefined ? -s.gapPx : (s.overlapPx ?? 0) // a gap is a negative overlap
    const northLeaf = await leaf(s.leaves.north)
    const northLeafHeight = (await sharp(northLeaf).metadata()).height
    const northBuf = await sharp(northLeaf).extract({ left: crop.left, top: crop.northTop, width: crop.right - crop.left, height: northLeafHeight - crop.northTop }).png().toBuffer()
    const southBuf = await sharp(await leaf(s.leaves.south)).extract({ left: crop.left, top: 0, width: crop.right - crop.left, height: crop.southBottom }).png().toBuffer()
    const nh = (await sharp(northBuf).metadata()).height, sh = (await sharp(southBuf).metadata()).height
    const W = crop.right - crop.left, H = nh + sh - overlapPx
    return sharp({ create: { width: W, height: H, channels: 3, background: '#f2ecdc' } })
      .composite([{ input: southBuf, left: 0, top: nh - overlapPx }, { input: northBuf, left: 0, top: 0 }])
      .raw().toBuffer({ resolveWithObject: true })
  }
  if (s.kind === 'sheet') {
    const file = await download(s.url, path.join(CACHE, s.file), s.manual === true)
    let img = sharp(file).extract({ left: s.crop.left, top: s.crop.top, width: s.crop.width, height: s.crop.height })
    if (s.shrink && s.shrink > 1) img = img.resize({ width: Math.round(s.crop.width / s.shrink), kernel: 'lanczos3' })
    return img.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  }
  throw new Error(`unknown source kind ${s.kind}`)
}


// --gcps: a contact sheet of every control point — a 2× window of the scan around the pixel
// the table names, with a crosshair on it — so a pick that sits beside its feature is caught
// before the plate is pinned to it. Windows come from the raw sheet for 'sheet' maps (full
// resolution, before any shrink) and from the stitched plate for 'stitch' maps.
async function gcpSheet(map, plate) {
  const gcps = map.gcps.map(g => resolveGcp(map, g))
  const fromSheet = map.gcpSpace === 'sheet'
  const src = fromSheet
    ? sharp(path.join(CACHE, map.source.file), { limitInputPixels: false })
    : sharp(plate.data, { raw: { width: plate.info.width, height: plate.info.height, channels: plate.info.channels } })
  const meta = fromSheet ? await src.metadata() : plate.info
  const WIN = 150, OUT = 300, COLS = 5, PAD = 6, LABEL = 22
  const tiles = []
  for (let i = 0; i < gcps.length; i++) {
    const cx = fromSheet ? map.gcps[i][1] : gcps[i].u
    const cy = fromSheet ? map.gcps[i][2] : gcps[i].v
    const left = Math.max(0, Math.min(meta.width - WIN, Math.round(cx - WIN / 2)))
    const top = Math.max(0, Math.min(meta.height - WIN, Math.round(cy - WIN / 2)))
    const px = (cx - left) * (OUT / WIN), py = (cy - top) * (OUT / WIN)
    const label = `${i + 1} ${gcps[i].name.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)}`
    const svg = `<svg width="${OUT}" height="${OUT + LABEL}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${OUT}" height="${LABEL}" fill="#111"/>
      <text x="4" y="16" font-size="13" fill="#fff" font-family="sans-serif">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
      <line x1="${px}" y1="${LABEL}" x2="${px}" y2="${OUT + LABEL}" stroke="#e00" stroke-width="1" opacity="0.8"/>
      <line x1="0" y1="${py + LABEL}" x2="${OUT}" y2="${py + LABEL}" stroke="#e00" stroke-width="1" opacity="0.8"/>
      <circle cx="${px}" cy="${py + LABEL}" r="9" fill="none" stroke="#e00" stroke-width="1.5"/>
    </svg>`
    const tile = await src.clone().extract({ left, top, width: WIN, height: WIN }).resize({ width: OUT, height: OUT, kernel: 'lanczos3' })
      .extend({ top: LABEL, background: '#111' }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
    tiles.push({ input: tile, left: PAD + (i % COLS) * (OUT + PAD), top: PAD + Math.floor(i / COLS) * (OUT + LABEL + PAD) })
  }
  const rows = Math.ceil(gcps.length / COLS)
  const file = path.join(PREVIEW_DIR, `old-maps-gcps-${map.id}.png`)
  await sharp({ create: { width: PAD + COLS * (OUT + PAD), height: PAD + rows * (OUT + LABEL + PAD), channels: 3, background: '#333' } })
    .composite(tiles).png().toFile(file)
  console.log(`   gcp sheet ${file} (${gcps.length} points)`)
}


// --check: one affine over all control points, each point's residual and its leave-one-out
// residual (predicted from the other points), in metres. With exact interpolation the spline
// hides a wrong pick by bending the plate around it, so this is the test for the picks.
function checkGcps(map) {
  const gcps = map.gcps.map(g => resolveGcp(map, g))
  const pts = gcps.map(g => { const [x, y] = toXY(g.lng, g.lat); return { u: g.u, v: g.v, x: x * 1000, y: y * 1000 } })
  const fit = (use) => {
    const solve3 = (rhs) => {
      const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0]
      for (const p of use) { const r = [p.u, p.v, 1]; for (let i = 0; i < 3; i++) { b[i] += r[i] * (rhs === 'x' ? p.x : p.y); for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j] } }
      const A = M.map((row, i) => [...row, b[i]])
      for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; for (let r = 0; r < 3; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k] } }
      return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]]
    }
    const [a, b, c] = solve3('x'), [d, e, f] = solve3('y')
    return (u, v) => [a * u + b * v + c, d * u + e * v + f]
  }
  const all = fit(pts)
  console.log(`   affine over ${pts.length} points — residual | leave-one-out:`)
  let se = 0
  pts.forEach((p, i) => {
    const [X, Y] = all(p.u, p.v); const r = Math.hypot(X - p.x, Y - p.y); se += r * r
    const loo = fit(pts.filter((_, j) => j !== i)); const [LX, LY] = loo(p.u, p.v); const lr = Math.hypot(LX - p.x, LY - p.y)
    console.log(`   ${r.toFixed(0).padStart(5)} m | ${lr.toFixed(0).padStart(5)} m ${lr > 120 ? '<<' : '  '} ${gcps[i].name}`)
  })
  console.log(`   RMS ${Math.sqrt(se / pts.length).toFixed(1)} m`)
}

// Stage 2 — coast snap. The spline pins the plate at its control points, but between them the
// DRAWN coast still sits some metres (tens, where the sketch generalises a cove or a point the
// survey draws; a couple of hundred where a coast pin had to go because it folded the paper) off
// the reference shoreline (the coast of 1794). scripts/old-maps-coast/<id>.json holds dense pairs along the traced coast —
// [plate px (in the map's gcpSpace), lng, lat], every ~15 m, by arc length between paired
// features. The snap walks every drawn coast point to its target in `steps` small moves. Each
// move is an EXACT interpolation of that step's little displacements (compactly supported
// Wendland C² kernel, radius `radiusM`: nothing further than that from the coast moves; the
// landmark control points are nodes with zero displacement, so they stay exactly pinned), and a
// map made of small displacements is one-to-one as long as its gradient stays below 1 — the
// largest gradient of any step is printed and stored. The composition of one-to-one maps is
// one-to-one, which is what a single exact spline through the same dense pairs is not (it folds
// wherever the sketch's scale changes abruptly). Rendering undoes the moves last first: source
// px = spline(g₁(g₂(…gₙ(P)))) with gᵢ(P) = P − eᵢ(P); the fold check below runs on that
// composite map.
function buildCoastSnap(map, gcps, fu, fv) {
  if (!map.coastSnap) return null
  const cfg = { steps: 16, radiusM: 250, cellM: 4, minGapM: 3, ...map.coastSnap }
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'old-maps-coast', `${map.id}.json`), 'utf8'))
  const shrink = map.source.shrink ?? 1
  const toPlate = map.gcpSpace === 'sheet' ? (u, v) => [(u - map.source.crop.left) / shrink, (v - map.source.crop.top) / shrink] : (u, v) => [u, v]
  const inverse = (u, v, x, y) => { // Newton on the spline, started at the target
    for (let it = 0; it < 60; it++) {
      const h = 0.002, eu = fu(x, y) - u, ev = fv(x, y) - v
      const a = (fu(x + h, y) - fu(x - h, y)) / (2 * h), b = (fu(x, y + h) - fu(x, y - h)) / (2 * h)
      const c = (fv(x + h, y) - fv(x - h, y)) / (2 * h), d = (fv(x, y + h) - fv(x, y - h)) / (2 * h)
      const det = a * d - b * c
      let dx = (d * eu - b * ev) / det, dy = (-c * eu + a * ev) / det
      const len = Math.hypot(dx, dy); if (len > 0.05) { dx *= 0.05 / len; dy *= 0.05 / len }
      x -= dx; y -= dy
      if (len < 1e-7) break
    }
    return Math.hypot(fu(x, y) - u, fv(x, y) - v) < 0.5 ? [x, y] : null
  }
  // every pair: its target (x, y) and where the drawn coast point sits now (cx, cy) — the spline alone to begin with
  let lost = 0
  const rows = data.stretches.map(stretch => {
    const row = []
    for (const [su, sv, lng, lat] of stretch.samples) {
      const [u, v] = toPlate(su, sv), [x, y] = toXY(lng, lat)
      const p0 = inverse(u, v, x, y)
      if (!p0) { lost++; continue }
      row.push({ x, y, cx: p0[0], cy: p0[1], x0: p0[0], y0: p0[1] })
    }
    return row
  })
  const all = rows.flat()
  if (!all.length) return null
  const gapOf = () => all.map(s => Math.hypot(s.x - s.cx, s.y - s.cy) * 1000).sort((a, b) => a - b)
  const q = (arr, f) => +arr[Math.min(arr.length - 1, Math.floor(arr.length * f))].toFixed(1)
  const before = gapOf()
  const R = cfg.radiusM / 1000, gap = cfg.minGapM / 1000, cell = cfg.cellM / 1000
  const phi = (r) => { const t = r / R; if (t >= 1) return 0; const o = 1 - t; return o * o * o * o * (4 * t + 1) }
  // landmark control points within reach of the coast: fixed nodes
  const guards = gcps.filter(g => !g.name.startsWith('coast ')).map(g => toXY(g.lng, g.lat))
    .filter(([gx, gy]) => all.some(s => Math.hypot(s.x - gx, s.y - gy) < 1.5 * R || Math.hypot(s.x0 - gx, s.y0 - gy) < 1.5 * R))
  const fields = []
  let maxGrad = 0
  for (let step = 1; step <= cfg.steps; step++) {
    const frac = 1 / (cfg.steps - step + 1)
    const nodes = guards.map(([x, y]) => ({ x, y, ex: 0, ey: 0 }))
    for (const s of all) {
      const ex = (s.x - s.cx) * frac, ey = (s.y - s.cy) * frac, x = s.cx + ex, y = s.cy + ey
      s.qx = x; s.qy = y
      if (nodes.some(n => (n.x - x) ** 2 + (n.y - y) ** 2 < gap * gap)) continue // too close to a node already taken
      nodes.push({ x, y, ex, ey })
    }
    // exact interpolation: K w = e (Cholesky; the Wendland kernel matrix is positive definite)
    const n = nodes.length
    const L = Array.from({ length: n }, () => new Float64Array(n))
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) L[i][j] = phi(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y))
    for (let j = 0; j < n; j++) {
      let d = L[j][j]; for (let k = 0; k < j; k++) d -= L[j][k] * L[j][k]
      if (d <= 1e-12) throw new Error(`${map.id}: coast snap step ${step}: kernel matrix not positive definite at node ${j} (two nodes on top of each other?)`)
      const dj = Math.sqrt(d); L[j][j] = dj
      for (let i = j + 1; i < n; i++) { let v = L[i][j]; for (let k = 0; k < j; k++) v -= L[i][k] * L[j][k]; L[i][j] = v / dj }
    }
    const solveChol = (rhs) => {
      const y = new Float64Array(n), w = new Float64Array(n)
      for (let i = 0; i < n; i++) { let v = rhs[i]; for (let k = 0; k < i; k++) v -= L[i][k] * y[k]; y[i] = v / L[i][i] }
      for (let i = n - 1; i >= 0; i--) { let v = y[i]; for (let k = i + 1; k < n; k++) v -= L[k][i] * w[k]; w[i] = v / L[i][i] }
      return w
    }
    const wx = solveChol(nodes.map(p => p.ex)), wy = solveChol(nodes.map(p => p.ey))
    // the field, tabulated on a lattice and read back bilinearly
    const minX = Math.min(...all.map(s => s.qx)) - R, maxX = Math.max(...all.map(s => s.qx)) + R
    const minY = Math.min(...all.map(s => s.qy)) - R, maxY = Math.max(...all.map(s => s.qy)) + R
    const bw = Math.ceil((maxX - minX) / R), bh = Math.ceil((maxY - minY) / R)
    const buckets = Array.from({ length: bw * bh }, () => [])
    nodes.forEach((p, i) => { const bx = Math.floor((p.x - minX) / R), by = Math.floor((p.y - minY) / R); if (bx >= 0 && by >= 0 && bx < bw && by < bh) buckets[by * bw + bx].push(i) })
    const gw = Math.ceil((maxX - minX) / cell) + 1, gh = Math.ceil((maxY - minY) / cell) + 1
    const EX = new Float32Array(gw * gh), EY = new Float32Array(gw * gh)
    for (let j = 0; j < gh; j++) {
      const y = minY + j * cell, by = Math.floor((y - minY) / R)
      for (let i = 0; i < gw; i++) {
        const x = minX + i * cell, bx = Math.floor((x - minX) / R)
        let sx = 0, sy = 0
        for (let bj = by - 1; bj <= by + 1; bj++) for (let bi = bx - 1; bi <= bx + 1; bi++) {
          if (bi < 0 || bj < 0 || bi >= bw || bj >= bh) continue
          for (const k of buckets[bj * bw + bi]) { const f = phi(Math.hypot(nodes[k].x - x, nodes[k].y - y)); if (f) { sx += wx[k] * f; sy += wy[k] * f } }
        }
        EX[j * gw + i] = sx; EY[j * gw + i] = sy
      }
    }
    for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
      const o = j * gw + i
      const g = Math.hypot(EX[o + 1] - EX[o - 1], EX[o + gw] - EX[o - gw], EY[o + 1] - EY[o - 1], EY[o + gw] - EY[o - gw]) / (2 * cell)
      if (g > maxGrad) maxGrad = g
    }
    const at = (x, y) => {
      const fx = (x - minX) / cell, fy = (y - minY) / cell
      if (fx < 0 || fy < 0 || fx >= gw - 1 || fy >= gh - 1) return [0, 0]
      const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, o = j * gw + i
      return [EX[o] * (1 - tx) * (1 - ty) + EX[o + 1] * tx * (1 - ty) + EX[o + gw] * (1 - tx) * ty + EX[o + gw + 1] * tx * ty,
        EY[o] * (1 - tx) * (1 - ty) + EY[o + 1] * tx * (1 - ty) + EY[o + gw] * (1 - tx) * ty + EY[o + gw + 1] * tx * ty]
    }
    fields.push(at)
    // where every drawn coast point sits after this move: P − e(P) = C
    for (const s of all) { let px = s.qx, py = s.qy; for (let it = 0; it < 30; it++) { const [ex, ey] = at(px, py); px = s.cx + ex; py = s.cy + ey } s.cx = px; s.cy = py }
  }
  const after = gapOf()
  const undo = (x, y) => { for (let i = fields.length - 1; i >= 0; i--) { const [ex, ey] = fields[i](x, y); x -= ex; y -= ey } return [x, y] }
  const stats = { pairs: all.length, steps: cfg.steps, radiusM: cfg.radiusM, maxStepGradient: +maxGrad.toFixed(2), splineMedianM: q(before, 0.5), splineP90M: q(before, 0.9), splineMaxM: q(before, 1), leftMedianM: q(after, 0.5), leftMaxM: q(after, 1) }
  console.log(`   coast snap: ${all.length} pairs (${lost} not invertible), ${guards.length} landmarks held, ${cfg.steps} steps, radius ${cfg.radiusM} m, largest step gradient ${stats.maxStepGradient}; the spline alone leaves the drawn coast median ${stats.splineMedianM} m, p90 ${stats.splineP90M} m, max ${stats.splineMaxM} m off the reference shoreline; after the snap: median ${stats.leftMedianM} m, max ${stats.leftMaxM} m`)
  if (process.env.OLD_MAPS_SNAP_DEBUG) {
    for (const w of all.map(p => ({ p, left: Math.hypot(p.x - p.cx, p.y - p.cy) * 1000 })).filter(w => w.left > 2).sort((a, b) => b.left - a.left).slice(0, 20)) console.log(`      left ${w.left.toFixed(1)} m at ${toLL(w.p.x, w.p.y).map(v => v.toFixed(5)).join(', ')}`)
    const ll = (x, y) => toLL(x, y).map(v => +v.toFixed(6))
    fs.writeFileSync(path.join(CACHE, `snap-debug-${map.id}.json`), JSON.stringify({ id: map.id, stretches: rows.map((row, i) => ({ name: data.stretches[i].name, samples: row.map(s => ({ target: ll(s.x, s.y), spline: ll(s.x0, s.y0), snapped: ll(s.cx, s.cy) })) })) }))
  }
  return { undo, stats }
}

async function warp(map, plate) {
  const lambda = LAMBDA_OVERRIDE ?? map.lambda
  const gcps = map.gcps.map(g => resolveGcp(map, g))
  const pts = gcps.map(g => { const [x, y] = toXY(g.lng, g.lat); return { x, y, u: g.u, v: g.v } })
  const fu = fitTPS(pts.map(q => ({ x: q.x, y: q.y, val: q.u })), lambda)
  const fv = fitTPS(pts.map(q => ({ x: q.x, y: q.y, val: q.v })), lambda)
  const SW = plate.info.width, SH = plate.info.height, CH = plate.info.channels, raw = plate.data
  const snap = buildCoastSnap(map, gcps, fu, fv)
  // ground (km) → plate px, through the coast snap when the map has one
  const F = snap ? (x, y) => { const [sx, sy] = snap.undo(x, y); return [fu(sx, sy), fv(sx, sy)] } : (x, y) => [fu(x, y), fv(x, y)]
  // Residual per control point in METRES: the pixel misfit mapped back through the local
  // Jacobian of the (metres → plate px) spline, so both plates are measured the same way.
  const residuals = gcps.map((g, i) => {
    const { x, y } = pts[i], h = 0.01
    const du = fu(x, y) - g.u, dv = fv(x, y) - g.v
    const a = (fu(x + h, y) - fu(x - h, y)) / (2 * h), b = (fu(x, y + h) - fu(x, y - h)) / (2 * h)
    const c = (fv(x + h, y) - fv(x - h, y)) / (2 * h), d = (fv(x, y + h) - fv(x, y - h)) / (2 * h)
    const det = a * d - b * c
    const dx = (d * du - b * dv) / det, dy = (-c * du + a * dv) / det // km
    return { name: g.name, m: +(Math.hypot(dx, dy) * 1000).toFixed(1) }
  })
  const rms = +Math.sqrt(residuals.reduce((s, r) => s + r.m * r.m, 0) / residuals.length).toFixed(1)
  // Target bounds: the control points' box widened by the map's margin; trimmed to content after.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const g of gcps) { const [x, y] = toXY(g.lng, g.lat); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  const m = map.marginKm
  minX -= m; maxX += m; minY -= m; maxY += m
  const RES = map.resM
  const W = Math.round((maxX - minX) * 1000 / RES), H = Math.round((maxY - minY) * 1000 / RES)
  const out = Buffer.alloc(W * H * 4, 0)
  let x0f = W, x1f = 0, y0f = H, y1f = 0
  for (let j = 0; j < H; j++) {
    const y = maxY - (j + 0.5) * RES / 1000
    for (let i = 0; i < W; i++) {
      const x = minX + (i + 0.5) * RES / 1000
      const [u, v] = F(x, y)
      const iu = Math.floor(u), iv = Math.floor(v)
      if (iu < 0 || iv < 0 || iu >= SW - 1 || iv >= SH - 1) continue
      const fx = u - iu, fy = v - iv
      const i00 = (iv * SW + iu) * CH, i10 = i00 + CH, i01 = i00 + SW * CH, i11 = i01 + CH
      const o = (j * W + i) * 4
      for (let c = 0; c < 3; c++) out[o + c] = raw[i00 + c] * (1 - fx) * (1 - fy) + raw[i10 + c] * fx * (1 - fy) + raw[i01 + c] * (1 - fx) * fy + raw[i11 + c] * fx * fy
      out[o + 3] = 255
      if (i < x0f) x0f = i; if (i > x1f) x1f = i; if (j < y0f) y0f = j; if (j > y1f) y1f = j
    }
  }
  const tx0 = Math.max(0, x0f - 2), ty0 = Math.max(0, y0f - 2), tw = Math.min(W, x1f + 3) - tx0, th = Math.min(H, y1f + 3) - ty0

  // Fold check: the sign of the inverse map's Jacobian over the content area. A sign flip means
  // two control points demanded the paper cross itself there — the plate would show a mirrored
  // patch — so the picks around it need another look.
  {
    // north-up metres -> y-down plate px: the right way up is a NEGATIVE determinant
    const ups = [], downs = []
    for (let j = ty0; j < ty0 + th; j += 8) for (let i = tx0; i < tx0 + tw; i += 8) {
      if (out[(j * W + i) * 4 + 3] === 0) continue
      const x = minX + (i + 0.5) * RES / 1000, y = maxY - (j + 0.5) * RES / 1000, h = RES / 1000
      const e1 = F(x + h, y), e0 = F(x - h, y), n1 = F(x, y + h), n0 = F(x, y - h)
      const a = e1[0] - e0[0], b = n1[0] - n0[0], c = e1[1] - e0[1], d = n1[1] - n0[1]
      ;(a * d - b * c < 0 ? downs : ups).push([x, y])
    }
    const bad = ups.length <= downs.length ? ups : downs, flipped = bad.length, total = ups.length + downs.length
    let fx0 = Infinity, fx1 = -Infinity, fy0 = Infinity, fy1 = -Infinity
    for (const [x, y] of bad) { fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x); fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y) }
    if (flipped && process.env.OLD_MAPS_SNAP_DEBUG) for (const [x, y] of bad.slice(0, 30)) console.log('      flipped at ' + toLL(x, y).map(v => v.toFixed(5)).join(', '))
    console.log(`   fold check: ${flipped === 0 ? 'none' : `${flipped} of ${total} samples flipped (${(100 * flipped / total).toFixed(2)} %) << flipped box lng ${toLL(fx0, 0)[0].toFixed(5)}..${toLL(fx1, 0)[0].toFixed(5)} lat ${toLL(0, fy0)[1].toFixed(5)}..${toLL(0, fy1)[1].toFixed(5)}`}`)
  }
  const west = toLL(minX + tx0 * RES / 1000, 0)[0], east = toLL(minX + (tx0 + tw) * RES / 1000, 0)[0]
  const north = toLL(0, maxY - ty0 * RES / 1000)[1], south = toLL(0, maxY - (ty0 + th) * RES / 1000)[1]
  const img = sharp(out, { raw: { width: W, height: H, channels: 4 } }).extract({ left: tx0, top: ty0, width: tw, height: th })
  if (PREVIEW) {
    const pw = 1400, ps = pw / tw
    let svg = `<svg width="${pw}" height="${Math.round(th * ps)}" xmlns="http://www.w3.org/2000/svg">`
    for (const g of gcps) {
      const [x, y] = toXY(g.lng, g.lat)
      const px = ((x - (minX + tx0 * RES / 1000)) * 1000 / RES) * ps, py = (((maxY - ty0 * RES / 1000) - y) * 1000 / RES) * ps
      svg += `<circle cx="${px}" cy="${py}" r="5" fill="none" stroke="#e00" stroke-width="2"/><circle cx="${px}" cy="${py}" r="1.5" fill="#e00"/><text x="${px + 7}" y="${py + 4}" font-size="11" fill="#c00" font-family="sans-serif">${g.name.split(' ')[0]}</text>`
    }
    svg += '</svg>'
    const file = path.join(PREVIEW_DIR, `old-maps-preview-${map.id}.png`)
    await img.clone().resize({ width: pw }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(file)
    console.log(`   preview ${file}`)
    return { preview: true, gcps, residuals, rms, lambda, coastSnap: snap?.stats ?? null }
  }
  const file = path.join(OUT_DIR, `${map.id}.webp`)
  await img.webp({ quality: 82, alphaQuality: 50 }).toFile(file)
  return { file, width: tw, height: th, bounds: { west: +west.toFixed(6), east: +east.toFixed(6), north: +north.toFixed(6), south: +south.toFixed(6) }, gcps, residuals, rms, lambda, coastSnap: snap?.stats ?? null }
}

const built = []
for (const map of MAPS) {
  if (only && map.id !== only) continue
  console.log(`== ${map.id}`)
  if (CHECK) { checkGcps(map); continue }
  const plate = await buildPlate(map)
  console.log(`   plate ${plate.info.width}x${plate.info.height}`)
  if (GCPS) { await gcpSheet(map, plate); continue }
  const w = await warp(map, plate)
  for (const r of w.residuals) console.log(`   ${String(r.m).padStart(6)} m  ${r.name}`)
  console.log(`   λ ${w.lambda}; RMS ${w.rms} m`)
  if (w.preview) continue
  console.log(`   wrote ${path.relative(ROOT, w.file)} ${w.width}x${w.height} ${(fs.statSync(w.file).size / 1024).toFixed(0)} KB`)
  const b = w.bounds
  built.push({
    id: map.id, name: map.name, title: map.title, author: map.author, year: map.year, published: map.published, work: map.work,
    image: `/data/old-maps/${map.id}.webp`, width: w.width, height: w.height,
    bounds: b,
    coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]],
    georef: { method: 'thin-plate spline', lambda: w.lambda, metresPerPixel: map.resM, controlPoints: w.gcps.length, rmsM: w.rms,
      gcps: w.gcps.map((g, i) => ({ name: g.name, platePixel: [+g.u.toFixed(1), +g.v.toFixed(1)], lngLat: [g.lng, g.lat], residualM: w.residuals[i].m, note: g.note })),
      ...(w.coastSnap ? { coastSnap: w.coastSnap } : {}) },
    scan: map.scan, references: map.references, notes: map.notes,
    attribution: `${map.author.split(';')[0]}, ${map.year}${map.published && map.published !== map.year ? `/${map.published}` : ''}. Scan: ${map.scan.holder} via ${map.scan.via}, public domain. Georeferenced by mini-macau.`,
  })
}
if (PREVIEW || GCPS || CHECK) process.exit(0)
const existing = fs.existsSync(OUT_JSON) ? JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')) : { maps: [] }
const merged = only ? [...existing.maps.filter(m => !built.some(n => n.id === m.id)), ...built].sort((a, b) => a.year - b.year) : built
fs.writeFileSync(OUT_JSON, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), maps: merged }, null, 2) + '\n')
console.log(`wrote ${path.relative(ROOT, OUT_JSON)} (${merged.length} map${merged.length === 1 ? '' : 's'})`)
