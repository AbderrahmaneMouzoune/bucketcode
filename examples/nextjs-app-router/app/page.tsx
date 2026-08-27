'use client'

import { useState } from 'react'

export default function HomePage() {
  const [id, setId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const response = await fetch('/api/files', {
      method: 'POST',
      body: new FormData(event.currentTarget),
    })

    if (!response.ok) {
      setError((await response.json()).error ?? 'Upload failed')
      return
    }

    setId((await response.json()).id)
  }

  return (
    <main>
      <h1>One file per identifier</h1>
      <p>
        Upload a file: the server stores it under a six character id and hands the id back. Reading, replacing and
        deleting all go through that same id.
      </p>

      <form onSubmit={onSubmit}>
        <input type="file" name="file" required />
        <button type="submit">Upload</button>
      </form>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      {id ? (
        <p>
          Stored as <code>{id}</code> — <a href={`/api/files/${id}`}>open it</a>
        </p>
      ) : null}
    </main>
  )
}
