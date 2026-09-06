import { useEffect, useId, useState } from 'react'
import type { EducationLevel, ResumeSummary } from '@shared/types.js'
import { profileForResume, type CandidateProfile, type SaveProfileInput } from '@shared/recruiting.js'
import './recruiter-profile.css'

interface Props {
  resume: ResumeSummary
  onChanged?: () => void
}

interface ProfileDraft {
  name: string
  email: string
  phone: string
  location: string
  yearsExperience: string
  educationLevel: EducationLevel | ''
  skills: string
  expectedSalary: string
  noticePeriod: string
  availability: string
  preferredLocation: string
  tags: string
  note: string
}

function draftFrom(profile?: CandidateProfile): ProfileDraft {
  return {
    name: profile?.name ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? '',
    location: profile?.location ?? '',
    yearsExperience: profile?.yearsExperience?.toString() ?? '',
    educationLevel: profile?.educationLevel ?? '',
    skills: profile?.skills?.join(', ') ?? '',
    expectedSalary: profile?.expectedSalary ?? '',
    noticePeriod: profile?.noticePeriod ?? '',
    availability: profile?.availability ?? '',
    preferredLocation: profile?.preferredLocation ?? '',
    tags: profile?.tags.join(', ') ?? '',
    note: profile?.note ?? ''
  }
}

function list(value: string): string[] {
  return [...new Set(value.split(/[,،\n]/).map((item) => item.trim()).filter(Boolean))]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not update the candidate profile.'
}

