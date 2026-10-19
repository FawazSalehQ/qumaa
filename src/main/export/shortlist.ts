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
import { readFile, writeFile } from 'node:fs/promises'
import { directionFor, localeFor, translate, type Language } from '@shared/i18n.js'
import arabicRegularPath from '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2?asset'
import arabicSemiboldPath from '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2?asset'
import { EDUCATION_LABELS, type MatchResult } from '@shared/types.js'

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

function candidateBlock(m: MatchResult, rank: number, language: Language, note?: string): string {
  const t = (message: string): string => translate(language, message)
  const number = (value: number): string => new Intl.NumberFormat(localeFor(language)).format(value)
  const isolated = (value: string, direction = 'auto'): string => `<bdi dir="${direction}">${esc(value)}</bdi>`
  const r = m.resume
  const contact = [
    r.email ? isolated(r.email, 'ltr') : null,
    r.phone ? isolated(r.phone, 'ltr') : null,
    r.location ? isolated(r.location) : null
  ].filter(Boolean).join(' &middot; ')
  const facts = [
    r.yearsExperience !== null ? translate(language, '{count} years', { count: number(r.yearsExperience) }) : null,
    r.educationLevel ? t(EDUCATION_LABELS[r.educationLevel]) : null
  ]
    .filter(Boolean)
    .map((x) => esc(String(x)))
    .join(' &middot; ')

  const chip = (t: string, kind: string): string => `<span class="chip ${kind}">${isolated(t)}</span>`

  const bars: Array<[string, number]> = [
    ['Semantic', m.breakdown.semantic],
    ['Keyword', m.breakdown.lexical],
    ['Skills', m.breakdown.skills]
  ]

  return `<article class="candidate">
    <header>
      <span class="rank">${esc(number(rank))}</span>
      <div>
        <h2 dir="auto">${esc(r.name ?? r.fileName)}</h2>
        <p class="meta">${contact || isolated(r.fileName)}${facts ? ` &middot; ${facts}` : ''}</p>
      </div>
      <span class="score">${esc(number(Math.round(m.score * 100)))}</span>
    </header>

    <div class="bars">
      ${bars
        .map(
          ([label, v]) => `<div class="bar">
            <span class="bar-label">${esc(t(label))}</span>
            <span class="track"><span class="fill" style="width:${Math.round(v * 100)}%"></span></span>
            <span class="bar-val">${esc(number(Math.round(v * 100)))}</span>
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
          <span class="tag">${esc(t(e.section))} &middot; ${esc(translate(language, '{score}% match', { score: number(Math.round(e.similarity * 100)) }))}</span>
          <div dir="auto">${esc(e.text.length > 420 ? `${e.text.slice(0, 420)}…` : e.text)}</div>
        </blockquote>`
      )
      .join('')}
    ${note ? `<section class="recruiter-note"><strong>${esc(t('Recruiter notes'))}</strong><p dir="auto">${esc(note)}</p></section>` : ''}
  </article>`
}

