import fs from 'node:fs'
import path from 'node:path'

import {
  ConditionalCheckFailedException,
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'

import type { Room } from '../shared/types.ts'

const TABLE = process.env.DYNAMODB_TABLE ?? 'PeiNiPei'
const ROOM_KEY = 'room'
const legacyFile = path.resolve(process.cwd(), 'data/room.json')

const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000'
const local = endpoint !== 'aws'

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'eu-north-1',
  maxAttempts: 2,
  ...(local
    ? {
        endpoint,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {}),
})

const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

export type StoredRoom = {
  room: Room
  version: number
}

function legacyRoom(sanitize: (input: unknown) => Room): Room | null {
  try {
    return sanitize(JSON.parse(fs.readFileSync(legacyFile, 'utf8')))
  } catch {
    return null
  }
}

async function ensureTable() {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE }))
    return
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException) && !(err instanceof Error && err.name === 'ResourceNotFoundException')) {
      throw err
    }
  }

  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    }),
  )
}

async function readItem(): Promise<StoredRoom | null> {
  const result = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: ROOM_KEY },
      ConsistentRead: true,
    }),
  )
  const item = result.Item as (Room & { pk?: string; version?: number }) | undefined
  if (!item) return null
  const version = typeof item.version === 'number' ? item.version : 0
  const room: Room = {
    players: item.players,
    truth: item.truth,
    updatedAt: item.updatedAt,
  }
  return { room, version }
}

async function writeItem(room: Room, expectedVersion: number) {
  const nextVersion = expectedVersion + 1
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: ROOM_KEY,
        ...room,
        version: nextVersion,
      },
      ConditionExpression: expectedVersion === 0 ? 'attribute_not_exists(pk) OR version = :version' : 'version = :version',
      ExpressionAttributeValues: { ':version': expectedVersion },
    }),
  )
  return nextVersion
}

let ready: Promise<void> | null = null

export function whenReady(sanitize: (input: unknown) => Room) {
  if (!ready) {
    ready = (async () => {
      await ensureTable()
      const existing = await readItem()
      if (existing) return
      const seeded = legacyRoom(sanitize) ?? sanitize(null)
      try {
        await writeItem(seeded, 0)
      } catch (err) {
        if (!(err instanceof ConditionalCheckFailedException) && !(err instanceof Error && err.name === 'ConditionalCheckFailedException')) {
          throw err
        }
      }
    })().catch((err: unknown) => {
      ready = null
      throw err
    })
  }
  return ready
}

export async function loadStored(sanitize: (input: unknown) => Room): Promise<StoredRoom> {
  await whenReady(sanitize)
  const stored = await readItem()
  if (!stored) return { room: sanitize(null), version: 0 }
  return { room: sanitize(stored.room), version: stored.version }
}

export async function saveStored(room: Room, expectedVersion: number, sanitize: (input: unknown) => Room) {
  try {
    return await writeItem(room, expectedVersion)
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || (err instanceof Error && err.name === 'ConditionalCheckFailedException')) {
      const latest = await loadStored(sanitize)
      const conflict = new Error('conflict')
      conflict.name = 'Conflict'
      throw Object.assign(conflict, { latest })
    }
    if (err instanceof Error && (err.name === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED') || err.message.includes('connect'))) {
      throw new Error('Базата не отговаря')
    }
    throw err
  }
}
