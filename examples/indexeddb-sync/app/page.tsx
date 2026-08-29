'use client'

import { useEffect, useState } from 'react'

import { deleteNote, listNotes, saveNote, type Note } from '@/lib/db'
import { applySnapshot, fetchSnapshot, sendToOtherDevice, type IncomingSnapshot } from '@/lib/sync'

export default function HomePage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [code, setCode] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [incoming, setIncoming] = useState<IncomingSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listNotes().then(setNotes)
  }, [])

  async function onAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // Capture the element now: `currentTarget` is null once the handler awaits.
    const element = event.currentTarget
    const form = new FormData(element)

    await saveNote({
      id: crypto.randomUUID(),
      title: String(form.get('title') ?? ''),
      body: String(form.get('body') ?? ''),
      updatedAt: Date.now(),
    })

    element.reset()
    setNotes(await listNotes())
  }

  async function onRemove(id: string) {
    await deleteNote(id)
    setNotes(await listNotes())
  }

  async function onSend() {
    setError(null)

    try {
      setCode((await sendToOtherDevice()).code)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not prepare the transfer')
    }
  }

  async function onLookUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIncoming(null)

    try {
      setIncoming(await fetchSnapshot(typed))
    } catch (lookUpError) {
      setError(lookUpError instanceof Error ? lookUpError.message : 'Could not read that code')
    }
  }

  async function onConfirmRestore() {
    if (!incoming) return

    await applySnapshot(typed, incoming)
    setIncoming(null)
    setTyped('')
    setNotes(await listNotes())
  }

  return (
    <main>
      <h1>Notes</h1>
      <p>
        Everything below lives in this browser&apos;s IndexedDB. Open this page in another browser and it will be empty
        — until you carry it across with a code.
      </p>

      <form onSubmit={onAdd}>
        <input name="title" placeholder="Title" required />{' '}
        <input name="body" placeholder="Something to remember" required /> <button type="submit">Add</button>
      </form>

      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            <strong>{note.title}</strong> — {note.body}{' '}
            <button onClick={() => void onRemove(note.id)} type="button">
              delete
            </button>
          </li>
        ))}
      </ul>

      <hr />

      <h2>Send to another device</h2>
      <button onClick={() => void onSend()} type="button">
        Prepare a transfer
      </button>

      {code ? (
        <p>
          Type this into the app on your other device, within the hour:{' '}
          <output style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.4rem', letterSpacing: '0.1em' }}>
            {code.match(/.{1,4}/g)?.join(' ')}
          </output>
        </p>
      ) : null}

      <h2>Restore from a code</h2>
      <form onSubmit={onLookUp}>
        <input onChange={(event) => setTyped(event.target.value)} placeholder="K7QP 2M4X" value={typed} />{' '}
        <button type="submit">Look it up</button>
      </form>

      {incoming ? (
        <p>
          Replace these {notes.length} notes with {incoming.data.notes?.length ?? 0} from{' '}
          {incoming.device ? <em>{incoming.device}</em> : 'another device'}, saved {incoming.createdAt.toLocaleString()}
          ?{' '}
          <button onClick={() => void onConfirmRestore()} type="button">
            Replace
          </button>{' '}
          <button onClick={() => setIncoming(null)} type="button">
            Cancel
          </button>
        </p>
      ) : null}

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
    </main>
  )
}