export function shortlistHtml(args: {
  jobTitle: string
  requiredSkills: string[]
  results: MatchResult[]
  generatedAt: Date
  notes?: Record<string, string>
  curated?: boolean
  language?: Language
}): string {
  const language = args.language ?? 'en'
  const t = (message: string): string => translate(language, message)
  const date = args.generatedAt.toLocaleDateString(language === 'en' ? 'en-GB' : localeFor(language), {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  return `<!doctype html><html lang="${language}" dir="${directionFor(language)}"><head><meta charset="utf-8"><style>
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    .recruiter-note p { white-space: pre-wrap; overflow-wrap: anywhere; }
    body {
      font-family: 'Qumaa PDF Arabic', 'IBM Plex Sans', system-ui, sans-serif;
      color: ${INK}; margin: 0; font-size: 11pt; line-height: 1.5; text-align: start;
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
      margin-inline-start: auto; font-size: 16pt; font-weight: 700; color: ${VIOLET};
      font-variant-numeric: tabular-nums;
    }
    .bars { margin: 10px 0 8px; }
    .bar { display: flex; align-items: center; gap: 8px; font-size: 8.5pt; margin-bottom: 3px; }
    .bar-label {
      font-family: 'IBM Plex Mono', monospace; text-transform: uppercase;
      letter-spacing: 0.16em; color: #6b6577; min-width: 74px;
    }
    .track { flex: 1; height: 4px; background: ${PAPER}; border-radius: 2px; }
    .fill { display: block; height: 100%; background: ${VIOLET}; border-radius: 2px; }
    .bar-val { width: 24px; text-align: end; font-variant-numeric: tabular-nums; color: #6b6577; }
    .chips { margin: 8px 0; }
    .chip {
      display: inline-block; font-size: 8.5pt; padding: 1px 8px; border-radius: 20px;
      border: 1px solid #cfc6e2; margin: 0; margin-inline-end: 4px; margin-block-end: 4px;
    }
    .chip.has { background: #e7f4ee; border-color: #a4d8c1; color: #1f7a54; }
    .chip.missing { color: #8d8699; text-decoration: line-through; }
    blockquote {
      margin: 7px 0 0; padding-inline-start: 10px; border-inline-start: 2px solid ${VIOLET_200};
      color: #4a4557; font-size: 9.5pt;
    }
    .tag {
      display: block; font-family: 'IBM Plex Mono', monospace; font-size: 7.5pt;
      text-transform: uppercase; letter-spacing: 0.2em; color: #8d8699; margin-bottom: 2px;
    }
    html[lang="ar"] .bar-label, html[lang="ar"] .tag {
      font-family: 'Qumaa PDF Arabic', sans-serif; letter-spacing: normal; text-transform: none;
    }
    html[lang="ar"] .bar-label { width: 110px; }
    bdi { unicode-bidi: isolate; }
    h1, h2, .meta { overflow-wrap: anywhere; }
    footer {
      margin-top: 16px; padding-top: 8px; border-top: 1px solid #e4dff0;
      color: #8d8699; font-size: 8pt;
    }
  </style></head><body>
    <div class="sheet-head">
      ${MARK}
      <span class="wordmark" lang="ar" dir="rtl">قُمع</span>
      <span class="spacer"></span>
      <span class="when">${esc(date)}</span>
    </div>

    <h1 dir="auto">${esc(args.jobTitle)}</h1>
    <p class="posting-skills">${
      args.requiredSkills.length
        ? `${esc(t('Skills identified in this posting:'))} ${args.requiredSkills.map((skill) => `<bdi dir="auto">${esc(skill)}</bdi>`).join(language === 'ar' ? '، ' : ', ')}`
        : esc(t('No named skills were identified in this posting.'))
    }</p>

    ${args.results.map((m, i) => candidateBlock(m, i + 1, language, args.notes?.[m.resume.recordKey])).join('')}

    <footer>
      ${esc(t(args.curated ? 'Selected and ordered by the recruiter. Scores show local similarity to the posting.' : 'Ranked locally by similarity to the posting, not by judgement of seniority.'))}
      ${esc(t("Every quoted passage is verbatim from the candidate's own document."))}
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
  // Assets are emitted alongside the main bundle by electron-vite and included in
  // both installers. Inline them so even a data: document needs no local-file
  // permissions, network, or fonts installed on the recruiter's machine.
  const [regular, semibold] = await Promise.all([readFile(arabicRegularPath), readFile(arabicSemiboldPath)])
  const fontCss = `<style>
    @font-face { font-family: 'Qumaa PDF Arabic'; font-style: normal; font-weight: 400; font-display: block; src: url(data:font/woff2;base64,${regular.toString('base64')}) format('woff2'); }
    @font-face { font-family: 'Qumaa PDF Arabic'; font-style: normal; font-weight: 600 900; font-display: block; src: url(data:font/woff2;base64,${semibold.toString('base64')}) format('woff2'); }
  </style>`
  const printableHtml = html.replace('</head>', `${fontCss}</head>`)
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printableHtml)}`)
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await writeFile(destination, pdf)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
