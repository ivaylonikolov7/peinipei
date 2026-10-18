import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Connect, Plugin } from 'vite'

import { handleAction, readRoom } from './store.ts'
import type { RoomView } from '../shared/types.ts'

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

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 20_000) {
        reject(new Error('Твърде дълга заявка'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method === 'GET') {
      sendJson(res, 200, await view())
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Методът не е позволен' })
      return
    }
    const raw = await readBody(req)
    let action: unknown = {}
    if (raw) action = JSON.parse(raw) as unknown
    await handleAction(action)
    sendJson(res, 200, await view())
  } catch (err) {
    const message =
      err instanceof SyntaxError
        ? 'Непозната заявка'
        : err instanceof Error
          ? err.message
          : 'Нещо се обърка'
    const status = message === 'Гласът е заключен' ? 409 : 400
    if (!res.headersSent) sendJson(res, status, { error: message })
  }
}

function mount(middlewares: Connect.Server) {
  middlewares.use((req, res, next) => {
    const url = req.url ?? ''
    if (url !== '/api/room' && !url.startsWith('/api/room?')) {
      next()
      return
    }
    void handle(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Базата не отговаря'
      if (!res.headersSent) sendJson(res, 500, { error: message })
    })
  })
}

export function roomApi(): Plugin {
  return {
    name: 'room-api',
    configureServer(server) {
      mount(server.middlewares)
    },
    configurePreviewServer(server) {
      mount(server.middlewares)
    },
  }
}
