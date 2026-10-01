import { dirname, join } from 'node:path'

import { setupTestDatabase, withRoot } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { snapshotTo } from '@data/db/restore/snapshot'
import { messageTable } from '@data/db/schemas/message'
import {
  sessionGraphMessageCopyTable,
  sessionGraphMessageTable,
  sessionGraphTurnTable
} from '@data/db/schemas/sessionGraph'
import { topicTable } from '@data/db/schemas/topic'
import { sessionGraphIdentityService } from '@data/services/SessionGraphIdentityService'

describe('SessionGraphIdentityService', () => {
  const dbh = setupTestDatabase()

  function seedConversation(topicId: string, prefix: string): void {
    dbh.db.insert(topicTable).values({ id: topicId, orderKey: topicId }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot(topicId, [
          {
            id: `${prefix}-question`,
            parentId: null,
            topicId,
            role: 'user',
            data: { parts: [{ type: 'text', text: 'What is VXLAN?' }] },
            status: 'success'
          },
          {
            id: `${prefix}-answer-a`,
            parentId: `${prefix}-question`,
            topicId,
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'Answer A' }] },
            status: 'success'
          },
          {
            id: `${prefix}-answer-b`,
            parentId: `${prefix}-question`,
            topicId,
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'Answer B' }] },
            status: 'success'
          }
        ])
      )
      .run()
  }

  it('keeps sibling replies distinct under one logical turn and reuses identities', () => {
    seedConversation('original', 'source')

    const answerA = sessionGraphIdentityService.ensureIdentity('source-answer-a')
    const answerB = sessionGraphIdentityService.ensureIdentity('source-answer-b')
    const question = sessionGraphIdentityService.ensureIdentity('source-question')

    expect(answerA.turnId).toBe(question.turnId)
    expect(answerB.turnId).toBe(question.turnId)
    expect(new Set([question.graphMessageId, answerA.graphMessageId, answerB.graphMessageId]).size).toBe(3)
    expect(sessionGraphIdentityService.ensureIdentity('source-answer-a')).toEqual(answerA)
    expect(dbh.db.select().from(sessionGraphTurnTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(sessionGraphMessageTable).all()).toHaveLength(3)
    expect(() => sessionGraphIdentityService.ensureIdentity('vroot-original')).toThrow(/Cannot map root message/)
  })

  it('maps physical copies to the same identities and includes them in a SQLite snapshot', () => {
    seedConversation('original', 'source')
    seedConversation('fork', 'copy')

    const sourceAnswer = sessionGraphIdentityService.ensureIdentity('source-answer-a')
    dbh.db.transaction(
      (tx) => {
        sessionGraphIdentityService.mapCopyTx(tx, 'source-question', 'copy-question')
        sessionGraphIdentityService.mapCopyTx(tx, 'source-answer-a', 'copy-answer-a')
      },
      { behavior: 'immediate' }
    )

    expect(sessionGraphIdentityService.getIdentity('copy-question')).toEqual(
      sessionGraphIdentityService.getIdentity('source-question')
    )
    expect(sessionGraphIdentityService.getIdentity('copy-answer-a')).toEqual(sourceAnswer)
    expect(sessionGraphIdentityService.getIdentity('copy-answer-b')).toBeNull()
    expect(() => sessionGraphIdentityService.mapCopyTx(dbh.db, 'source-answer-a', 'copy-question')).toThrow(
      /role mismatch/
    )

    const snapshotPath = join(dirname(dbh.sqlite.name), 'session-graph-snapshot.db')
    snapshotTo(dbh.sqlite, snapshotPath)
    const snapshot = new Database(snapshotPath, { readonly: true })
    try {
      const copies = snapshot
        .prepare('SELECT message_id, graph_message_id FROM session_graph_message_copy ORDER BY message_id')
        .all() as Array<{ message_id: string; graph_message_id: string }>
      expect(copies).toHaveLength(4)
      expect(copies.find((row) => row.message_id === 'copy-answer-a')?.graph_message_id).toBe(
        sourceAnswer.graphMessageId
      )
      expect(snapshot.pragma('foreign_key_check')).toEqual([])
    } finally {
      snapshot.close()
    }

    dbh.db.delete(topicTable).where(eq(topicTable.id, 'original')).run()
    expect(sessionGraphIdentityService.getIdentity('source-answer-a')).toBeNull()
    expect(sessionGraphIdentityService.getIdentity('copy-answer-a')).toEqual(sourceAnswer)
    expect(dbh.db.select().from(sessionGraphMessageCopyTable).all()).toHaveLength(2)
  })
})
