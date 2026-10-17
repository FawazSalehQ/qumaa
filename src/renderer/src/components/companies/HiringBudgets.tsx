import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { calculateHiringCosts, hiringCostInputsSchema, type HiringCostInputs, type HiringCostResult, type GosiScheme } from '@shared/hiring-costs.js'
import { parseHiringHundredths as hundredths, hiringDecimal, formatHiringMoney } from '@shared/hiring-money.js'
import type { SavedHiringBudget } from '@shared/hiring-budget.js'
import type { SavedJob } from '@shared/recruiting.js'
import { displayError } from '@shared/i18n.js'
import { useI18n } from '../../i18n.js'
import { jobPostingTitle } from '../../jobPosting.js'
import LocalizedNumberInput from '../LocalizedNumberInput.js'
import DisclosureSummary from '../DisclosureSummary.js'
import './hiring-budgets.css'

interface Props { companyId: string; jobs: SavedJob[]; onLockChange: (locked: boolean) => void }
interface Draft {
  name: string; jobId: string; eligible: boolean; mode: 'components' | 'combined'; scheme: HiringCostInputs['scheme']
  basic: string; housing: string; combined: string; basicPercent: string; housingPercent: string; transport: string
  selectedMonth: string; periodStart: string; periodEnd: string; employmentStartMonth: string
  service: string; headcount: string; approved: string; minimum: string; maximum: string; limitNote: string
  override: boolean; registered: string; registeredNote: string; eos: HiringCostInputs['eos']; notes: string
}
function decimal(value: number): string { return hiringDecimal(value).replace(/\.00$/, '') }
function freshDraft(): Draft {
  const now = new Date(); const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const end = new Date(now.getFullYear(), now.getMonth() + 11, 1)
  return { name: '', jobId: '', eligible: false, mode: 'components', scheme: 'compare', basic: '', housing: '', combined: '', basicPercent: '75', housingPercent: '25', transport: '', selectedMonth: month, periodStart: month, periodEnd: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`, employmentStartMonth: month, service: '0', headcount: '1', approved: '', minimum: '1500', maximum: '45000', limitNote: '', override: false, registered: '', registeredNote: '', eos: { includeBasic: true, includeHousing: true, includeTransport: true }, notes: '' }
}
function editDraft(plan: SavedHiringBudget): Draft {
  const i = plan.inputs
  return { name: plan.name, jobId: plan.jobId ?? '', eligible: true, mode: i.salary.mode, scheme: i.scheme, basic: decimal(i.salary.basicHalala), housing: decimal(i.salary.housingHalala), combined: decimal(i.salary.combinedHalala), basicPercent: decimal(i.salary.basicPercentBps), housingPercent: decimal(i.salary.housingPercentBps), transport: decimal(i.salary.transportHalala), selectedMonth: i.selectedMonth, periodStart: i.periodStart, periodEnd: i.periodEnd, employmentStartMonth: i.employmentStartMonth, service: String(i.serviceMonthsAtStart), headcount: String(i.headcount), approved: i.approvedBudgetHalala === null ? '' : decimal(i.approvedBudgetHalala), minimum: decimal(i.gosi.minimumWageHalala), maximum: decimal(i.gosi.maximumWageHalala), limitNote: i.gosi.limitNote, override: i.gosi.registeredWageHalala !== null, registered: i.gosi.registeredWageHalala === null ? '' : decimal(i.gosi.registeredWageHalala), registeredNote: i.gosi.registeredWageNote, eos: { ...i.eos }, notes: i.notes }
}
function draftInputs(d: Draft): HiringCostInputs {
  if (!d.eligible) throw new Error('Confirm eligible Saudi private-sector coverage before calculating.')
  if (!d.headcount || !d.service) throw new Error('Enter headcount and completed service months.')
  const parsed = hiringCostInputsSchema.safeParse({
    eligibleSaudiPrivateSector: true,
    salary: { mode: d.mode, basicHalala: d.mode === 'components' ? hundredths(d.basic) : 0, housingHalala: d.mode === 'components' ? hundredths(d.housing) : 0, combinedHalala: d.mode === 'combined' ? hundredths(d.combined) : 0, basicPercentBps: d.mode === 'combined' ? hundredths(d.basicPercent) : 7500, housingPercentBps: d.mode === 'combined' ? hundredths(d.housingPercent) : 2500, transportHalala: hundredths(d.transport) },
    scheme: d.scheme, selectedMonth: d.selectedMonth, periodStart: d.periodStart, periodEnd: d.periodEnd, employmentStartMonth: d.employmentStartMonth, serviceMonthsAtStart: Number(d.service), headcount: Number(d.headcount), approvedBudgetHalala: d.approved === '' ? null : hundredths(d.approved),
    gosi: { minimumWageHalala: hundredths(d.minimum), maximumWageHalala: hundredths(d.maximum), limitNote: d.limitNote, registeredWageHalala: d.override ? hundredths(d.registered) : null, registeredWageNote: d.override ? d.registeredNote : '' }, eos: d.eos, notes: d.notes
  })
  if (!parsed.success) throw new Error(parsed.error.issues[0].message)
  return parsed.data
}
const schemeLabel = (scheme: GosiScheme): string => scheme === 'existing' ? 'Existing GOSI scheme' : 'New GOSI scheme'

function CostPreview({ result }: { result: HiringCostResult }): React.JSX.Element {
  const { t, formatNumber, locale } = useI18n()
  const money = (value: number): string => `${formatHiringMoney(value, locale)} ${t('SAR')}`
  const percent = (value: number): string => `${formatNumber(value / 100, { maximumFractionDigits: 2 })}%`
  const row = (label: string, value: number, key = label): React.JSX.Element => <div key={key}><dt>{t(label)}</dt><dd><bdi>{money(value)}</bdi></dd></div>
  return <div className="hiring-cost-preview">
    <h4>{t('Salary and contribution bases')}</h4>
    <dl className="hiring-cost-values hiring-cost-bases">
      {row('Basic salary', result.salary.basicHalala)}{row('Housing allowance', result.salary.housingHalala)}{row('Fixed transport allowance', result.salary.transportHalala)}{row('Gross monthly salary', result.salary.grossHalala)}{row('Basic + housing before GOSI ceiling', result.salary.gosiBaseHalala)}{row('GOSI contribution wage', result.salary.gosiWageHalala)}{row('EOS eligible monthly wage', result.salary.eosWageHalala)}
    </dl>
    <p className="hint">{t(result.salary.gosiWageSource === 'registered' ? 'Using the verified registered GOSI wage override.' : 'GOSI uses basic plus housing; fixed transport is excluded.')}{result.salary.gosiCeilingApplied && ` ${t('The configured GOSI ceiling has been applied only to the contribution wage.')}`}</p>
    <h4 className="hiring-cost-heading">{t('Selected-month estimate')} · <bdi>{result.selectedMonth.month}</bdi></h4>
    <div className="hiring-scenarios">{result.selectedMonth.scenarios.map((scenario) => <section className="hiring-scenario" data-scheme={scenario.scheme} data-testid={`hiring-month-${scenario.scheme}`} key={scenario.scheme} aria-label={t(schemeLabel(scenario.scheme))}>
      <h5>{t(schemeLabel(scenario.scheme))}</h5>
      {!scenario.available ? <p className="hint">{t('The new scheme is unavailable before August 2024 in this full-month planner. July 2024 requires partial-month handling.')}</p> : <>
        <p className="hiring-rate-date">{scenario.rates.effectiveDate ? t('Rate effective {date}', { date: `\u2066${scenario.rates.effectiveDate}\u2069` }) : t('Existing-scheme planning rates')}</p>
        <dl className="hiring-cost-values">
          <div><dt>{t('Employee GOSI rate')}</dt><dd>{percent(scenario.rates.employeeTotalBps)}</dd></div>
          <div><dt>{t('Employer GOSI rate')}</dt><dd>{percent(scenario.rates.employerTotalBps)}</dd></div>
          {row('Employee GOSI deduction', scenario.employeeGosiHalala)}{row('Estimated take-home pay', scenario.takeHomeHalala)}{row('Employer GOSI contribution', scenario.employerGosiHalala)}{row('Estimated end-of-service provision', scenario.eosProvisionHalala)}
          <div><dt>{t('EOS provision basis')}</dt><dd>{t('Eligible wage / {divisor}', { divisor: scenario.eosDivisor })}</dd></div>
          {row('Budgeted employment cost — excluding medical insurance', scenario.employerCostHalala)}
          {row('Monthly cost for planned headcount', scenario.headcountEmployerCostHalala)}
          {row('Selected-month annualised cost per employee', scenario.annualizedEmployerCostHalala)}
          {row('Selected-month annualised cost for headcount', scenario.annualizedHeadcountEmployerCostHalala)}
        </dl>
        {scenario.takeHomeHalala < 0 && <p className="hint">{t('The registered-wage deduction exceeds the entered gross salary. Review the salary and verified wage inputs.')}</p>}
        <p className="hint">{t('Pension {pension}% + SANED 0.75% per party; employer also pays 2% occupational hazards.', { pension: formatNumber(scenario.rates.employeePensionBps / 100) })}</p>
      </>}
    </section>)}</div>
    <h4 className="hiring-cost-heading">{t('Actual-period forecast')} · <bdi>{result.forecast.periodStart} – {result.forecast.periodEnd}</bdi></h4>
    <p className="hint">{t('{months} active full months · {headcount} planned employees', { months: result.forecast.activeMonths, headcount: result.inputs.headcount })}</p>
    <div className="hiring-scenarios">{result.forecast.scenarios.map((scenario) => <section className="hiring-scenario" data-forecast-scheme={scenario.scheme} data-testid={`hiring-forecast-${scenario.scheme}`} key={scenario.scheme}>
      <h5>{t(schemeLabel(scenario.scheme))}</h5>
      {scenario.available ? <dl className="hiring-cost-values">
        {row('Period cost per employee', scenario.perPersonTotalHalala)}{row('Combined period employment cost', scenario.totalHalala)}
        {result.inputs.approvedBudgetHalala !== null && row('Approved period budget', result.inputs.approvedBudgetHalala)}
        {scenario.budgetVarianceHalala !== null && row(scenario.budgetVarianceHalala >= 0 ? 'Budget remaining' : 'Budget exceeded by', Math.abs(scenario.budgetVarianceHalala))}
      </dl> : <p className="hint">{t('This forecast includes an active month before the new scheme is supported. No complete total is shown.')}</p>}
      <details className="disclosure hiring-monthly"><DisclosureSummary>{t('Month-by-month calculation')}</DisclosureSummary><div className="hiring-table-scroll"><table><thead><tr><th>{t('Month')}</th><th>{t('Employee / employer rate')}</th><th>{t('EOS provision per employee')}</th><th>{t('Headcount cost')}</th></tr></thead><tbody>{scenario.months.map((month) => <tr key={month.month}><th scope="row"><bdi>{month.month}</bdi></th>{!month.active ? <td colSpan={3}>{t('Before employment · zero cost')}</td> : !month.available ? <td colSpan={3}>{t('New-scheme rate unavailable')}</td> : <><td><bdi>{percent(month.rates.employeeTotalBps)} / {percent(month.rates.employerTotalBps)}</bdi></td><td><bdi>{money(month.eosProvisionHalala)}</bdi></td><td><bdi>{money(month.headcountEmployerCostHalala)}</bdi></td></>}</tr>)}</tbody></table></div></details>
    </section>)}</div>
    <details className="disclosure hiring-assumptions"><DisclosureSummary>{t('Calculation assumptions and sources')}</DisclosureSummary><ul>{result.assumptions.map((assumption) => <li key={assumption}>{assumption.startsWith('Verified registered GOSI wage override: ') ? t('Verified registered GOSI wage override: {note}', { note: result.inputs.gosi.registeredWageNote }) : assumption.startsWith('Configured contribution-wage limits: ') ? t('Configured contribution-wage limits: {note}', { note: result.inputs.gosi.limitNote }) : t(assumption)}</li>)}</ul><p>{t('GOSI: new-system employer guidance and contributor FAQ. HRSD: end-of-service award regulations. The SAR 1,500 minimum is the published pension minimum; verify the applicable limit for the employee’s classification.')}</p><p dir="ltr" className="hiring-source">awareness.gosi.gov.sa/businessJourney.html<br />www.gosi.gov.sa/GOSIOnline/FAQ_Contributor<br />www.hrsd.gov.sa/en/knowledge-centre/articles/317</p></details>
  </div>
}

export default function HiringBudgets({ companyId, jobs, onLockChange }: Props): React.JSX.Element {
  const { t, language } = useI18n()
  const [plans, setPlans] = useState<SavedHiringBudget[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editing, setEditing] = useState<SavedHiringBudget | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const selected = plans.find((plan) => plan.id === selectedId) ?? null
  useLayoutEffect(() => { onLockChange(draft !== null || busy); return () => onLockChange(false) }, [draft !== null, busy, onLockChange])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setFailed(false)
    void window.api.hiringBudgets.list(companyId).then((items) => {
      if (cancelled) return
      setPlans(items); setSelectedId((id) => items.some((p) => p.id === id) ? id : items[0]?.id ?? null); setError(null)
    }).catch((failure: unknown) => { if (!cancelled) { setError(displayError(language, failure, 'Could not load hiring budget plans.')); setFailed(true) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companyId, revision, language])
  useEffect(() => { if (draft) nameRef.current?.focus() }, [draft !== null])
  const preview = useMemo((): { result: HiringCostResult | null; error: string | null } => {
    try { return { result: draft ? calculateHiringCosts(draftInputs(draft)) : selected ? calculateHiringCosts(selected.inputs) : null, error: null } }
    catch (failure) { return { result: null, error: displayError(language, failure, 'Review the budget inputs.') } }
  }, [draft, selected, language])
  const change = <K extends keyof Draft>(key: K, value: Draft[K]): void => { setDraft((current) => current ? { ...current, [key]: value } : null); setError(null) }
  const begin = (plan: SavedHiringBudget | null): void => { setEditing(plan); setDraft(plan ? editDraft(plan) : freshDraft()); setAttempted(false); setError(null); setStatus(null); setConfirmDelete(false) }
  const save = async (): Promise<void> => {
    setAttempted(true)
    if (!draft || busyRef.current || !draft.name.trim() || !preview.result) return
    busyRef.current = true; setBusy(true); setError(null)
    try {
      const plan = await window.api.hiringBudgets.save({ ...(editing ? { id: editing.id, expectedUpdatedAt: editing.updatedAt } : {}), companyId, name: draft.name.trim(), jobId: draft.jobId || null, inputs: preview.result.inputs })
      setPlans((current) => [...current.filter((p) => p.id !== plan.id), plan]); setSelectedId(plan.id); setDraft(null); setEditing(null); setStatus(t('Budget plan saved'))
    } catch (failure) { setError(displayError(language, failure, 'Could not save hiring budget plan.')) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const action = async (kind: 'remove' | 'export'): Promise<void> => {
    if (!selected || busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null); setStatus(null)
    try {
      const version = { id: selected.id, expectedUpdatedAt: selected.updatedAt }
      if (kind === 'remove') { await window.api.hiringBudgets.remove(version); setPlans((current) => current.filter((p) => p.id !== selected.id)); setSelectedId(null); setConfirmDelete(false); setStatus(t('Budget plan deleted')) }
      else { const path = await window.api.hiringBudgets.exportCsv(version); if (path) setStatus(t('Budget CSV exported')) }
    } catch (failure) { setError(displayError(language, failure, 'Could not complete the budget action.')) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const number = (key: 'basic' | 'housing' | 'combined' | 'transport' | 'basicPercent' | 'housingPercent' | 'service' | 'headcount' | 'approved' | 'minimum' | 'maximum' | 'registered', label: string, optional = false, integer = false): React.JSX.Element => <label className="company-field">{t(label)}<LocalizedNumberInput value={draft![key]} onChangeValue={(value) => change(key, value)} required={!optional} min={key === 'headcount' ? 1 : 0} step={integer ? 1 : 0.01} /></label>
  const month = (key: 'selectedMonth' | 'periodStart' | 'periodEnd' | 'employmentStartMonth', label: string): React.JSX.Element => <label className="company-field">{t(label)}<input type="month" required min={key === 'employmentStartMonth' ? '1900-01' : '2024-01'} max={key === 'employmentStartMonth' ? '2199-12' : '2100-12'} value={draft![key]} onChange={(event) => change(key, event.target.value)} /></label>
  return <section className="hiring-budgets" aria-label={t('Hiring Budgets & Costs')} aria-busy={busy || loading}>
    <header className="company-section-head"><div><h4>{t('Hiring Budgets & Costs')}</h4><p className="hint">{t('All amounts in SAR.')}</p></div><button className="btn primary sm" type="button" disabled={loading || failed || !!draft || busy} onClick={() => begin(null)}>{t('+ New budget plan')}</button></header>
    <div className="hiring-budget-body">
      {error && <div role="alert" className="company-error">{error}{!draft && <button className="btn sm" type="button" disabled={busy} onClick={() => setRevision((v) => v + 1)}>{t('Refresh')}</button>}</div>}
      {status && <p className="hint" role="status">{status}</p>}
      {loading ? <p className="hint">{t('Loading budget plans…')}</p> : !draft && <>
        {plans.length ? <label className="company-field">{t('Saved budget plan')}<select aria-label={t('Saved budget plan')} value={selectedId ?? ''} disabled={busy} onChange={(event) => { setSelectedId(event.target.value); setConfirmDelete(false); setStatus(null) }}><option value="" disabled>{t('Choose a budget plan')}</option>{plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}</select></label> : !failed && <p className="hint">{t('No budget plans yet.')}</p>}
        {selected && <div className="hiring-plan-head"><div><h4><bdi>{selected.name}</bdi></h4><p className="hint">{t('Linked job')}: <bdi>{selected.jobId ? (jobs.find((j) => j.id === selected.jobId) ? jobPostingTitle(jobs.find((j) => j.id === selected.jobId)!.posting) : t('Linked job')) : t('Company-wide plan')}</bdi></p></div><div className="hiring-actions"><button className="btn sm" disabled={busy} onClick={() => begin(selected)}>{t('Edit budget plan')}</button><button className="btn sm" disabled={busy} onClick={() => void action('export')}>{t('Export budget CSV')}</button><button className="btn sm" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('Delete budget plan')}</button></div></div>}
        {confirmDelete && <div className="hiring-delete" role="alert"><p>{t('Delete this saved budget plan? Company and job records will remain.')}</p><button className="btn danger sm" disabled={busy} onClick={() => void action('remove')}>{t('Confirm delete budget plan')}</button> <button className="btn sm" disabled={busy} onClick={() => setConfirmDelete(false)}>{t('Cancel')}</button></div>}
      </>}
      {draft && <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        <fieldset className="hiring-form" disabled={busy}><legend>{t(editing ? 'Edit budget plan' : 'New budget plan')}</legend>
          <div className="hiring-form-grid"><label className="company-field">{t('Budget plan name')}<input ref={nameRef} required maxLength={512} dir="auto" value={draft.name} onChange={(event) => change('name', event.target.value)} /></label><label className="company-field">{t('Linked job')}<select aria-label={t('Linked job')} value={draft.jobId} onChange={(event) => change('jobId', event.target.value)}><option value="">{t('Company-wide plan')}</option>{jobs.map((job) => <option key={job.id} value={job.id}>{jobPostingTitle(job.posting)}</option>)}</select></label></div>
          <label className="hiring-check"><input type="checkbox" checked={draft.eligible} onChange={(event) => change('eligible', event.target.checked)} />{t('I confirm this plan is for eligible Saudi private-sector employees')}</label>
          <div className="hiring-form-grid"><label className="company-field">{t('GOSI scheme')}<select aria-label={t('GOSI scheme')} value={draft.scheme} onChange={(event) => change('scheme', event.target.value as Draft['scheme'])}><option value="compare">{t('Unknown — compare both schemes')}</option><option value="existing">{t('Existing GOSI scheme')}</option><option value="new">{t('New GOSI scheme')}</option></select></label><label className="company-field">{t('Salary input')}<select aria-label={t('Salary input')} value={draft.mode} onChange={(event) => change('mode', event.target.value as Draft['mode'])}><option value="components">{t('Enter basic and housing separately')}</option><option value="combined">{t('Split a combined basic + housing amount')}</option></select></label>
          {draft.mode === 'components' ? <>{number('basic', 'Basic salary (SAR / month)')}{number('housing', 'Housing allowance (SAR / month)')}</> : <>{number('combined', 'Combined basic + housing (SAR / month)')}{number('basicPercent', 'Basic share (%)')}{number('housingPercent', 'Housing share (%)')}<div className="company-field"><button className="btn sm" type="button" onClick={() => setDraft({ ...draft, basicPercent: '75', housingPercent: '25' })}>{t('Use 75% / 25% split')}</button></div></>}
          {number('transport', 'Fixed transport allowance (SAR / month)')}
          </div><p className="hint">{t('Medical insurance is not included.')}</p>
          <h4 className="hiring-cost-heading">{t('Headcount and forecast period')}</h4><div className="hiring-form-grid">
            {month('selectedMonth', 'Selected budget month')}{month('employmentStartMonth', 'Employment start month')}{month('periodStart', 'Forecast start month')}{month('periodEnd', 'Forecast end month')}{number('service', 'Completed service months at start', false, true)}{number('headcount', 'Planned headcount', false, true)}{number('approved', 'Approved period budget (SAR)', true)}
          </div><p className="hint">{t('Full months only. Enter service already completed before the start month.')}</p><p className="hint">{t('Separate from job salary ranges and hiring budgets.')}</p>
          <details className="disclosure hiring-advanced"><DisclosureSummary>{t('GOSI wage settings and verified override')}</DisclosureSummary><div className="hiring-form-grid">{number('minimum', 'Minimum GOSI wage (SAR)')}{number('maximum', 'Maximum GOSI wage (SAR)')}<label className="company-field company-field-wide">{t('Basis for changed GOSI limits')}<textarea maxLength={10000} dir="auto" rows={2} value={draft.limitNote} onChange={(event) => change('limitNote', event.target.value)} /></label></div>
            <label className="hiring-check"><input type="checkbox" checked={draft.override} onChange={(event) => change('override', event.target.checked)} />{t('Use a separately verified registered GOSI wage')}</label>{draft.override && <div className="hiring-form-grid">{number('registered', 'Verified registered GOSI wage (SAR)')}<label className="company-field">{t('Registered wage verification and reason')}<textarea required maxLength={10000} dir="auto" rows={2} value={draft.registeredNote} onChange={(event) => change('registeredNote', event.target.value)} /></label></div>}
          </details>
          <details className="disclosure hiring-advanced"><DisclosureSummary>{t('End-of-service eligible components')}</DisclosureSummary><div className="hiring-eos-checks">{([['includeBasic', 'Include basic salary'], ['includeHousing', 'Include housing allowance'], ['includeTransport', 'Include fixed transport allowance']] as const).map(([key, label]) => <label className="hiring-check" key={key}><input type="checkbox" checked={draft.eos[key]} onChange={(event) => change('eos', { ...draft.eos, [key]: event.target.checked })} />{t(label)}</label>)}</div><p className="hint">{t('EOS provision: eligible wage / 24 for the first five years, then / 12.')}</p></details>
          <label className="company-field hiring-notes">{t('Budget assumptions and notes')}<textarea maxLength={10000} dir="auto" rows={3} value={draft.notes} onChange={(event) => change('notes', event.target.value)} /></label>
        </fieldset>
        <p className="company-edit-notice">{t('Save or cancel the budget plan before leaving this company.')}</p>
        {preview.error && <p className={attempted ? 'company-error' : 'hint'} role={attempted ? 'alert' : 'status'}>{preview.error}</p>}
        <div className="hiring-actions"><button type="submit" className="btn primary" disabled={busy}>{t(busy ? 'Saving…' : 'Save budget plan')}</button><button type="button" className="btn" disabled={busy} onClick={() => { setDraft(null); setEditing(null); setError(null) }}>{t('Cancel')}</button></div>
      </form>}
      {preview.result && <CostPreview result={preview.result} />}
      {!draft && selected?.inputs.notes && <div className="hiring-notes"><h4>{t('Budget assumptions and notes')}</h4><p dir="auto">{selected.inputs.notes}</p></div>}
    </div>
  </section>
}
