import { useEffect, useMemo, useRef, useState } from 'react'

import { CONTESTANTS, FAMILY, isFamilyName, type Contestant, type Player, type Side } from '../shared/types.ts'
import {
  colorFor,
  isPrivateHost,
  loadSession,
  saveSession,
  scoreOf,
  sideLabel,
  tally,
  voteCount,
  voteOf,
  type Session,
} from './logic.ts'
import { useRoom } from './useRoom.ts'
import './App.css'

function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const stored = loadSession()
    if (!stored || !isFamilyName(stored.name)) return null
    return stored
  })
  const { room, status, send } = useRoom(session?.id ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session || status !== 'live') return
    let cancelled = false
    send({ type: 'join', id: session.id, name: session.name }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Не мога да вляза')
    })
    return () => {
      cancelled = true
    }
  }, [session, status, send])

  async function enter(name: string) {
    const next = { id: crypto.randomUUID(), name }
    await send({ type: 'join', id: next.id, name: next.name })
    saveSession(next)
    setSession(next)
    setError(null)
  }

  async function leave() {
    if (!session) return
    await send({ type: 'leave', id: session.id })
    saveSession(null)
    setSession(null)
  }

  if (!session) {
    return (
      <JoinScreen
        status={status}
        error={error}
          taken={new Set(room?.players?.map((player) => player.name) ?? [])}
        onEnter={enter}
        roomLink={linkFor(room?.shareUrl)}
      />
    )
  }

  return (
    <Game
      session={session}
      room={room}
      status={status}
      error={error}
      onError={setError}
      onLeave={leave}
      send={send}
    />
  )
}

function linkFor(shareUrl: string | undefined) {
  if (shareUrl && isPrivateHost(location.hostname)) return shareUrl
  return location.href
}

function JoinScreen({
  status,
  error,
  taken,
  onEnter,
  roomLink,
}: {
  status: string
  error: string | null
  taken: Set<string>
  onEnter: (name: string) => Promise<void>
  roomLink: string
}) {
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  async function choose(name: (typeof FAMILY)[number]) {
    if (pendingName || taken.has(name)) return
    setPendingName(name)
    setLocalError(null)
    try {
      await onEnter(name)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Не мога да вляза')
    } finally {
      setPendingName(null)
    }
  }

  return (
    <main className="join">
      <div className="join-card">
        <p className="kicker">семейно гласуване</p>
        <h1>
          Пееш <span>или</span>
          <br />
          лъжеш
        </h1>
        <p className="lede">Осем номера. Избери си мястото.</p>
        <p className="seat-label">Кой си?</p>
        <div className="seats" role="group" aria-label="Кой си?">
          {FAMILY.map((name) => {
            const busy = taken.has(name)
            return (
              <button
                key={name}
                type="button"
                className="seat"
                disabled={busy || pendingName !== null || status !== 'live'}
                onClick={() => void choose(name)}
              >
                <span>{name}</span>
                <small>{pendingName === name ? 'влизам…' : busy ? 'заето' : 'свободно'}</small>
              </button>
            )
          })}
        </div>
        {(localError || error) && <p className="error">{localError || error}</p>}
        {status === 'down' && (
          <p className="error">Няма връзка. Масата трябва да е пусната на компютъра с линка.</p>
        )}
        <ShareBar link={roomLink} players={taken.size} />
      </div>
    </main>
  )
}

