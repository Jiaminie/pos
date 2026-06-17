export type AddedRange = 'all' | 'today' | 'week' | 'month'

export const ADDED_RANGES: { label: string; value: AddedRange }[] = [
  { label: 'All time', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'This week', value: 'week' },
  { label: 'This month', value: 'month' },
]

export function addedRangeStart(range: Exclude<AddedRange, 'all'>): Date {
  const d = new Date()
  if (range === 'today') {
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (range === 'week') {
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    return d
  }
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addedRangeEnd(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

export function isInAddedRange(createdAt: string | undefined, range: AddedRange): boolean {
  if (range === 'all') return true
  if (!createdAt) return false
  const t = new Date(createdAt).getTime()
  return t >= addedRangeStart(range).getTime() && t <= addedRangeEnd().getTime()
}
