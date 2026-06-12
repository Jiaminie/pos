export type ImportLogEntry = {
  at: string
  message: string
  phase?: 'backup' | 'import' | 'sync'
}

export function importLog(message: string, phase?: ImportLogEntry['phase']): ImportLogEntry {
  const entry: ImportLogEntry = {
    at: new Date().toISOString(),
    message,
    phase,
  }
  console.log(`[import${phase ? `:${phase}` : ''}] ${message}`)
  return entry
}
