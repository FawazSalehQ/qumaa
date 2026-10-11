/** Date inputs store local wall time; persisted records use UTC timestamps. */
export function dateTimeInput(value: number | null | undefined): string {
  if (value == null) return ''
  const date = new Date(value)
  const pad = (number: number): string => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function dateInput(value: number | null | undefined): string {
  return dateTimeInput(value).slice(0, 10)
}

export function inputTimestamp(value: string): number | null {
  if (!value) return null
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isFinite(date.getTime()) ? date.getTime() : null
}

export function splitLabels(value: string): string[] {
  return [...new Set(value.split(/[,،\n]/u).map((part) => part.trim()).filter(Boolean))]
}

export function localDayBounds(now: number): { start: number; end: number } {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const start = day.getTime()
  day.setDate(day.getDate() + 1)
  return { start, end: day.getTime() }
}
