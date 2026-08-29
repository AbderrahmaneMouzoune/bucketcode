/**
 * A small IndexedDB store, plus the export/import pair a transfer needs.
 *
 * This half is deliberately application code: only your app knows its own
 * object stores, which is why bucketcode does not try to dump IndexedDB
 * generically.
 */

const DB_NAME = 'bucketcode-notes'
const DB_VERSION = 1
const STORES = ['notes'] as const

/** Bumped whenever the shape below changes. Travels with every snapshot. */
export const SCHEMA_VERSION = 1

export interface Note {
  id: string
  title: string
  body: string
  updatedAt: number
}

export type DatabaseDump = Record<string, unknown[]>

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store, { keyPath: 'id' })
        }
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function listNotes(): Promise<Note[]> {
  const db = await open()
  const notes = await promisify(db.transaction('notes').objectStore('notes').getAll())
  db.close()

  return (notes as Note[]).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveNote(note: Note): Promise<void> {
  const db = await open()
  await promisify(db.transaction('notes', 'readwrite').objectStore('notes').put(note))
  db.close()
}

export async function deleteNote(id: string): Promise<void> {
  const db = await open()
  await promisify(db.transaction('notes', 'readwrite').objectStore('notes').delete(id))
  db.close()
}

/** Everything in the database, as plain JSON. */
export async function exportDatabase(): Promise<DatabaseDump> {
  const db = await open()
  const transaction = db.transaction(STORES)

  const dump: DatabaseDump = {}
  for (const store of STORES) {
    dump[store] = await promisify(transaction.objectStore(store).getAll())
  }

  db.close()
  return dump
}

/**
 * Replaces the local database with a dump. One transaction over every store, so
 * a failure halfway leaves the previous contents intact rather than half of each.
 */
export async function importDatabase(dump: DatabaseDump): Promise<void> {
  const db = await open()

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORES, 'readwrite')

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('Import aborted'))

    for (const store of STORES) {
      const objectStore = transaction.objectStore(store)
      objectStore.clear()

      for (const record of dump[store] ?? []) {
        objectStore.put(record)
      }
    }
  })

  db.close()
}
