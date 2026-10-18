export const CONTESTANTS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export const FAMILY = ['Ивайло', 'Стоян', 'Надя', 'Мама'] as const

export type Contestant = (typeof CONTESTANTS)[number]
export type FamilyName = (typeof FAMILY)[number]
export type Side = 'sing' | 'lie'
export type ContestantKey = `${Contestant}`

export type Player = {
  id: string
  name: string
  votes: Partial<Record<ContestantKey, Side>>
  voteRev: number
  locked: boolean
  joinedAt: number
  lastSeen: number
}

export type Room = {
  players: Player[]
  truth: Partial<Record<ContestantKey, Side>>
  updatedAt: number
}

export type RoomView = Room & {
  shareUrl: string
}

export type Action =
  | { type: 'join'; id: string; name: string }
  | { type: 'vote'; id: string; contestant: Contestant; side: Side | null; rev: number }
  | { type: 'lock'; id: string }
  | { type: 'truth'; id: string; contestant: Contestant; side: Side | null }
  | { type: 'leave'; id: string }
  | { type: 'ping'; id: string }
  | { type: 'reset'; id: string }

export function isContestant(value: number): value is Contestant {
  return Number.isInteger(value) && value >= 1 && value <= 8
}

export function isFamilyName(value: string): value is FamilyName {
  return (FAMILY as readonly string[]).includes(value)
}
