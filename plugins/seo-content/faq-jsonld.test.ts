// Locks the FAQPage JSON-LD to the visible zh FAQ in the site-info panel:
// Google requires structured-data text to be present in the page content,
// and the two copies live ~200 lines apart in index.html. Question names
// must equal the <dt> text; answer texts must be a prefix of the <dd> text
// (a dd may carry an extra trailing cross-reference sentence).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

type LdQuestion = {
  '@type': string
  name: string
  acceptedAnswer: { '@type': string; text: string }
}
type LdBlock = { '@type'?: string; mainEntity?: LdQuestion[] }

const LD_JSON_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g

function readIndexHtml(): string {
  const p = fileURLToPath(new URL('../../index.html', import.meta.url))
  return fs.readFileSync(p, 'utf8')
}

describe('FAQPage JSON-LD', () => {
  it('matches the visible zh FAQ', () => {
    const html = readIndexHtml()
    const blocks = [...html.matchAll(LD_JSON_RE)]
      .map(m => JSON.parse(m[1]) as LdBlock)
    const faq = blocks.find(b => b['@type'] === 'FAQPage')
    expect(faq).toBeDefined()
    const questions = faq?.mainEntity ?? []
    expect(questions).toHaveLength(8)
    for (const q of questions) {
      expect(q['@type']).toBe('Question')
      expect(html).toContain(`<dt>${q.name}</dt>`)
      expect(html).toContain(`<dd>${q.acceptedAnswer.text}`)
    }
  })

  it('keeps every ld+json block parseable', () => {
    const html = readIndexHtml()
    const blocks = [...html.matchAll(LD_JSON_RE)]
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    for (const m of blocks) {
      expect(() => JSON.parse(m[1])).not.toThrow()
    }
  })
})
