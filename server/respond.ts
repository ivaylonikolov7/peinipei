import fs from 'node:fs'
import path from 'node:path'

import type { RoomView } from '../shared/types.ts'
import { handleAction, readRoom } from './store.ts'

const shareFile = path.resolve(process.cwd(), 'data/share-url.txt')

function readShareUrl(): string {
  const candidates = [process.env.PUBLIC_URL ?? '']
  try {
    candidates.push(fs.readFileSync(shareFile, 'utf8'))
  } catch {
    // The public link appears once sharing is started.
  }
  for (const candidate of candidates) {
    const value = candidate.trim()
    if (/^https?:\/\//i.test(value)) return value
  }
  return ''
}

async function view(): Promise<RoomView> {
  return { ...(await readRoom()), shareUrl: readShareUrl() }
}

export async function respondToRoom(
  method: string | undefined,
  action: unknown = {},
): Promise<{ status: number; body: unknown }> {
  try {
    if (method === 'GET') return { status: 200, body: await view() }
    if (method !== 'POST') return { status: 405, body: { error: 'Методът не е позволен' } }
    await handleAction(action)
    return { status: 200, body: await view() }
  } catch (err) {
    const message =
      err instanceof SyntaxError
        ? 'Непозната заявка'
        : err instanceof Error
          ? err.message
          : 'Нещо се обърка'
    const status = message === 'Гласът е заключен' ? 409 : 400
    return { status, body: { error: message } }
  }
}
