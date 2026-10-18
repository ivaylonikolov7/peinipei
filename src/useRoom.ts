import { useCallback, useEffect, useState } from 'react'

import type { Action, RoomView } from '../shared/types.ts'

export type RoomStatus = 'loading' | 'live' | 'down'

async function request(method: 'GET' | 'POST', action?: Action): Promise<RoomView> {
  const res = await fetch('/api/room', {
    method,
    cache: 'no-store',
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(action) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as Partial<RoomView> & { error?: string }
  if (!res.ok || !Array.isArray(data.players) || !data.truth) {
    throw new Error(data.error || 'Нещо се обърка')
  }
  return data as RoomView
}

export function useRoom(playerId: string | null) {
  const [room, setRoom] = useState<RoomView | null>(null)
  const [status, setStatus] = useState<RoomStatus>('loading')

  const send = useCallback(async (action: Action) => {
    const next = await request('POST', action)
    setRoom(next)
    setStatus('live')
    return next
  }, [])

  useEffect(() => {
    let stopped = false
    let timer = 0

    async function tick() {
      try {
        const next = await request('GET')
        if (!stopped) {
          setRoom(next)
          setStatus('live')
        }
      } catch {
        if (!stopped) setStatus('down')
      } finally {
        if (!stopped) timer = window.setTimeout(tick, 1000)
      }
    }

    void tick()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!playerId) return
    let stopped = false
    const timer = window.setInterval(() => {
      void request('POST', { type: 'ping', id: playerId })
        .then((next) => {
          if (!stopped) {
            setRoom(next)
            setStatus('live')
          }
        })
        .catch(() => {
          if (!stopped) setStatus('down')
        })
    }, 5000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [playerId])

  return { room, status, send }
}
