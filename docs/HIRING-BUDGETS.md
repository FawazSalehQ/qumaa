# Saudi Hiring Budgets & Costs

Source review date: **2026-10-04**. These are local planning estimates for eligible Saudi private-sector employees. The tool does not certify GOSI classification, determine final benefit entitlement, or replace the employer's registered payroll figures.

Open **Companies → select company → + New budget plan**. Name the plan, optionally link a job belonging to that company, and confirm the employee eligibility scope. Each company can keep multiple plans. Linking a job does not populate or change its separate salary range or total hiring budget.

1. Select an existing GOSI scheme, a new scheme, or **Unknown — compare both schemes**. The comparison preserves both scenarios without deciding eligibility.
2. Enter monthly SAR basic, housing and fixed transport amounts. Alternatively, enter combined basic plus housing and edit the split percentages. The 75%/25% preset is company configuration, not a statutory ratio; both percentages must total 100%.
3. Set the selected budget month, inclusive forecast start/end months, employment start month, completed service months at that start, and headcount. Use zero completed months for a new hire with no prior service at this employer.
4. Optionally enter an **Approved period budget (SAR)** for the full headcount and forecast period. Review the EOS components and any verified GOSI wage override or changed wage limits.
5. Save the plan. Saved inputs and company/job references persist locally. Reopen it to edit, or use **Export budget CSV** for the saved inputs, component breakdown, scenarios, monthly forecast, assumptions and calculation versions in the current interface language.

While a plan is being edited, save or cancel before changing company or navigating elsewhere.

## Calculation rules

Let `B` be basic salary, `H` housing and `T` fixed transport, all monthly SAR amounts:

| Output | Formula |
| --- | --- |
| Gross salary | `B + H + T` |
| GOSI contribution wage | `min(B + H, configured ceiling)`, unless a verified registered wage is supplied |
| Employee GOSI | Contribution wage × total employee rate |
| Estimated take-home pay | Gross − employee GOSI, before other deductions |
| Employer GOSI | Contribution wage × total employer rate |
| EOS eligible wage | Sum of the explicitly included salary components |
| Monthly EOS provision | Eligible wage ÷ 24 before 60 completed employer-service months; ÷ 12 thereafter |
| Monthly employer cost per person | Gross + employer GOSI + EOS provision |
| Monthly headcount cost | Per-person cost × headcount |
| Remaining approved budget | Approved period budget − forecast total for all planned employees |

Employee GOSI is already part of gross salary: it is not added again to employer cost. Medical insurance and other employment costs are excluded. A negative remaining budget indicates an overrun.

Calculations use integer halalas. Employee GOSI total, employer GOSI total and monthly EOS provision each round half-up to one halala before totals and headcount multiplication. For a combined salary, basic is rounded first and housing receives the remainder, preserving the combined total.

For example, basic 10,000 + housing 2,500 + transport 1,000 gives gross **13,500** and GOSI wage **12,500**. With the new scheme in July 2026 and all three components eligible for first-five-year EOS, monthly employer cost is **13,500 + 1,593.75 + 562.50 = 15,656.25**, or **31,312.50** for two employees.

## Scheme and wage assumptions

Classification follows contribution history and GOSI's classification, not the start of a new job. The new system commenced **3 July 2024**. Prior qualifying civil-retirement or social-insurance periods not compensated at commencement generally retain the existing system. GOSI distinguishes prior periods that have already been compensated; confirm the recorded classification rather than inferring it from the hire date. [GOSI classification guidance](https://awareness.gosi.gov.sa/journey3.html)

The existing-scheme planning preset is employee **9.75%** and employer **11.75%**: pension 9% each, SANED 0.75% each, and occupational hazards 2% for the employer. SANED's reduction took effect on 1 January 2022. [GOSI pension branch](https://www.gosi.gov.sa/GOSIOnline/Annuity), [SANED rate announcement](https://www.gosi.gov.sa/GOSIOnline/news106)

The new-scheme schedule is:

| Effective date | Pension per party | Total employee rate | Total employer rate |
| --- | ---: | ---: | ---: |
| 2024-07-03 | 9.00% | 9.75% | 11.75% |
| 2025-07-01 | 9.50% | 10.25% | 12.25% |
| 2026-07-01 | 10.00% | 10.75% | 12.75% |
| 2027-07-01 | 10.50% | 11.25% | 13.25% |
| 2028-07-01 onward | 11.00% | 11.75% | 13.75% |

These transitions follow the calendar, not each employee's anniversary. GOSI confirms the first increase on 1 July 2025 and the unchanged SANED and occupational-hazard components. For the fixed salary components supported here, the contribution base includes basic and housing, excluding transport. GOSI also recognizes qualifying commissions and in-kind housing; those cases require a reviewed registered wage rather than assuming this three-component model is exhaustive. [GOSI employer guidance](https://awareness.gosi.gov.sa/businessJourney.html)

The default contribution-wage limits are **SAR 1,500 minimum** and **SAR 45,000 maximum**. The published GOSI FAQ explicitly states those pension-branch limits. The 2024 law independently confirms the ceiling but delegates the minimum to the competent authority. This review did not independently locate a newer official regulation expressly reconfirming 1,500 for the 2024 scheme; the default therefore cites the general published FAQ, not a separately verified new-scheme minimum. Changed limits require a recorded basis. Inputs below the configured minimum require correction or a verified registered-wage override with its basis; the tool does not silently increase salary. [GOSI contributor FAQ](https://www.gosi.gov.sa/GOSIOnline/FAQ_Contributor?locale=ar_SA), [2024 law, Article 8](https://beta.gosi.gov.sa/ar/new-system)

## Forecast and EOS limitations

The **annualized selected-month cost** is that month's result × 12, holding salary, rates and EOS provision constant. It is a comparison benchmark independent of employment start. The **budget-period forecast** instead sums each active month, excludes months before employment starts, applies that month's scheduled rate, and moves the EOS provision to the later-service rate after 60 elapsed employer-service months. Salaries and headcount remain constant across the forecast.

Only full calendar months are supported. Rates are selected at the start of each month, so the new scheme is unavailable for July 2024 and earlier planning months; its first supported full month is **August 2024**. Do not treat a mid-month hire or departure as an exact payroll calculation. GOSI announced contribution calculation by days worked effective 1 February 2022; the app does not implement that proration, and salary proration should not be assumed identical. [GOSI registration amendment announcement](https://www.gosi.gov.sa/GOSIOnline/news110?locale=en_US)

EOS uses a separate reviewed wage, with basic, housing and fixed transport initially included. HRSD describes half a month's last wage for each of the first five years, then a month's wage for each subsequent year, with proportional partial years. Wage additions and agreed exclusions of fluctuating commissions can affect the eligible wage; departure circumstances can affect actual entitlement. The monthly `/24` and `/12` amounts are budgeting provisions, not employee deductions, immediate payments, final settlements, or a recalculation of accumulated historical liability. [HRSD EOS regulations](https://www.hrsd.gov.sa/en/knowledge-centre/articles/317)

Saved calculation version: `saudi-hiring-costs-2024-2028-v1`. Default wage-limit version: `saudi-gosi-wage-limits-v1`. The last scheduled new-scheme rate is retained after July 2028; source review dates and saved versions do not constitute automatic monitoring of subsequent regulatory changes.
