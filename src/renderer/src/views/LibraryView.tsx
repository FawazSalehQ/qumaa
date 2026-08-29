import { useMemo, useState } from 'react'
import type { ResumeSummary } from '@shared/types.js'
import type { Toast } from '../components/Toasts.js'
import { QumaaMark } from '../components/Brand.js'

/** Last path segment, tolerating both POSIX and Windows separators. */
function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

type SortKey = 'name' | 'years' | 'education' | 'imported'

/** Nulls always sort last regardless of direction: an unparsed field is absence
 *  of information, not a low value, and burying it keeps the useful rows on top. */
function compare(a: ResumeSummary, b: ResumeSummary, key: SortKey): number {
  const nullsLast = (x: unknown, y: unknown): number | null => {
    const xn = x === null || x === undefined
    const yn = y === null || y === undefined
    if (xn && yn) return 0
    if (xn) return 1
    if (yn) return -1
    return null
  }
  switch (key) {
    case 'name': {
      const n = nullsLast(a.name, b.name)
      return n ?? (a.name as string).localeCompare(b.name as string)
    }
    case 'years': {
      const n = nullsLast(a.yearsExperience, b.yearsExperience)
      return n ?? (a.yearsExperience as number) - (b.yearsExperience as number)
    }
    case 'education': {
      const rank = { phd: 4, masters: 3, bachelors: 2, associate: 1, none: 0 }
      const n = nullsLast(a.educationLevel, b.educationLevel)
      return n ?? rank[a.educationLevel!] - rank[b.educationLevel!]
    }
    case 'imported':
      return a.importedAt - b.importedAt
  }
}

function SortHeader({
  label,
  k,
  sort,
  asc,
  onSort
}: {
  label: string
  k: SortKey
  sort: SortKey
  asc: boolean
  onSort: (k: SortKey) => void
}): React.JSX.Element {
  const active = sort === k
  return (
    <button
      className={`sort-header ${active ? 'active' : ''}`}
      onClick={() => onSort(k)}
      aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span className="sort-arrow">{active ? (asc ? '\u2191' : '\u2193') : ''}</span>
    </button>
  )
}

interface Props {
  resumes: ResumeSummary[]
  onChanged: () => Promise<void>
  onIngestPaths: (paths: string[]) => Promise<void>
  onToast: (t: Toast[]) => void
  onOpenResume: (r: ResumeSummary) => void
}

