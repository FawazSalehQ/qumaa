/**
 * Exports a ranked shortlist as a Qumaa-branded PDF.
 *
 * Rendered by loading HTML into an offscreen BrowserWindow and calling
 * `printToPDF`, which is built into Electron. A PDF library would be a second
 * layout engine to fight with, and the app already has one.
 *
 * Everything interpolated into the markup is escaped. Resume text originates in
 * arbitrary uploaded documents, so it is treated as untrusted input even though
 * it never leaves the machine.
 */
import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { MatchResult } from '@shared/types.js'

const INK = '#2b2733'
const VIOLET = '#6d3fb0'
const VIOLET_200 = '#c0a3ea'
const VIOLET_300 = '#8f5fd6'
const PAPER = '#f4f1f8'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The brand mark, inline so the PDF depends on no external asset. */
const MARK = `<svg viewBox="0 0 100 100" width="34" height="34">
  <rect width="100" height="100" rx="22" fill="${INK}"/>
  <rect x="28" y="10" width="52" height="14" rx="5" fill="${VIOLET_300}"/>
  <rect x="22" y="21" width="60" height="14" rx="5" fill="${VIOLET_200}"/>
  <polygon points="14,34 86,34 57,70 57,90 43,90 43,70" fill="#fff"/>
</svg>`

function candidateBlock(m: MatchResult, rank: number, note?: string): string {
  const r = m.resume
  const contact = [r.email, r.phone, r.location].filter(Boolean).map(String).map(esc).join(' &middot; ')
  const facts = [
    r.yearsExperience !== null ? `${r.yearsExperience} years` : null,
    r.educationLevel
  ]
    .filter(Boolean)
    .map((x) => esc(String(x)))
    .join(' &middot; ')

  const chip = (t: string, kind: string): string => `<span class="chip ${kind}">${esc(t)}</span>`

  const bars: Array<[string, number]> = [
    ['Semantic', m.breakdown.semantic],
    ['Keyword', m.breakdown.lexical],
    ['Skills', m.breakdown.skills]
  ]

  return `<article class="candidate">
    <header>
      <span class="rank">${rank}</span>
      <div>
        <h2>${esc(r.name ?? r.fileName)}</h2>
        <p class="meta">${contact || esc(r.fileName)}${facts ? ` &middot; ${facts}` : ''}</p>
      </div>
      <span class="score">${Math.round(m.score * 100)}</span>
    </header>

    <div class="bars">
      ${bars
        .map(
          ([label, v]) => `<div class="bar">
            <span class="bar-label">${label}</span>
            <span class="track"><span class="fill" style="width:${Math.round(v * 100)}%"></span></span>
            <span class="bar-val">${Math.round(v * 100)}</span>
          </div>`
        )
        .join('')}
    </div>

    ${
      m.matchedSkills.length || m.missingSkills.length
        ? `<div class="chips">${m.matchedSkills
            .map((s) => chip(s, 'has'))
            .join('')}${m.missingSkills.map((s) => chip(s, 'missing')).join('')}</div>`
        : ''
    }

    ${m.evidence
      .slice(0, 2)
      .map(
        (e) => `<blockquote>
          <span class="tag">${esc(e.section)} &middot; ${Math.round(e.similarity * 100)}% match</span>
          ${esc(e.text.length > 420 ? `${e.text.slice(0, 420)}…` : e.text)}
        </blockquote>`
      )
      .join('')}
    ${note ? `<section class="recruiter-note"><strong>Recruiter notes</strong><p>${esc(note)}</p></section>` : ''}
  </article>`
}

