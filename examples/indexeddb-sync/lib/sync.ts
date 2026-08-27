import { exportDatabase, importDatabase, type DatabaseDump } from './db'

export interface IncomingSnapshot {
  data: DatabaseDump
  createdAt: Date
  device?: string
}

/** Uploads this device's database and returns the code to type on the other one. */
export async function sendToOtherDevice(): Promise<{ code: string; expiresAt: Date }> {
  const response = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await exportDatabase()),
  })

  if (!response.ok) {
    throw new Error((await response.json()).error ?? 'Could not prepare the transfer')
  }

  const { code, expiresAt } = await response.json()
  return { code, expiresAt: new Date(expiresAt) }
}

/**
 * Fetches what a code points at — without importing it yet, so the interface can
 * show the user what is about to replace their data.
 */
export async function fetchSnapshot(typed: string): Promise<IncomingSnapshot> {
  const response = await fetch(`/api/sync/${encodeURIComponent(typed.trim())}`)

  if (!response.ok) {
    throw new Error((await response.json()).error ?? 'Could not read that code')
  }

  const { data, createdAt, device } = await response.json()
  return { data, createdAt: new Date(createdAt), device }
}

/** Replaces the local database, then burns the code. */
export async function applySnapshot(typed: string, snapshot: IncomingSnapshot): Promise<void> {
  await importDatabase(snapshot.data)

  // Best effort: the expiry is the backstop if this never runs.
  await fetch(`/api/sync/${encodeURIComponent(typed.trim())}`, { method: 'DELETE' }).catch(() => {})
}
