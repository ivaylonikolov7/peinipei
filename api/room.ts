import { respondToRoom } from '../server/respond.ts'

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method === 'POST') {
        const raw = await request.text()
        if (raw.length > 20_000) return json(400, { error: 'Твърде дълга заявка' })
        const action: unknown = raw ? (JSON.parse(raw) as unknown) : {}
        const result = await respondToRoom('POST', action)
        return json(result.status, result.body)
      }
      const result = await respondToRoom(request.method)
      return json(result.status, result.body)
    } catch (err) {
      const message = err instanceof SyntaxError ? 'Непозната заявка' : err instanceof Error ? err.message : 'Базата не отговаря'
      return json(err instanceof SyntaxError ? 400 : 500, { error: message })
    }
  },
}