export function shortlistHtml(args: {
  jobTitle: string
  requiredSkills: string[]
  results: MatchResult[]
  generatedAt: Date
  notes?: Record<string, string>
  curated?: boolean
}): string {
  const date = args.generatedAt.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    .recruiter-note p { white-space: pre-wrap; overflow-wrap: anywhere; }
    body {
      font-family: 'IBM Plex Sans', system-ui, sans-serif;
      color: ${INK}; margin: 0; font-size: 11pt; line-height: 1.5;
    }
    .sheet-head {
      display: flex; align-items: center; gap: 10px;
      padding-bottom: 10px; border-bottom: 2px solid ${VIOLET}; margin-bottom: 18px;
    }
    .wordmark { font-size: 17pt; font-weight: 600; }
    .sheet-head .spacer { flex: 1; }
    .sheet-head .when { color: #6b6577; font-size: 9pt; }
    h1 { font-size: 15pt; margin: 0 0 2px; }
    .posting-skills { color: #6b6577; font-size: 9.5pt; margin: 0 0 18px; }
    .candidate {
      border: 1px solid #e4dff0; border-radius: 10px; padding: 13px 15px;
      margin-bottom: 12px; page-break-inside: avoid; background: #fff;
    }
    .candidate header { display: flex; align-items: flex-start; gap: 10px; }
    .rank {
      background: ${VIOLET}; color: #fff; font-weight: 700; font-size: 9pt;
      width: 21px; height: 21px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; flex: 0 0 auto;
    }
    .candidate h2 { font-size: 12.5pt; margin: 0; }
    .meta { color: #6b6577; font-size: 9pt; margin: 2px 0 0; }
    .score {
      margin-left: auto; font-size: 16pt; font-weight: 700; color: ${VIOLET};
      font-variant-numeric: tabular-nums;
    }
    .bars { margin: 10px 0 8px; }
    .bar { display: flex; align-items: center; gap: 8px; font-size: 8.5pt; margin-bottom: 3px; }
    .bar-label {
      font-family: 'IBM Plex Mono', monospace; text-transform: uppercase;
      letter-spacing: 0.16em; color: #6b6577; width: 74px;
    }
    .track { flex: 1; height: 4px; background: ${PAPER}; border-radius: 2px; }
    .fill { display: block; height: 100%; background: ${VIOLET}; border-radius: 2px; }
    .bar-val { width: 24px; text-align: right; font-variant-numeric: tabular-nums; color: #6b6577; }
    .chips { margin: 8px 0; }
    .chip {
      display: inline-block; font-size: 8.5pt; padding: 1px 8px; border-radius: 20px;
      border: 1px solid #cfc6e2; margin: 0 4px 4px 0;
    }
    .chip.has { background: #e7f4ee; border-color: #a4d8c1; color: #1f7a54; }
    .chip.missing { color: #8d8699; text-decoration: line-through; }
    blockquote {
      margin: 7px 0 0; padding-left: 10px; border-left: 2px solid ${VIOLET_200};
      color: #4a4557; font-size: 9.5pt;
    }
    .tag {
      display: block; font-family: 'IBM Plex Mono', monospace; font-size: 7.5pt;
      text-transform: uppercase; letter-spacing: 0.2em; color: #8d8699; margin-bottom: 2px;
    }
    footer {
      margin-top: 16px; padding-top: 8px; border-top: 1px solid #e4dff0;
      color: #8d8699; font-size: 8pt;
    }
  </style></head><body>
    <div class="sheet-head">
      ${MARK}
      <span class="wordmark" lang="ar">قُمع</span>
      <span class="spacer"></span>
      <span class="when">${esc(date)}</span>
    </div>

    <h1>${esc(args.jobTitle)}</h1>
    <p class="posting-skills">${
      args.requiredSkills.length
        ? `Skills identified in this posting: ${args.requiredSkills.map(esc).join(', ')}`
        : 'No named skills were identified in this posting.'
    }</p>

    ${args.results.map((m, i) => candidateBlock(m, i + 1, args.notes?.[m.resume.recordKey])).join('')}

    <footer>
      ${args.curated ? 'Selected and ordered by the recruiter. Scores show local similarity to the posting.' : 'Ranked locally by similarity to the posting, not by judgement of seniority.'}
      Every quoted passage is verbatim from the candidate's own document.
    </footer>
  </body></html>`
}

/**
 * Renders the HTML offscreen and writes a PDF.
 *
 * `javascript: false` because the page is pure markup: there is nothing for a
 * script to do, and disabling it removes any question about executing content
 * that originated in an uploaded document.
 */
export async function writeShortlistPdf(html: string, destination: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await writeFile(destination, pdf)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