export default function LibraryView({
  resumes,
  onChanged,
  onIngestPaths,
  onToast,
  onOpenResume
}: Props): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('imported')
  const [asc, setAsc] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteLabel, setPasteLabel] = useState('')

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matched = q
      ? resumes.filter((r) =>
          [r.name, r.fileName, r.email, r.location, ...r.skills]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        )
      : resumes
    // Copy before sorting: the prop array belongs to the parent.
    return [...matched].sort((a, b) => (asc ? 1 : -1) * compare(a, b, sort))
  }, [resumes, filter, sort, asc])

  const pickFiles = async (): Promise<void> => {
    await onIngestPaths(await window.api.ingest.pickFiles())
  }

  const pickFolder = async (): Promise<void> => {
    const folder = await window.api.ingest.pickFolder()
    if (!folder) return
    const outcomes = await window.api.ingest.folder(folder)
    const imported = outcomes.filter(
      (o) => o.status === 'imported' || o.status === 'near-duplicate'
    ).length
    const dupes = outcomes.filter((o) => o.status === 'duplicate').length
    onToast([
      {
        id: crypto.randomUUID(),
        kind: 'success',
        message: `${basename(folder)}: ${imported} imported, ${dupes} already present`
      }
    ])
    await onChanged()
  }

  const submitPaste = async (): Promise<void> => {
    if (!pasteText.trim()) return
    const outcome = await window.api.ingest.text(pasteText, pasteLabel || 'Pasted resume')
    onToast([
      {
        id: crypto.randomUUID(),
        kind:
          outcome.status === 'imported' || outcome.status === 'near-duplicate'
            ? 'success'
            : 'error',
        message:
          outcome.status === 'imported'
            ? `Added ${outcome.resume.name ?? 'pasted resume'}`
            : outcome.status === 'near-duplicate'
              ? `Added ${outcome.resume.name ?? 'pasted resume'}, which closely resembles ${outcome.similarTo.name ?? outcome.similarTo.fileName}`
            : outcome.status === 'duplicate'
              ? 'That resume is already in the library'
              : `Could not add: ${'reason' in outcome ? outcome.reason : 'unknown error'}`
      }
    ])
    if (outcome.status === 'imported' || outcome.status === 'near-duplicate') {
      setPasteText('')
      setPasteLabel('')
      setPasting(false)
    }
    await onChanged()
  }

  const toggleSort = (key: SortKey): void => {
    if (sort === key) setAsc((a) => !a)
    else {
      setSort(key)
      // Names read best A to Z; everything else is most-useful-first descending.
      setAsc(key === 'name')
    }
  }

  const toggleOne = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id))

  const toggleAll = (): void => {
    setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.id)))
  }

  const removeSelected = async (): Promise<void> => {
    const ids = [...selected]
    const deleted = await window.api.resumes.removeMany(ids)
    if (deleted > 0) {
      onToast([
        { id: crypto.randomUUID(), kind: 'success', message: `Deleted ${deleted} resumes` }
      ])
      setSelected(new Set())
      await onChanged()
    }
  }

  const remove = async (r: ResumeSummary): Promise<void> => {
    await window.api.resumes.remove(r.id)
    await onChanged()
  }

  return (
    <>
      <header className="view-head">
        <h2>Library</h2>
        <p className="sub">
          {resumes.length} resume{resumes.length === 1 ? '' : 's'}
        </p>
      </header>

      <div className="row toolbar">
        <button className="btn" onClick={pickFiles}>
          Add files…
        </button>
        <button className="btn" onClick={pickFolder}>
          Import folder…
        </button>
        <button className="btn" onClick={() => setPasting((p) => !p)}>
          Paste text
        </button>
        {selected.size > 0 && (
          <>
            <span className="selection-count">{selected.size} selected</span>
            <button className="btn sm danger" onClick={removeSelected}>
              Delete selected
            </button>
            <button className="btn sm" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </>
        )}
        <span className="spacer" />
        <input
          type="text"
          placeholder="Filter by name, skill, email…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 240 }}
        />
      </div>

      {pasting && (
        <div className="card" style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Label (e.g. candidate name)"
            value={pasteLabel}
            onChange={(e) => setPasteLabel(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <textarea
            rows={8}
            placeholder="Paste the resume text here…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={submitPaste} disabled={!pasteText.trim()}>
              Add to library
            </button>
            <button className="btn" onClick={() => setPasting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        resumes.length === 0 ? (
          <div className="empty">
            <span className="empty-mark">
              <QumaaMark size={30} tone="color" />
            </span>
            <p className="empty-title">No resumes yet</p>
            <p className="empty-body">
              Drag PDFs, DOCX, or text files anywhere onto this window, or pick them yourself.
            </p>
            <div className="row empty-actions">
              <button className="btn primary" onClick={pickFiles}>
                Add files…
              </button>
              <button className="btn" onClick={pickFolder}>
                Import folder…
              </button>
            </div>
          </div>
        ) : (
          <div className="empty">
            <p className="empty-title">No matches</p>
            <p className="empty-body">Nothing in the library matches “{filter}”.</p>
            <div className="row empty-actions">
              <button className="btn" onClick={() => setFilter('')}>
                Clear filter
              </button>
            </div>
          </div>
        )
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  onChange={toggleAll}
                  aria-label="Select all shown"
                />
              </th>
              <th>
                <SortHeader label="Candidate" k="name" sort={sort} asc={asc} onSort={toggleSort} />
              </th>
              <th style={{ width: 150 }}>Contact</th>
              <th className="num" style={{ width: 74 }}>
                <SortHeader label="Years" k="years" sort={sort} asc={asc} onSort={toggleSort} />
              </th>
              <th style={{ width: 104 }}>
                <SortHeader label="Education" k="education" sort={sort} asc={asc} onSort={toggleSort} />
              </th>
              <th>Skills</th>
              <th style={{ width: 130 }} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                className={`clickable ${selected.has(r.id) ? 'selected' : ''}`}
                onClick={() => onOpenResume(r)}
              >
                {/* Selecting must not also open the detail panel. */}
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleOne(r.id)}
                    aria-label={`Select ${r.name ?? r.fileName}`}
                  />
                </td>
                <td>
                  <div className="cell-title">
                    {r.name ?? <span className="muted">Unknown name</span>}
                  </div>
                  <div className="cell-sub">
                    {r.fileName}{' '}
                    {r.likelyScanned && <span className="warn-badge">no text layer</span>}
                  </div>
                </td>
                <td className="cell-sub">
                  {r.email && <div>{r.email}</div>}
                  {r.phone && <div>{r.phone}</div>}
                  {r.location && <div>{r.location}</div>}
                  {!r.email && !r.phone && !r.location && <span className="muted">n/a</span>}
                </td>
                <td className="num">{r.yearsExperience ?? <span className="muted">n/a</span>}</td>
                <td className="muted">{r.educationLevel ?? 'n/a'}</td>
                <td className="cell-sub">
                  {r.skills.slice(0, 8).join(', ') || <span className="muted">none detected</span>}
                  {r.skills.length > 8 && ` +${r.skills.length - 8}`}
                </td>
                {/* Row actions must not also trigger the row's open handler. */}
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row row-actions">
                    {r.filePath && (
                      <button
                        className="btn sm"
                        onClick={() => window.api.resumes.reveal(r.filePath)}
                      >
                        Reveal
                      </button>
                    )}
                    <button className="btn sm danger" onClick={() => remove(r)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
