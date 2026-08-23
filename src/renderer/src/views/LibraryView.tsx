import { useMemo, useState } from 'react'
import type { ResumeSummary } from '@shared/types.js'
import type { Toast } from '../components/Toasts.js'
import { FunnelMark } from '../components/Brand.js'

/** Last path segment, tolerating both POSIX and Windows separators. */
function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
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
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteLabel, setPasteLabel] = useState('')

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return resumes
    return resumes.filter((r) =>
      [r.name, r.fileName, r.email, r.location, ...r.skills]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [resumes, filter])

  const pickFiles = async (): Promise<void> => {
    await onIngestPaths(await window.api.ingest.pickFiles())
  }

  const pickFolder = async (): Promise<void> => {
    const folder = await window.api.ingest.pickFolder()
    if (!folder) return
    const outcomes = await window.api.ingest.folder(folder)
    const imported = outcomes.filter((o) => o.status === 'imported').length
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
        kind: outcome.status === 'imported' ? 'success' : 'error',
        message:
          outcome.status === 'imported'
            ? `Added ${outcome.resume.name ?? 'pasted resume'}`
            : outcome.status === 'duplicate'
              ? 'That resume is already in the library'
              : `Could not add: ${'reason' in outcome ? outcome.reason : 'unknown error'}`
      }
    ])
    if (outcome.status === 'imported') {
      setPasteText('')
      setPasteLabel('')
      setPasting(false)
    }
    await onChanged()
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
          {resumes.length} resume{resumes.length === 1 ? '' : 's'} indexed. Drag files anywhere onto
          this window to add more.
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
              <FunnelMark size={30} />
            </span>
            <p className="empty-title">Your library is empty</p>
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
              <th>Candidate</th>
              <th style={{ width: 150 }}>Contact</th>
              <th className="num" style={{ width: 60 }}>
                Years
              </th>
              <th style={{ width: 90 }}>Education</th>
              <th>Skills</th>
              <th style={{ width: 130 }} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => onOpenResume(r)}>
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
