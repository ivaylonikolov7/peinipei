import {
  isContestant,
  isFamilyName,
  type Contestant,
  type ContestantKey,
  type Player,
  type Room,
  type Side,
} from '../shared/types.ts'
import { loadStored, saveStored } from './db.ts'

const MAX_PLAYERS = 4

function emptyRoom(): Room {
  return { players: [], truth: {}, updatedAt: Date.now() }
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return ''
  let text = ''
  for (const char of value) {
    if (char.charCodeAt(0) >= 32) text += char
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 18)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{8,80}$/i.test(value)
}

function keyOf(contestant: Contestant): ContestantKey {
  return String(contestant) as ContestantKey
}

function cleanSides(value: unknown): Partial<Record<ContestantKey, Side>> {
  const sides: Partial<Record<ContestantKey, Side>> = {}
  if (!value || typeof value !== 'object') return sides
  for (const [key, side] of Object.entries(value)) {
    const n = Number(key)
    if (!isContestant(n)) continue
    if (side === 'sing' || side === 'lie') sides[keyOf(n)] = side
  }
  return sides
}

function sanitize(input: unknown): Room {
  if (!input || typeof input !== 'object') return emptyRoom()
  const raw = input as Partial<Room>
  const now = Date.now()
  const players: Player[] = []
  if (Array.isArray(raw.players)) {
    for (const item of raw.players) {
      if (!item || typeof item !== 'object') continue
      const player = item as Partial<Player>
      const name = cleanName(player.name)
      if (!isId(player.id) || !isFamilyName(name)) continue
      players.push({
        id: player.id,
        name,
        votes: cleanSides(player.votes),
        voteRev: typeof player.voteRev === 'number' ? player.voteRev : 0,
        locked: Boolean(player.locked),
        joinedAt: typeof player.joinedAt === 'number' ? player.joinedAt : now,
        lastSeen: typeof player.lastSeen === 'number' ? player.lastSeen : now,
      })
    }
  }
  return {
    players: players.slice(0, MAX_PLAYERS),
    truth: cleanSides(raw.truth),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  }
}

let chain: Promise<void> = Promise.resolve()

function mutate(change: (draft: Room) => void): Promise<Room> {
  const job = chain.then(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const stored = await loadStored(sanitize)
      const draft = JSON.parse(JSON.stringify(stored.room)) as Room
      change(draft)
      draft.updatedAt = Date.now()
      try {
        await saveStored(draft, stored.version, sanitize)
        return draft
      } catch (err) {
        if (err instanceof Error && err.name === 'Conflict') continue
        throw err
      }
    }
    throw new Error('Опитай пак')
  })
  chain = job.then(
    () => undefined,
    () => undefined,
  )
  return job
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Непозната заявка')
  }
  return value as Record<string, unknown>
}

function asContestant(value: unknown): Contestant {
  const n = typeof value === 'number' ? value : Number(value)
  if (!isContestant(n)) throw new Error('Няма такъв номер')
  return n
}

function asSide(value: unknown): Side | null {
  if (value === null) return null
  if (value === 'sing' || value === 'lie') return value
  throw new Error('Гласът трябва да е пее или лъже')
}

function findPlayer(draft: Room, id: unknown): Player {
  if (!isId(id)) throw new Error('Влез отново')
  const player = draft.players.find((item) => item.id === id)
  if (!player) throw new Error('Влез отново')
  return player
}

function apply(draft: Room, action: unknown) {
  const body = asRecord(action)
  switch (body.type) {
    case 'join': {
      if (!isId(body.id)) throw new Error('Влез отново')
      const name = cleanName(body.name)
      if (!isFamilyName(name)) throw new Error('Само Ивайло, Стоян, Надя и Мама')
      const existing = draft.players.find((item) => item.id === body.id)
      if (existing) {
        if (existing.name !== name) throw new Error('Това място е заето')
        existing.lastSeen = Date.now()
        return
      }
      if (draft.players.some((item) => item.name === name)) throw new Error(`${name} вече е вътре`)
      if (draft.players.length >= MAX_PLAYERS) throw new Error('Масата е пълна')
      const now = Date.now()
      draft.players.push({
        id: body.id,
        name,
        votes: {},
        voteRev: 0,
        locked: false,
        joinedAt: now,
        lastSeen: now,
      })
      return
    }
    case 'vote': {
      const player = findPlayer(draft, body.id)
      if (player.locked) throw new Error('Гласът е заключен')
      const rev = typeof body.rev === 'number' ? body.rev : player.voteRev + 1
      if (rev < player.voteRev) return
      const contestant = asContestant(body.contestant)
      const side = asSide(body.side)
      const voteKey = keyOf(contestant)
      if (player.votes[voteKey]) throw new Error('Този номер е заключен')
      if (!side) throw new Error('Избери пее или лъже')
      player.voteRev = rev
      player.votes[voteKey] = side
      player.lastSeen = Date.now()
      return
    }
    case 'lock': {
      const player = findPlayer(draft, body.id)
      if (player.locked) throw new Error('Гласът вече е заключен')
      player.locked = true
      player.lastSeen = Date.now()
      return
    }
    case 'truth': {
      const player = findPlayer(draft, body.id)
      if (player.name !== 'Ивайло') throw new Error('Само Ивайло въвежда истината')
      const contestant = asContestant(body.contestant)
      const side = asSide(body.side)
      if (side) draft.truth[keyOf(contestant)] = side
      else delete draft.truth[keyOf(contestant)]
      return
    }
    case 'leave': {
      if (!isId(body.id)) throw new Error('Влез отново')
      draft.players = draft.players.filter((item) => item.id !== body.id)
      return
    }
    case 'ping': {
      if (!isId(body.id)) return
      const player = draft.players.find((item) => item.id === body.id)
      if (player) player.lastSeen = Date.now()
      return
    }
    case 'reset': {
      const player = findPlayer(draft, body.id)
      if (player.name !== 'Ивайло') throw new Error('Само Ивайло пуска нова емисия')
      for (const member of draft.players) {
        member.votes = {}
        member.locked = false
      }
      draft.truth = {}
      return
    }
    default:
      throw new Error('Непозната заявка')
  }
}

export async function readRoom(): Promise<Room> {
  const stored = await loadStored(sanitize)
  return stored.room
}

export function handleAction(action: unknown): Promise<Room> {
  return mutate((draft) => apply(draft, action))
}
