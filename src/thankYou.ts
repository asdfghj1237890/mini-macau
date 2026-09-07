// The /thank-you landing page: its three-language copy, the GitHub-star and
// back-to-map click events, and the same engagement tracker the map runs
// (`startEngagementTracker`), so both pages count dwell and idle time the
// same way and under the same event names. Vite builds the page as a second
// entry (see vite.config.ts); the GA4 stub stays inline in thank-you.html so
// `window.gtag` exists before this module runs.
import { ga, startEngagementTracker } from './analytics/ga'

type Lang = 'en' | 'zh' | 'pt'

const translations: Record<Lang, Record<string, string>> = {
  en: {
    label: '— TRANSMISSION RECEIVED —',
    title: 'Thank You',
    subtitle: 'Thanks for trying Mini Map Macau.',
    description:
      "This is an open-source, real-time 3D visualization of Macau's public transit — built in spare time. If you found it fun or useful, a star on GitHub genuinely helps more people discover the project.",
    cta: 'STAR ON GITHUB',
    repoLabel: 'REPO',
    licenseLabel: 'LICENSE',
    back: 'Back to the map',
    footerLeft: 'MINI MAP MACAU · OPEN SOURCE',
    docTitle: 'Thank You · Mini Map Macau',
  },
  zh: {
    label: '— 收到訊號 —',
    title: '<span class="cjk">感謝</span>',
    subtitle: '謝謝你試用 Mini Map Macau。',
    description:
      '這是一個開源的澳門公共運輸即時 3D 可視化專案，由一個開發者在業餘時間做出來。如果你覺得好玩或有幫助，希望你可以在 GitHub 上給這個專案一顆 star ⭐ — 會讓更多澳門人有機會看到這個專案，對我是很大的鼓勵！',
    cta: 'GITHUB 按個 STAR',
    repoLabel: '儲存庫',
    licenseLabel: '授權',
    back: '返回地圖',
    footerLeft: 'MINI MAP MACAU · 開源專案',
    docTitle: '感謝 · Mini Map Macau',
  },
  pt: {
    label: '— TRANSMISSÃO RECEBIDA —',
    title: 'Obrigado',
    subtitle: 'Obrigado por experimentar o Mini Map Macau.',
    description:
      'Este é um projecto open-source de visualização 3D em tempo real dos transportes públicos de Macau, feito nas horas livres. Se gostou ou lhe foi útil, uma star no GitHub ajuda realmente mais pessoas a descobrir o projecto.',
    cta: 'STAR NO GITHUB',
    repoLabel: 'REPO',
    licenseLabel: 'LICENÇA',
    back: 'Voltar ao mapa',
    footerLeft: 'MINI MAP MACAU · OPEN SOURCE',
    docTitle: 'Obrigado · Mini Map Macau',
  },
}

// The same <html lang> tags and localStorage key as the map's i18n.tsx, so a
// language picked on either page carries over to the other.
const HTML_LANG: Record<Lang, string> = { zh: 'zh-Hant', pt: 'pt-PT', en: 'en' }
const LS_LANG_KEY = 'mm_lang'

function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'zh' || value === 'pt'
}

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LS_LANG_KEY)
    if (isLang(saved)) return saved
  } catch {
    // storage unavailable
  }
  const nav = (navigator.language || 'zh').toLowerCase()
  if (nav.startsWith('zh')) return 'zh'
  if (nav.startsWith('pt')) return 'pt'
  return 'en'
}

function apply(lang: Lang): void {
  const t = translations[lang]
  document.documentElement.lang = HTML_LANG[lang]
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n
    if (key && t[key]) el.textContent = t[key]
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-html]')) {
    const key = el.dataset.i18nHtml
    if (key && t[key]) el.innerHTML = t[key]
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.lang button')) {
    button.classList.toggle('active', button.dataset.lang === lang)
  }
  document.title = t.docTitle
  try {
    localStorage.setItem(LS_LANG_KEY, lang)
  } catch {
    // ignore
  }
}

let currentLang = detectLang()
apply(currentLang)

for (const button of document.querySelectorAll<HTMLButtonElement>('.lang button')) {
  button.addEventListener('click', () => {
    const next = button.dataset.lang
    if (!isLang(next)) return
    if (next !== currentLang) {
      ga.languageChanged(currentLang, next, 'thank_you')
      currentLang = next
    }
    apply(next)
  })
}

document.getElementById('star-btn')?.addEventListener('click', () => {
  ga.thankYouStarClicked(currentLang)
})
document.getElementById('back-link')?.addEventListener('click', () => {
  ga.thankYouBackClicked(currentLang)
})

startEngagementTracker()
