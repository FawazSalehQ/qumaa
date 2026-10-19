import type { ReactNode } from 'react'
import { ChevronDownIcon } from './Icons.js'

/**
 * The head of a `.disclosure` <details>: the chevron marker, then the label.
 * The label span holds the summary's only text, so the accessible name and a
 * text locator both resolve to the label alone; the chevron is aria-hidden.
 */
export default function DisclosureSummary({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <summary>
      <ChevronDownIcon className="disclosure-chevron" />
      <span className="disclosure-label">{children}</span>
    </summary>
  )
}
