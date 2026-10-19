import { useLayoutEffect, useMemo, useState } from 'react'
import type { TalentOverview, TalentPool } from '@shared/talent.js'
import { newPoolPeople, peopleInPool } from '@shared/talent.js'
import { useI18n } from '../../i18n.js'
import PoolEditor from './PoolEditor.js'
import TalentConfirm from './TalentConfirm.js'
import type { DeskAction, UpdateOverview } from './desk-types.js'

interface Props {
  data: TalentOverview
  busy: boolean
  run: DeskAction
  update: UpdateOverview
  onLock: (locked: boolean) => void
  onOpenPerson: (id: string) => void
}

export default function TalentPools({ data, busy, run, update, onLock, onOpenPerson }: Props): React.JSX.Element {
  const { t, formatNumber, formatDate } = useI18n()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ pool?: TalentPool } | null>(null)
  const [deleting, setDeleting] = useState<TalentPool | null>(null)
  const [query, setQuery] = useState('')
  const [memberQuery, setMemberQuery] = useState('')
  const [memberId, setMemberId] = useState('')
  const [limit, setLimit] = useState(100)
  const [onlyNew, setOnlyNew] = useState(false)
  const editing = editor !== null || deleting !== null
  const locked = editing || busy
  useLayoutEffect(() => { onLock(editing); return () => onLock(false) }, [editing, onLock])
  const selected = data.pools.find((pool) => pool.id === selectedId)
  const filtered = data.pools.filter((pool) => `${pool.name} ${pool.note}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name))
  const poolStats = useMemo(() => new Map(data.pools.map((pool) => {
    const members = peopleInPool(pool, data.people, data.activities)
    return [pool.id, { members, fresh: newPoolPeople(pool, members) }] as const
  })), [data.pools, data.people, data.activities])
  const members = selected ? poolStats.get(selected.id)?.members ?? [] : []
  const memberIds = new Set(members.map((person) => person.id))
  const newMembers = selected ? poolStats.get(selected.id)?.fresh ?? [] : []
  const newMemberIds = new Set(newMembers.map((person) => person.id))
  const visible = onlyNew ? newMembers : members
  const available = data.people.filter((person) => !memberIds.has(person.id) && `${person.name} ${person.employer} ${person.title}`.toLocaleLowerCase().includes(memberQuery.trim().toLocaleLowerCase()))
  const savePool = (pool: TalentPool): void => update((current) => ({ ...current, pools: [pool, ...current.pools.filter((item) => item.id !== pool.id)] }))
  const setMembers = (personIds: string[]): void => {
    if (!selected || busy) return
    void run(() => window.api.talent.savePool({ id: selected.id, expectedUpdatedAt: selected.updatedAt, name: selected.name, note: selected.note, mode: selected.mode, filters: selected.filters, personIds }), (pool) => { savePool(pool); setMemberId(''); setMemberQuery('') })
  }
  return <div className="talent-layout">
    <aside className="talent-directory" aria-label={t('Talent pool directory')}><div className="talent-directory-head"><p className="talent-eyebrow">{t('Talent pools')}<span>{formatNumber(data.pools.length)}</span></p><label className="sr-only" htmlFor="talent-pool-filter">{t('Search talent pools')}</label><input id="talent-pool-filter" type="search" dir="auto" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search talent pools')} /><button type="button" className="btn primary sm talent-form-actions" disabled={locked} onClick={() => setEditor({})}>{t('+ New talent pool')}</button></div>
      {filtered.length ? <div className="talent-list">{filtered.map((pool) => {
        const people = poolStats.get(pool.id)?.members ?? []
        const fresh = poolStats.get(pool.id)?.fresh.length ?? 0
        return <button type="button" className={`talent-list-item ${pool.id === selectedId ? 'selected' : ''}`} key={pool.id} disabled={locked} aria-label={t('Open talent pool {name}', { name: pool.name })} onClick={() => { setSelectedId(pool.id); setMemberId(''); setMemberQuery(''); setLimit(100); setOnlyNew(false) }}><strong><bdi>{pool.name}</bdi></strong><span>{t(pool.mode === 'manual' ? 'Manual talent pool' : 'Saved search')}</span><span className="talent-list-meta"><span>{t('{count} people', { count: people.length })}</span>{fresh > 0 && <span className="talent-new">{t('{count} new', { count: fresh })}</span>}</span></button>
      })}</div> : <p className="talent-inline-empty">{t('No talent pools yet.')}</p>}
    </aside>
    <section className="talent-panel" aria-label={t('Talent pool workspace')}>
      {editor ? <PoolEditor key={editor.pool?.id ?? 'new'} pool={editor.pool} data={data} busy={busy} onCancel={() => setEditor(null)} onSave={(input) => run(() => window.api.talent.savePool(input), (pool) => { savePool(pool); setSelectedId(pool.id); setEditor(null); setOnlyNew(false); setQuery('') })} /> : selected ? <>
        <header className="talent-panel-head"><div><span className={`pill ${selected.mode === 'manual' ? 'violet' : 'teal'}`}>{t(selected.mode === 'manual' ? 'Manual talent pool' : 'Saved search')}</span><h3><bdi>{selected.name}</bdi></h3><p className="hint">{t('{count} people', { count: members.length })} · {t('{count} new since last review', { count: newMembers.length })}</p></div><button type="button" className="btn sm" disabled={busy} onClick={() => setEditor({ pool: selected })}>{t('Edit talent pool')}</button></header>
        <div className="talent-panel-body">{selected.note && <p className="talent-pool-description" dir="auto">{selected.note}</p>}<div className="talent-section-head"><p className="hint">{selected.lastReviewedAt === null ? t('Not reviewed yet') : t('Last reviewed {date}', { date: formatDate(selected.lastReviewedAt, { year: 'numeric', month: 'short', day: 'numeric' }) })}</p><button type="button" className="btn sm" disabled={busy} onClick={() => { void run(() => window.api.talent.reviewPool({ id: selected.id, expectedUpdatedAt: selected.updatedAt }), (pool) => { savePool(pool); setOnlyNew(false) }) }}>{t('Mark reviewed')}</button></div>
          {selected.mode === 'search' && <p className="hint">{t('This saved search updates automatically as contacts and their activity change.')}</p>}
          {selected.mode === 'manual' && <div className="talent-form-grid"><label className="talent-field talent-wide">{t('Find a person to add')}<input aria-label={t('Find a person to add')} dir="auto" value={memberQuery} disabled={busy} onChange={(event) => { setMemberQuery(event.target.value); setMemberId('') }} /></label><label className="talent-field">{t('Pool member')}<select aria-label={t('Pool member')} value={memberId} disabled={busy} onChange={(event) => setMemberId(event.target.value)}><option value="">{t('Choose a person')}</option>{available.map((person) => <option key={person.id} value={person.id}>{person.name}{person.employer ? ` · ${person.employer}` : ''}</option>)}</select></label><div className="talent-actions"><button type="button" className="btn sm" disabled={busy || !available.some((person) => person.id === memberId)} onClick={() => setMembers([...selected.members.map((member) => member.personId), memberId])}>{t('Add member')}</button></div></div>}
        </div>
        <section className="talent-panel-body"><div className="talent-section-head"><h4>{t('Pool members')}</h4><label className="row hint"><input type="checkbox" checked={onlyNew} onChange={(event) => { setOnlyNew(event.target.checked); setLimit(100) }} />{t('New since last review')}</label></div>
          {visible.length ? visible.slice(0, limit).map((person) => <article className="talent-member" key={person.id}><div><strong><button type="button" className="talent-text-button" disabled={busy} onClick={() => onOpenPerson(person.id)}><bdi>{person.name}</bdi></button>{newMemberIds.has(person.id) && <span className="talent-new">{t('New')}</span>}</strong><p className="hint" dir="auto">{[person.title, person.employer, person.location].filter(Boolean).join(' · ')}</p></div>{selected.mode === 'manual' && <button type="button" className="btn sm" aria-label={t('Remove {name} from pool', { name: person.name })} disabled={busy} onClick={() => setMembers(selected.members.filter((member) => member.personId !== person.id).map((member) => member.personId))}>{t('Remove')}</button>}</article>) : <p className="hint">{t(onlyNew ? 'No new people since the last review.' : 'No people in this pool yet.')}</p>}
          {visible.length > limit && <button type="button" className="talent-text-button talent-form-actions" onClick={() => setLimit((value) => value + 100)}>{t('Show more people')}</button>}
          <div className="talent-danger-zone"><button type="button" className="talent-text-button" disabled={busy} onClick={() => setDeleting(selected)}>{t('Delete talent pool')}</button></div>
        </section>
      </> : <div className="talent-empty"><h3>{t('Keep a warm talent pool')}</h3><button type="button" className="btn primary" disabled={busy} onClick={() => setEditor({})}>{t('Create your first talent pool')}</button></div>}
    </section>
    {deleting && <TalentConfirm title={t('Delete this talent pool?')} confirmLabel={t('Delete talent pool')} destructive busy={busy} onCancel={() => setDeleting(null)} onConfirm={() => { const pool = deleting; void run(() => window.api.talent.deletePool({ id: pool.id, expectedUpdatedAt: pool.updatedAt }), () => { update((current) => ({ ...current, pools: current.pools.filter((item) => item.id !== pool.id) })); setDeleting(null); setSelectedId(null) }) }}><p>{t('Only the pool is removed. Its people, CVs, and recruiting history are retained.')}</p><p dir="auto"><strong>{deleting.name}</strong></p></TalentConfirm>}
  </div>
}
