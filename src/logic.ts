import { CONTESTANTS, type Contestant, type ContestantKey, type Player, type Side } from '../shared/types.ts'

export function voteOf(
  votes: Partial<Record<ContestantKey, Side>> | undefined,
  contestant: Contestant,
): Side | null {
  return votes?.[String(contestant) as ContestantKey] ?? null
}

export function voteCount(player: Player): number {
  return CONTESTANTS.filter((n) => voteOf(player.votes, n)).length
}

export function scoreOf(player: Player, truth: Partial<Record<ContestantKey, Side>>) {
  let correct = 0
  let judged = 0
  for (const n of CONTESTANTS) {
    const revealed = voteOf(truth, n)
    if (!revealed) continue
    judged += 1
    if (voteOf(player.votes, n) === revealed) correct += 1
  }
  return { correct, judged }
}

export function sideLabel(side: Side, count: number): string {
  return `${count} за ${side === 'sing' ? 'пее' : 'лъже'}`
}

export function tally(players: Player[], contestant: Contestant) {
  const sing = players.filter((player) => voteOf(player.votes, contestant) === 'sing')
  const lie = players.filter((player) => voteOf(player.votes, contestant) === 'lie')
  return { sing, lie }
}

export function colorFor(id: string): string {
  const colors = ['#f0c36a', '#f08b78', '#8fd0c6', '#e7d7c3', '#e3a2c4', '#a8c48a', '#9bb6e0', '#e0b07a']
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return colors[hash % colors.length] ?? colors[0]
}

export function isPrivateHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  )
}

const SESSION_KEY = 'pees-ili-luzhesh'

export type Session = { id: string; name: string }

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Session>
    if (!parsed.id || !parsed.name) return null
    return { id: parsed.id, name: parsed.name }
  } catch {
    return null
  }
}

export function saveSession(session: Session | null) {
  if (!session) localStorage.removeItem(SESSION_KEY)
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}