function Game({
  session,
  room,
  status,
  error,
  onError,
  onLeave,
  send,
}: {
  session: Session
  room: ReturnType<typeof useRoom>['room']
  status: ReturnType<typeof useRoom>['status']
  error: string | null
  onError: (value: string | null) => void
  onLeave: () => Promise<void>
  send: ReturnType<typeof useRoom>['send']
}) {
  const me = room?.players.find((player) => player.id === session.id) ?? null
  const [optimistic, setOptimistic] = useState<Partial<Record<Contestant, Side | null>>>({})
  const [menuOpen, setMenuOpen] = useState(false)
  const [truthOpen, setTruthOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const voteRev = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [menuOpen])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      setDialog(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ranked = useMemo(() => {
    const players = room?.players ?? []
    const truth = room?.truth ?? {}
    const rows = players.map((player) => ({ player, ...scoreOf(player, truth) }))
    const hasTruth = rows.some((row) => row.judged > 0)
    if (!hasTruth) return rows.map((row) => ({ ...row, rank: 0 }))
    const sorted = rows.slice().sort((a, b) => b.correct - a.correct || a.player.joinedAt - b.player.joinedAt)
    let lastScore = -1
    let lastRank = 0
    return sorted.map((row, index) => {
      if (row.correct !== lastScore) {
        lastRank = index + 1
        lastScore = row.correct
      }
      return { ...row, rank: lastRank }
    })
  }, [room])

  const leaderboard = useMemo(() => {
    return ranked.slice().sort((a, b) => b.correct - a.correct || a.player.joinedAt - b.player.joinedAt)
  }, [ranked])

  function mySide(contestant: Contestant): Side | null {
    const server = me ? voteOf(me.votes, contestant) : null
    if (!(contestant in optimistic)) return server
    const pending = optimistic[contestant] ?? null
    return pending === server ? server : pending
  }

  async function vote(contestant: Contestant, side: Side) {
    if (!me || me.locked || mySide(contestant)) return
    voteRev.current = Math.max(voteRev.current, me.voteRev) + 1
    const rev = voteRev.current
    setOptimistic((prev) => ({ ...prev, [contestant]: side }))
    navigator.vibrate?.(12)
    try {
      await send({ type: 'vote', id: session.id, contestant, side, rev })
      onError(null)
    } catch (err) {
      setOptimistic((prev) => {
        const copy = { ...prev }
        delete copy[contestant]
        return copy
      })
      onError(err instanceof Error ? err.message : 'Гласът не мина')
    }
  }

  async function setTruth(contestant: Contestant, side: Side) {
    const next = room && voteOf(room.truth, contestant) === side ? null : side
    try {
      await send({ type: 'truth', id: session.id, contestant, side: next })
      onError(null)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Истината не мина')
    }
  }

  async function confirmDialog() {
    if (!dialog) return
    try {
      if (dialog.kind === 'reset') {
        await send({ type: 'reset', id: session.id })
        setTruthOpen(false)
      } else if (dialog.kind === 'leave') {
        await onLeave()
      } else {
        await send({ type: 'leave', id: dialog.player.id })
      }
      onError(null)
      setDialog(null)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Не стана')
    }
  }

  const link = linkFor(room?.shareUrl)
  const canJudge = session.name === 'Ивайло'
  const mineCount = me ? CONTESTANTS.filter((n) => mySide(n)).length : 0
  const dirty =
    ranked.some((row) => voteCount(row.player) > 0 || row.player.locked) ||
    CONTESTANTS.some((n) => room && voteOf(room.truth, n))

  return (
    <main className="page">
      <header className="top">
        <div>
          <p className="kicker">семейно гласуване</p>
          <h1>Пееш или лъжеш</h1>
        </div>
        <div className="top-actions">
          <span className={status === 'live' ? 'live' : 'live down'}>
            <i />
            {status === 'live' ? 'на живо' : status === 'loading' ? 'свързване' : 'няма връзка'}
          </span>
          <div className="menu" ref={menuRef}>
            <button
              type="button"
              className="ghost name-button"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="dot" style={{ background: colorFor(session.id) }} />
              {session.name}
            </button>
            {menuOpen && (
              <div className="popover">
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    void shareLink(link).then((result) => {
                      if (result === 'copied') flash(setNotice, 'Линкът е копиран')
                    })
                  }}
                >
                  Изпрати линка
                </button>
                <button
                  type="button"
                  className="menu-item danger"
                  onClick={() => {
                    setMenuOpen(false)
                    setDialog({ kind: 'leave' })
                  }}
                >
                  Напусни
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <ShareBar link={link} players={room?.players.length ?? 0} privateHost={isPrivateHost(location.hostname)} />

      <section className="progress" aria-label="Твоят глас">
        <div>
          <strong>Твоят глас</strong>
          <span>{mineCount} от 8</span>
        </div>
        <div className="pips" aria-hidden="true">
          {CONTESTANTS.map((n) => (
            <span key={n} className={mySide(n) ? `pip ${mySide(n)}` : 'pip'} />
          ))}
        </div>
      </section>

      {!me && <p className="waiting">Влизам в масата…</p>}

      <div className="stage">
        <section className="cards" aria-label="Номера">
          {CONTESTANTS.map((n) => (
            <VoteCard
              key={n}
              contestant={n}
              players={room?.players ?? []}
              mine={mySide(n)}
              truth={room ? voteOf(room.truth, n) : null}
              locked={!me || me.locked || mySide(n) !== null}
              onVote={(side) => void vote(n, side)}
            />
          ))}
        </section>

        <aside className="rail">
          <section className="panel">
            <h2>Семейството</h2>
            {ranked.length === 0 && <p className="quiet">Още няма никой.</p>}
            <div className="people">
              {ranked.map((row) => (
                <article key={row.player.id} className={row.player.id === session.id ? 'person mine' : 'person'}>
                  <header>
                    <span className="dot" style={{ background: colorFor(row.player.id) }} />
                    <strong>{row.player.name}</strong>
                    {row.player.locked && <span className="ready">готов</span>}
                    {row.judged > 0 && row.rank === 1 && row.correct > 0 && <span className="first">първи</span>}
                    {row.judged > 0 && (
                      <b className="pts">
                        {row.correct}/{row.judged}
                      </b>
                    )}
                    <button
                      type="button"
                      className="tiny"
                      onClick={() =>
                        setDialog(row.player.id === session.id ? { kind: 'leave' } : { kind: 'remove', player: row.player })
                      }
                    >
                      махни
                    </button>
                  </header>
                  <div className="marks">
                    {CONTESTANTS.map((n) => {
                      const vote = voteOf(row.player.votes, n)
                      const revealed = room ? voteOf(room.truth, n) : null
                      const judged = revealed && vote ? (vote === revealed ? ' hit' : ' miss') : ''
                      const tone = vote === 'sing' ? 'sing' : vote === 'lie' ? 'lie' : 'empty'
                      return (
                        <span key={n} className={`mark ${tone}${judged}`}>
                          <i>{n}</i>
                          {vote === 'sing' ? 'П' : vote === 'lie' ? 'Л' : '·'}
                        </span>
                      )
                    })}
                  </div>
                </article>
              ))}
            </div>
            <p className="legend">
              <span className="swatch sing">П</span> пее
              <span className="swatch lie">Л</span> лъже
              {ranked.some((row) => row.judged > 0) && ' · пръстенът значи позна'}
            </p>
          </section>

          <section className="panel">
            <button type="button" className="disclosure" aria-expanded={truthOpen} onClick={() => setTruthOpen((open) => !open)}>
              <h2>Истината от емисията</h2>
              <span>{truthOpen ? 'скрий' : 'отвори'}</span>
            </button>
            {truthOpen && (
              <>
                <p className="quiet">
                  {canJudge
                    ? 'Отбележи какво показаха в края. Точките се смятат сами. Гласовете на всички остават.'
                    : 'Само Ивайло въвежда истината. Гласовете на всички остават.'}
                </p>
                <div className="truth-list">
                  {CONTESTANTS.map((n) => {
                    const revealed = room ? voteOf(room.truth, n) : null
                    return (
                      <div key={n} className="truth-row">
                        <span className="truth-num">{n}</span>
                        {canJudge ? (
                          <>
                            <button
                              type="button"
                              className={revealed === 'sing' ? 'choice sing on' : 'choice sing'}
                              aria-pressed={revealed === 'sing'}
                              onClick={() => void setTruth(n, 'sing')}
                            >
                              Пее
                            </button>
                            <button
                              type="button"
                              className={revealed === 'lie' ? 'choice lie on' : 'choice lie'}
                              aria-pressed={revealed === 'lie'}
                              onClick={() => void setTruth(n, 'lie')}
                            >
                              Лъже
                            </button>
                          </>
                        ) : (
                          <span className="revealed">
                            {revealed === 'sing' ? 'пее' : revealed === 'lie' ? 'лъже' : 'още няма'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </section>

          {canJudge && dirty && (
            <button type="button" className="texty" onClick={() => setDialog({ kind: 'reset' })}>
              Нова емисия
            </button>
          )}
        </aside>
      </div>

      <section className="panel leaderboard" aria-label="Класация">
        <h2>Класация</h2>
        {leaderboard.length === 0 ? (
          <p className="quiet">Още няма никой.</p>
        ) : (
          <>
            {!leaderboard.some((row) => row.judged > 0) && (
              <p className="quiet">Познатите се броят, когато има истина за номерата.</p>
            )}
            <ol>
              {leaderboard.map((row) => (
                <li key={row.player.id} className={row.player.id === session.id ? 'board-row mine' : 'board-row'}>
                  <span className="place">{row.judged > 0 ? row.rank : '·'}</span>
                  <span className="dot" style={{ background: colorFor(row.player.id) }} />
                  <strong>{row.player.name}</strong>
                  <b>
                    {row.correct} <small>позна</small>
                  </b>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {dialog && (
        <div className="modal-back" role="presentation" onClick={() => setDialog(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="dialog-title">{dialogCopy(dialog).title}</h2>
            <p>{dialogCopy(dialog).body}</p>
            <div className="modal-actions">
              <button type="button" className="ghost" autoFocus onClick={() => setDialog(null)}>
                Отказ
              </button>
              <button type="button" className="primary slim" onClick={() => void confirmDialog()}>
                {dialogCopy(dialog).confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

type Dialog = { kind: 'reset' } | { kind: 'leave' } | { kind: 'remove'; player: Player }

function dialogCopy(dialog: Dialog): { title: string; body: string; confirm: string } {
  if (dialog.kind === 'reset') {
    return {
      title: 'Нова емисия?',
      body: 'Гласовете и истината се трият. Имената остават за следващия път.',
      confirm: 'Да, нова емисия',
    }
  }
  if (dialog.kind === 'leave') {
    return {
      title: 'Напускаш масата?',
      body: 'Гласът ти се трие. После можеш да влезеш пак.',
      confirm: 'Напусни',
    }
  }
  return {
    title: `Махаме ${dialog.player.name}?`,
    body: 'Гласът на този човек се трие от масата.',
    confirm: 'Махни',
  }
}
function VoteCard({
  contestant,
  players,
  mine,
  truth,
  locked,
  onVote,
}: {
  contestant: Contestant
  players: Player[]
  mine: Side | null
  truth: Side | null
  locked: boolean
  onVote: (side: Side) => void
}) {
  const { sing, lie } = tally(players, contestant)
  const split = sing.length > 0 && lie.length > 0
  const stamp = !truth
    ? null
    : !mine
      ? truth === 'sing'
        ? 'пее'
        : 'лъже'
      : mine === truth
        ? 'позна'
        : 'грешка'

  return (
    <article className="card" data-vote={mine ?? 'none'} data-split={split && !truth ? 'true' : 'false'}>
      <div className="card-head">
        <span className="num">{contestant}</span>
        {stamp && (
          <span className={stamp === 'позна' ? 'flag hit' : stamp === 'грешка' ? 'flag miss' : 'flag'}>{stamp}</span>
        )}
        {!stamp && mine && <span className="flag">заключен</span>}
        {!stamp && !mine && split && <span className="flag">спор</span>}
      </div>
      <p className="tally">
        {sing.length === 0 && lie.length === 0 && <span className="quiet">още няма глас</span>}
        {sing.length > 0 && <span className="sing-text">{sideLabel('sing', sing.length)}</span>}
        {lie.length > 0 && <span className="lie-text">{sideLabel('lie', lie.length)}</span>}
      </p>
      <div className="choices">
        <button
          type="button"
          className={mine === 'sing' ? 'choice sing on' : 'choice sing'}
          aria-pressed={mine === 'sing'}
          aria-label={`Номер ${contestant} пее`}
          disabled={locked}
          onClick={() => onVote('sing')}
        >
          Пее
        </button>
        <button
          type="button"
          className={mine === 'lie' ? 'choice lie on' : 'choice lie'}
          aria-pressed={mine === 'lie'}
          aria-label={`Номер ${contestant} лъже`}
          disabled={locked}
          onClick={() => onVote('lie')}
        >
          Лъже
        </button>
      </div>
      <p className="who">
        {sing.map((player) => (
          <span key={player.id} className="voter sing-text">
            {player.name}
          </span>
        ))}
        {lie.map((player) => (
          <span key={player.id} className="voter lie-text">
            {player.name}
          </span>
        ))}
      </p>
    </article>
  )
}

function ShareBar({ link, players, privateHost = false }: { link: string; players: number; privateHost?: boolean }) {
  const [notice, setNotice] = useState<string | null>(null)
  const localOnly = privateHost && link === location.href
  if (players >= 2 && !localOnly) return null

  return (
    <section className="share">
      <p>{players < 2 ? 'Прати линка на останалите от семейството.' : 'Линк за семейството'}</p>
      {localOnly && <p className="quiet">Този адрес се вижда само на този компютър.</p>}
      <button type="button" className="linkline" onClick={() => void shareLink(link).then((result) => {
        if (result === 'copied') setNotice('Линкът е копиран')
      })}>
        {link.replace(/^https?:\/\//, '')}
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() =>
          void shareLink(link).then((result) => {
            if (result === 'copied') setNotice('Линкът е копиран')
          })
        }
      >
        Изпрати линка
      </button>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}

async function shareLink(link: string): Promise<'shared' | 'copied' | 'cancel' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Пееш или лъжеш', text: 'Влез да гласуваш за номерата.', url: link })
      return 'shared'
    } catch {
      return 'cancel'
    }
  }
  try {
    await navigator.clipboard.writeText(link)
    return 'copied'
  } catch {
    return 'failed'
  }
}

function flash(setNotice: (value: string | null) => void, message: string) {
  setNotice(message)
  window.setTimeout(() => setNotice(null), 2200)
}

export default App
