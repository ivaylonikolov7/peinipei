import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Connect, Plugin } from 'vite'

import { respondToRoom } from './respond.ts'

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
    let action: unknown = {}
    if (req.method === 'POST') {
      const raw = await readBody(req)
      if (raw) action = JSON.parse(raw) as unknown
    }
    const result = await respondToRoom(req.method, action)
    sendJson(res, result.status, result.body)
  } catch (err) {
    const message =
      err instanceof SyntaxError
        ? 'Непозната заявка'
        : err instanceof Error
          ? err.message
          : 'Нещо се обърка'
    if (!res.headersSent) sendJson(res, 400, { error: message })
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
