import type { JobBudget, JobHiringBudget } from '@shared/recruiting.js'
import type { Translator } from '@shared/i18n.js'
import { useI18n } from '../../i18n.js'
import LocalizedNumberInput from '../LocalizedNumberInput.js'

const CURRENCY_CODES = ['SAR', 'USD', 'EUR', 'AED', 'GBP', 'QAR', 'KWD', 'BHD', 'OMR', 'EGP']

export interface HiringBudgetDraft {
  enabled: boolean
  min: string
  max: string
  currency: string
}

export interface BudgetDraft extends HiringBudgetDraft {
  period: JobBudget['period']
}

export const budgetToDraft = (budget?: JobBudget | null): BudgetDraft => ({
  enabled: !!budget, min: budget ? String(budget.min) : '', max: budget ? String(budget.max) : '',
  currency: budget?.currency ?? 'SAR', period: budget?.period ?? 'monthly'
})

export const budgetFromDraft = (draft: BudgetDraft): JobBudget | null => draft.enabled
  ? { min: Number(draft.min), max: Number(draft.max), currency: draft.currency, period: draft.period }
  : null

export const hiringBudgetToDraft = (budget?: JobHiringBudget | null): HiringBudgetDraft => ({
  enabled: !!budget, min: budget ? String(budget.min) : '', max: budget ? String(budget.max) : '', currency: budget?.currency ?? 'SAR'
})

export const hiringBudgetFromDraft = (draft: HiringBudgetDraft): JobHiringBudget | null => draft.enabled
  ? { min: Number(draft.min), max: Number(draft.max), currency: draft.currency }
  : null

export function hiringBudgetLabel(budget: JobHiringBudget, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string, t: Translator): string {
  return t('{min}–{max} {currency}', {
    min: formatNumber(budget.min, { maximumFractionDigits: 2 }), max: formatNumber(budget.max, { maximumFractionDigits: 2 }), currency: budget.currency
  })
}

export function budgetLabel(budget: JobBudget, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string, t: Translator): string {
  return t('{min}–{max} {currency} / {period}', {
    min: formatNumber(budget.min, { maximumFractionDigits: 2 }),
    max: formatNumber(budget.max, { maximumFractionDigits: 2 }), currency: budget.currency,
    period: t(budget.period === 'monthly' ? 'month' : budget.period === 'annual' ? 'year' : 'hour')
  })
}

export default function JobBudgetEditor({ value, onChange }: { value: BudgetDraft; onChange: (value: BudgetDraft) => void }): React.JSX.Element {
  const { t } = useI18n()
  return <div className="recruit-budget-editor">
    <label className="recruit-budget-toggle"><input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />{t('Set salary budget')}</label>
    {value.enabled ? <div className="recruit-budget-fields">
      <label className="recruit-field">{t('Minimum salary')}<LocalizedNumberInput reportOnBlur={false} required min={0} max={1e9} step={0.01} value={value.min} onChangeValue={(min) => onChange({ ...value, min })} /></label>
      <label className="recruit-field">{t('Maximum salary')}<LocalizedNumberInput reportOnBlur={false} required min={value.min && Number.isFinite(Number(value.min)) ? Math.max(0, Number(value.min)) : 0} max={1e9} step={0.01} value={value.max} onChangeValue={(max) => onChange({ ...value, max })} /></label>
      <label className="recruit-field">{t('Currency')}<input required dir="ltr" maxLength={3} pattern="[A-Z]{3}" title={t('Use a three-letter currency code, such as SAR or USD.')} list="job-budget-currencies" value={value.currency} onChange={(event) => onChange({ ...value, currency: event.target.value.toUpperCase() })} /><datalist id="job-budget-currencies">{CURRENCY_CODES.map((code) => <option key={code} value={code} />)}</datalist></label>
      <label className="recruit-field">{t('Pay period')}<select aria-label={t('Pay period')} value={value.period} onChange={(event) => onChange({ ...value, period: event.target.value as JobBudget['period'] })}><option value="monthly">{t('Monthly')}</option><option value="annual">{t('Annual')}</option><option value="hourly">{t('Hourly')}</option></select></label>
    </div> : <p className="hint">{t('No salary budget specified yet.')}</p>}
  </div>
}

export function HiringBudgetEditor({ value, onChange }: { value: HiringBudgetDraft; onChange: (value: HiringBudgetDraft) => void }): React.JSX.Element {
  const { t } = useI18n()
  return <div className="recruit-budget-editor">
    <label className="recruit-budget-toggle"><input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />{t('Set total hiring budget')}</label>
    {value.enabled ? <div className="recruit-budget-fields">
      <label className="recruit-field">{t('Minimum hiring budget')}<LocalizedNumberInput reportOnBlur={false} required min={0} max={1e9} step={0.01} value={value.min} onChangeValue={(min) => onChange({ ...value, min })} /></label>
      <label className="recruit-field">{t('Maximum hiring budget')}<LocalizedNumberInput reportOnBlur={false} required min={value.min && Number.isFinite(Number(value.min)) ? Math.max(0, Number(value.min)) : 0} max={1e9} step={0.01} value={value.max} onChangeValue={(max) => onChange({ ...value, max })} /></label>
      <label className="recruit-field">{t('Hiring budget currency')}<input required dir="ltr" maxLength={3} pattern="[A-Z]{3}" title={t('Use a three-letter currency code, such as SAR or USD.')} list="hiring-budget-currencies" value={value.currency} onChange={(event) => onChange({ ...value, currency: event.target.value.toUpperCase() })} /><datalist id="hiring-budget-currencies">{CURRENCY_CODES.map((code) => <option key={code} value={code} />)}</datalist></label>
    </div> : <p className="hint">{t('No total hiring budget specified yet.')}</p>}
  </div>
}
