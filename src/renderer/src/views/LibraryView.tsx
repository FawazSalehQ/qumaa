import { useEffect, useMemo, useState } from 'react'
import type { ResumeSummary } from '@shared/types.js'
import { candidateWithProfile, type CandidateProfile } from '@shared/recruiting.js'
import type { Toast } from '../components/Toasts.js'
import { QumaaMark } from '../components/Brand.js'
import { compareResumes, type LibrarySortKey } from '../librarySort.js'
import '../components/recruiter-profile.css'

function SortHeader({
  label,
  k,
  sort,
  asc,
  onSort
}: {
  label: string
  k: LibrarySortKey
  sort: LibrarySortKey
  asc: boolean
  onSort: (k: LibrarySortKey) => void
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
  onImport: (kind: 'files' | 'folder') => Promise<void>
  onToast: (t: Toast[]) => void
  onOpenResume: (r: ResumeSummary) => void
  profileRevision?: number
}

export default function LibraryView({
  resumes,
  onChanged,
  onImport,
  onToast,
  onOpenResume,
  profileRevision = 0
}: Props): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<LibrarySortKey>('imported')
  const [asc, setAsc] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteLabel, setPasteLabel] = useState('')
  const [profiles, setProfiles] = useState<CandidateProfile[]>([])
  const [minimumYears, setMinimumYears] = useState('')
  const [education, setEducation] = useState('')
  const [withNotes, setWithNotes] = useState(false)
  const [availability, setAvailability] = useState('')

  useEffect(() => {
    let active = true
    window.api.recruiting.listProfiles().then((next) => {
      if (active) setProfiles(next)
    }).catch((error: unknown) => {
      if (!active) return
      setProfiles([])
      onToast([{ id: crypto.randomUUID(), kind: 'error', message: error instanceof Error ? error.message : 'Could not load recruiter profiles.' }])
    })
    return () => { active = false }
  }, [resumes, profileRevision, onToast])

  const profilesByRecord = useMemo(() => new Map(
    profiles.flatMap((profile) => profile.recordKeys.map((key) => [key, profile] as const))
  ), [profiles])

  // A restore can reuse numeric ids for different records. Selection belongs
  // to one rendered library snapshot and must never carry into the next one.
  useEffect(() => setSelected(new Set()), [resumes])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matched = resumes.map((resume) => candidateWithProfile(resume, profilesByRecord.get(resume.recordKey)))
      .filter((r) => {
        const profile = profilesByRecord.get(r.recordKey)
        if (minimumYears !== '' && (r.yearsExperience === null || r.yearsExperience < Number(minimumYears))) return false
        if (education && r.educationLevel !== education) return false
        if (withNotes && !profile?.note.trim()) return false
        if (availability === 'recorded' && !profile?.availability.trim()) return false
        if (availability === 'missing' && profile?.availability.trim()) return false
        return !q || [r.name, r.fileName, r.email, r.phone, r.location, ...r.skills,
          profile?.expectedSalary, profile?.noticePeriod, profile?.availability,
          profile?.preferredLocation, profile?.note, ...(profile?.tags ?? [])]
          .filter(Boolean).some((value) => String(value).toLowerCase().includes(q))
      })
    // Copy before sorting: the prop array belongs to the parent.
    return [...matched].sort((a, b) => compareResumes(a, b, sort, asc))
  }, [resumes, profilesByRecord, filter, minimumYears, education, withNotes, availability, sort, asc])

  const hasFilters = Boolean(filter || minimumYears || education || withNotes || availability)
  const clearFilters = (): void => {
    setFilter('')
    setMinimumYears('')
    setEducation('')
    setWithNotes(false)
    setAvailability('')
  }

  const pickFiles = async (): Promise<void> => {
    await onImport('files')
  }

  const pickFolder = async (): Promise<void> => {
    await onImport('folder')
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

  const toggleSort = (key: LibrarySortKey): void => {
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
    const selectedResumes = resumes.filter((resume) => selected.has(resume.id))
    const deleted = await window.api.resumes.removeMany(selectedResumes)
    if (deleted > 0) {
      onToast([
        { id: crypto.randomUUID(), kind: 'success', message: `Deleted ${deleted} resumes` }
      ])
      setSelected(new Set())
      await onChanged()
    }
  }

  const remove = async (r: ResumeSummary): Promise<void> => {
    const deleted = await window.api.resumes.remove(r)
    if (deleted) await onChanged()
  }

  return (
    <>
      <header className="view-head">
        <h2>Library</h2>
        <p className="sub">
          {resumes.length} resume{resumes.length === 1 ? '' : 's'}
          {hasFilters && ` · ${shown.length} shown`}
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
          aria-label="Search candidates and screening information"
          placeholder="Name, skill, screening details…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 240 }}
        />
      </div>

      {resumes.length > 0 && (
        <div className="row library-filters" aria-label="Candidate filters">
          <label htmlFor="library-minimum-years">Experience
            <input id="library-minimum-years" type="number" min="0" max="100" step="0.5" placeholder="Min."
              value={minimumYears} onChange={(event) => setMinimumYears(event.target.value)} aria-label="Minimum years of experience" />
            years
          </label>
          <label htmlFor="library-education">Education
            <select id="library-education" value={education} onChange={(event) => setEducation(event.target.value)}>
              <option value="">Any level</option>
              <option value="associate">Associate</option>
              <option value="bachelors">Bachelor’s</option>
              <option value="masters">Master’s</option>
              <option value="phd">PhD</option>
            </select>
          </label>
          <label htmlFor="library-availability">Availability
            <select id="library-availability" value={availability} onChange={(event) => setAvailability(event.target.value)}>
              <option value="">Any</option>
              <option value="recorded">Recorded</option>
              <option value="missing">Not recorded</option>
            </select>
          </label>
          <label><input type="checkbox" checked={withNotes} onChange={(event) => setWithNotes(event.target.checked)} />With screening notes</label>
          {hasFilters && <button className="btn sm" onClick={clearFilters}>Clear filters</button>}
        </div>
      )}

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
              <QumaaMark size={30} />
            </span>
            <p className="empty-title">No resumes yet</p>
            <p className="empty-body">
              Drag PDF, DOCX, or Markdown files anywhere onto this window, or pick them yourself.
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
            <p className="empty-body">No candidates match the current search and filters.</p>
            <div className="row empty-actions">
              <button className="btn" onClick={clearFilters}>
                Clear filters
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
                onClick={() => onOpenResume(resumes.find((original) => original.recordKey === r.recordKey) ?? r)}
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
                    {r.fileName}
                  </div>
                  {profilesByRecord.has(r.recordKey) && <span className="library-profile-badge">Recruiter profile</span>}
                  {(profilesByRecord.get(r.recordKey)?.recordKeys.length ?? 0) > 1 && (
                    <span className="cell-sub"> · {profilesByRecord.get(r.recordKey)?.recordKeys.length} CV versions</span>
                  )}
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
                        onClick={() => window.api.resumes.reveal(r)}
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