export default function RecruiterProfile({ resume, onChanged }: Props): React.JSX.Element {
  const fieldId = useId()
  const [profile, setProfile] = useState<CandidateProfile | undefined>()
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom())
  const [library, setLibrary] = useState<ResumeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [versionQuery, setVersionQuery] = useState('')
  const [versionKey, setVersionKey] = useState('')
  const [loadRevision, setLoadRevision] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadFailed(false)
    setError(null)
    Promise.all([window.api.recruiting.listProfiles(), window.api.resumes.list()])
      .then(([profiles, resumes]) => {
        if (!active) return
        const found = profileForResume(profiles, resume.recordKey)
        setProfile(found)
        setDraft(draftFrom(found))
        setLibrary(resumes)
      })
      .catch((err: unknown) => {
        if (active) {
          setError(errorMessage(err))
          setLoadFailed(true)
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [resume.recordKey, loadRevision])

  const update = <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setNotice(null)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const input: SaveProfileInput = {
        resume,
        name: draft.name.trim() || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        location: draft.location.trim() || null,
        yearsExperience: draft.yearsExperience === '' ? null : Number(draft.yearsExperience),
        educationLevel: draft.educationLevel || null,
        skills: draft.skills.trim() ? list(draft.skills) : null,
        expectedSalary: draft.expectedSalary.trim(),
        noticePeriod: draft.noticePeriod.trim(),
        availability: draft.availability.trim(),
        preferredLocation: draft.preferredLocation.trim(),
        tags: list(draft.tags),
        note: draft.note.trim()
      }
      const saved = await window.api.recruiting.saveProfile(input)
      setProfile(saved)
      setDraft(draftFrom(saved))
      setEditing(false)
      setNotice('Recruiter profile saved.')
      onChanged?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const linkVersion = async (): Promise<void> => {
    const version = library.find((item) => item.recordKey === versionKey)
    if (!version) return
    setBusy(true)
    setError(null)
    try {
      const saved = await window.api.recruiting.linkVersions({ primary: resume, version })
      setProfile(saved)
      setDraft(draftFrom(saved))
      setLinking(false)
      setVersionKey('')
      setVersionQuery('')
      setNotice('Resume versions linked to the same candidate.')
      onChanged?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const unlinkVersion = async (version: ResumeSummary): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.recruiting.unlinkVersion({ resume: version })
      const profiles = await window.api.recruiting.listProfiles()
      const found = profileForResume(profiles, resume.recordKey)
      setProfile(found)
      setDraft(draftFrom(found))
      setNotice('This resume is now a separate candidate.')
      onChanged?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const recordKeys = profile?.recordKeys ?? [resume.recordKey]
  const versions = library.filter((item) => recordKeys.includes(item.recordKey))
    .sort((a, b) => b.importedAt - a.importedAt)
  const query = versionQuery.trim().toLocaleLowerCase()
  const availableVersions = library.filter((item) => !recordKeys.includes(item.recordKey)
    && (!query || [item.name, item.fileName, item.email].some((value) => value?.toLocaleLowerCase().includes(query))))
  const selectedVersion = library.find((item) => item.recordKey === versionKey)
  const confirmedFields: Array<[string, string | null | undefined]> = [
    ['Name', profile?.name], ['Email', profile?.email], ['Phone', profile?.phone],
    ['Location', profile?.location],
    ['Experience', profile?.yearsExperience === null || profile?.yearsExperience === undefined ? null : `${profile.yearsExperience} years`],
    ['Education', profile?.educationLevel], ['Skills', profile?.skills?.join(', ')],
    ['Expected salary', profile?.expectedSalary], ['Notice period', profile?.noticePeriod],
    ['Availability', profile?.availability], ['Preferred location', profile?.preferredLocation]
  ]

  return (
    <section className="recruiter-profile" aria-labelledby={`${fieldId}-heading`}>
      <div className="row recruiter-section-head">
        <h3 id={`${fieldId}-heading`}>Recruiter profile</h3>
        {!loading && !loadFailed && !editing && (
          <button className="btn sm" disabled={busy} onClick={() => { setEditing(true); setLinking(false); setNotice(null) }}>
            {profile ? 'Edit profile' : 'Add details'}
          </button>
        )}
      </div>
      <p className="recruiter-help">Confirmed details and screening notes follow this candidate across jobs.</p>
      {error && (
        <div className="recruiter-message error" role="alert">
          {error}
          {loadFailed && (
            <button className="btn sm" onClick={() => setLoadRevision((value) => value + 1)}>Retry</button>
          )}
        </div>
      )}
      {notice && <p className="recruiter-message success" role="status">{notice}</p>}
      {loading ? <p className="muted">Loading candidate history…</p> : loadFailed ? null : editing ? (
        <form className="recruiter-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <fieldset disabled={busy}>
            <legend>Correct or confirm CV details</legend>
            <p className="recruiter-help">Leave a field blank to use the CV extraction shown below. The original CV stays available.</p>
            <div className="recruiter-fields">
              {([
                ['name', 'Name', resume.name], ['email', 'Email', resume.email],
                ['phone', 'Phone', resume.phone], ['location', 'Location', resume.location]
              ] as const).map(([key, label, extracted]) => (
                <label key={key} htmlFor={`${fieldId}-${key}`}>
                  {label}
                  <input id={`${fieldId}-${key}`} type="text" dir="auto" value={draft[key]}
                    placeholder={extracted ? `CV: ${extracted}` : 'Not stated in CV'} onChange={(event) => update(key, event.target.value)} />
                </label>
              ))}
              <label htmlFor={`${fieldId}-experience`}>
                Years of experience
                <input id={`${fieldId}-experience`} type="number" min="0" max="100" step="0.5"
                  value={draft.yearsExperience} placeholder={resume.yearsExperience === null ? 'Not stated in CV' : `CV: ${resume.yearsExperience}`}
                  onChange={(event) => update('yearsExperience', event.target.value)} />
              </label>
              <label htmlFor={`${fieldId}-education`}>
                Education
                <select id={`${fieldId}-education`} value={draft.educationLevel} onChange={(event) => update('educationLevel', event.target.value as EducationLevel | '')}>
                  <option value="">Use CV extraction</option>
                  <option value="associate">Associate</option>
                  <option value="bachelors">Bachelor’s</option>
                  <option value="masters">Master’s</option>
                  <option value="phd">PhD</option>
                </select>
              </label>
              <label className="recruiter-field-wide" htmlFor={`${fieldId}-skills`}>
                Confirmed skills
                <input id={`${fieldId}-skills`} type="text" dir="auto" value={draft.skills}
                  placeholder="Comma-separated; blank uses CV skills" onChange={(event) => update('skills', event.target.value)} />
              </label>
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Screening information</legend>
            <div className="recruiter-fields">
              {([
                ['expectedSalary', 'Expected salary', 'e.g. SAR 15,000 / month'],
                ['noticePeriod', 'Notice period', 'e.g. 30 days'],
                ['availability', 'Availability', 'e.g. Available from October'],
                ['preferredLocation', 'Preferred location', 'e.g. Riyadh or remote']
              ] as const).map(([key, label, placeholder]) => (
                <label key={key} htmlFor={`${fieldId}-${key}`}>
                  {label}
                  <input id={`${fieldId}-${key}`} type="text" dir="auto" value={draft[key]}
                    placeholder={placeholder} onChange={(event) => update(key, event.target.value)} />
                </label>
              ))}
              <label className="recruiter-field-wide" htmlFor={`${fieldId}-tags`}>
                Tags
                <input id={`${fieldId}-tags`} type="text" dir="auto" value={draft.tags}
                  placeholder="e.g. Finance, Talent pool" onChange={(event) => update('tags', event.target.value)} />
              </label>
              <label className="recruiter-field-wide" htmlFor={`${fieldId}-note`}>
                Screening notes
                <textarea id={`${fieldId}-note`} rows={4} dir="auto" value={draft.note}
                  placeholder="Record confirmed information and follow-up questions" onChange={(event) => update('note', event.target.value)} />
              </label>
            </div>
          </fieldset>
          <div className="row recruiter-actions">
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setDraft(draftFrom(profile)); setEditing(false); setError(null) }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          {confirmedFields.some(([, value]) => value) ? (
            <dl className="fields recruiter-confirmed">
              {confirmedFields.filter(([, value]) => value).map(([label, value]) => (
                <div className="field" key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>
              ))}
            </dl>
          ) : <p className="recruiter-empty">No recruiter-confirmed details yet.</p>}
          {profile?.tags.length ? (
            <div className="chips">{profile.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>
          ) : null}
          {profile?.note && <div className="recruiter-note" dir="auto">{profile.note}</div>}
          {profile && <p className="hint">Last updated {new Date(profile.updatedAt).toLocaleString()}</p>}
        </>
      )}

      {!loading && !loadFailed && !editing && (
        <div className="resume-versions">
          <div className="row recruiter-section-head">
            <h4>Resume history <span className="muted">({versions.length})</span></h4>
            <button className="btn sm" disabled={busy || library.length < 2} onClick={() => { setLinking((value) => !value); setError(null) }}>
              {linking ? 'Cancel linking' : 'Link another CV'}
            </button>
          </div>
          <ul className="version-list">
            {versions.map((version) => (
              <li key={version.recordKey}>
                <div>
                  <span className="version-name" dir="auto">{version.fileName}</span>
                  <span className="version-date">Imported {new Date(version.importedAt).toLocaleDateString()}{version.recordKey === resume.recordKey ? ' · Current resume' : ''}</span>
                </div>
                {version.recordKey !== resume.recordKey && (
                  <button className="btn sm" disabled={busy} aria-label={`Unlink ${version.fileName}`} onClick={() => void unlinkVersion(version)}>Unlink</button>
                )}
              </li>
            ))}
          </ul>
          {versions.length > 1 && <p className="hint">Unlinking keeps a copy of the shared recruiter profile and job reviews with each separate candidate. You can edit them independently afterward.</p>}
          {linking && (
            <div className="version-linker">
              <p className="recruiter-help">Choose an imported CV that belongs to this same person. Both source documents remain in your library.</p>
              <label htmlFor={`${fieldId}-version-filter`}>Find a CV</label>
              <input id={`${fieldId}-version-filter`} type="text" value={versionQuery} placeholder="Search name, email, or filename"
                onChange={(event) => { setVersionQuery(event.target.value); setVersionKey('') }} disabled={busy} />
              <label htmlFor={`${fieldId}-version`}>Resume to link</label>
              <select id={`${fieldId}-version`} value={versionKey} disabled={busy} onChange={(event) => setVersionKey(event.target.value)}>
                <option value="">Select a resume…</option>
                {availableVersions.slice(0, 100).map((version) => (
                  <option value={version.recordKey} key={version.recordKey}>{version.name ?? version.fileName} — {version.fileName}</option>
                ))}
              </select>
              {availableVersions.length === 0 && <p className="hint">No other resumes match this search.</p>}
              {availableVersions.length > 100 && <p className="hint">Showing 100 resumes. Refine the search to find another.</p>}
              {selectedVersion && <p className="recruiter-help">Link <strong>{selectedVersion.name ?? selectedVersion.fileName}</strong> to <strong>{profile?.name ?? resume.name ?? resume.fileName}</strong>.</p>}
              <button className="btn" disabled={busy || !versionKey} onClick={() => void linkVersion()}>{busy ? 'Linking…' : 'Link as same person'}</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
