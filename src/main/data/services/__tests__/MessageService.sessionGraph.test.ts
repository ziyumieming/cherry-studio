import { dirname, join } from 'node:path'

import { setupTestDatabase, withRoot } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { snapshotTo } from '@data/db/restore/snapshot'
import { messageTable } from '@data/db/schemas/message'
import { sessionGraphAncestorLockTable } from '@data/db/schemas/sessionGraph'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import { sessionGraphProtectionService } from '@data/services/SessionGraphProtectionService'
import { topicService } from '@data/services/TopicService'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

describe('shared ancestor write protection', () => {
  const dbh = setupTestDatabase()
  const data = { parts: [{ type: 'text' as const, text: 'Changed content' }] }
  const originalData = { parts: [{ type: 'text' as const, text: 'SDN and VXLAN' }] }

  function seedFork() {
    dbh.db.insert(topicTable).values({ id: 'source', orderKey: 'a0', activeNodeId: null }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('source', [
          { id: 'question', topicId: 'source', parentId: null, role: 'user', data: originalData, status: 'success' },
          {
            id: 'answer',
            topicId: 'source',
            parentId: 'question',
            role: 'assistant',
            data: originalData,
            status: 'paused',
            siblingsGroupId: 42
          },
          {
            id: 'alternative',
            topicId: 'source',
            parentId: 'question',
            role: 'assistant',
            data: originalData,
            status: 'success',
            siblingsGroupId: 42
          }
        ])
      )
      .run()
    const fork = topicService.duplicate('source', { nodeId: 'answer' })
    const copiedPath = messageService.getPathRowsToNodeTx(dbh.db, fork.activeNodeId!)
    return {
      source: { topicId: 'source', questionId: 'question', answerId: 'answer' },
      fork: { topicId: fork.id, questionId: copiedPath[0].id, answerId: copiedPath[1].id }
    }
  }

  type History = ReturnType<typeof seedFork>['source']
  const operations: Array<[string, (history: History) => unknown]> = [
    ['edit question', (h) => messageService.update(h.questionId, { data })],
    ['edit answer', (h) => messageService.update(h.answerId, { data })],
    ['edit and resend', (h) => messageService.createSibling(h.questionId, data)],
    ['regenerate sibling', (h) => messageService.createSibling(h.answerId, data)],
    ['regroup answer', (h) => messageService.updateSiblingsGroupId(h.answerId, 100)],
    ['delete answer', (h) => messageService.delete(h.answerId)],
    ['delete subtree', (h) => messageService.delete(h.questionId, true)],
    ['delete answer group', (h) => messageService.deleteReplyGroup(h.answerId)],
    ['clear topic', (h) => messageService.clearTopicMessages(h.topicId)],
    ['retry answer', (h) => messageService.resetAssistantForRetry(h.answerId)],
    ['finalize answer', (h) => messageService.finalizeAssistantMessage(h.answerId, { data, status: 'success' })],
    ['create answer', (h) => messageService.create(h.topicId, { parentId: h.questionId, role: 'assistant', data })],
    [
      'reserve regenerated answer',
      (h) =>
        messageService.createUserMessageWithPlaceholders({
          topicId: h.topicId,
          userMessage: { mode: 'existing', id: h.questionId },
          siblingsGroupId: 100,
          placeholders: [{ role: 'assistant', data: { parts: [] } }]
        })
    ]
  ]

  describe.each(['source', 'fork'] as const)('%s history', (side) => {
    it.each(operations)('rejects %s without changing history or the active path', (_, operation) => {
      const history = seedFork()[side]
      const beforeMessages = dbh.db.select().from(messageTable).all()
      const beforeTopics = dbh.db.select().from(topicTable).all()
      try {
        operation(history)
        expect.fail('Shared ancestor operation should have been rejected')
      } catch (error) {
        expect(error).toBeInstanceOf(DataApiError)
        expect(error).toMatchObject({
          code: ErrorCode.INVALID_OPERATION,
          details: { reason: 'shared ancestor history is read-only' }
        })
      }
      expect(dbh.db.select().from(messageTable).all()).toEqual(beforeMessages)
      expect(dbh.db.select().from(topicTable).all()).toEqual(beforeTopics)
    })
  })

  it('allows new questions in both topics and keeps uncopied replies editable', () => {
    const histories = seedFork()
    for (const history of Object.values(histories)) {
      const next = messageService.createUserMessageWithPlaceholders({
        topicId: history.topicId,
        userMessage: { mode: 'create', dto: { role: 'user', parentId: history.answerId, data, status: 'success' } },
        placeholders: [{ role: 'assistant', data: { parts: [] } }]
      })
      expect(next.userMessage.parentId).toBe(history.answerId)
      messageService.finalizeAssistantMessage(next.placeholders[0].id, { data, status: 'success' })
      expect(messageService.update(next.userMessage.id, { data }).data).toEqual(data)
    }
    expect(messageService.update('alternative', { data }).id).toBe('alternative')
    expect(() => messageService.createSibling('alternative', data)).toThrow(/shared ancestor/)
    expect(() => messageService.deleteReplyGroup('alternative')).toThrow(/shared ancestor/)
    expect(messageService.delete('alternative').deletedIds).toEqual(['alternative'])
  })

  it('keeps source locks after removing the other topic and after restoring a snapshot', () => {
    const { source, fork } = seedFork()
    dbh.db.delete(topicTable).where(eq(topicTable.id, fork.topicId)).run()
    expect(() => messageService.update(source.questionId, { data })).toThrow(/shared ancestor/)

    const snapshotPath = join(dirname(dbh.sqlite.name), 'protected-history.db')
    snapshotTo(dbh.sqlite, snapshotPath)
    const restored = new Database(snapshotPath)
    try {
      const restoredDb = drizzle({ client: restored, casing: 'snake_case' })
      expect(() => sessionGraphProtectionService.assertMutableTx(restoredDb, [source.answerId], 'edit answer')).toThrow(
        /shared ancestor/
      )
      expect(restored.prepare('SELECT message_id FROM session_graph_ancestor_lock ORDER BY message_id').all()).toEqual([
        { message_id: 'answer' },
        { message_id: 'question' }
      ])
      expect(restored.pragma('foreign_key_check')).toEqual([])
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      restored.close()
    }
  })

  it('retains existing lock timestamps through multi-level forks and locks the new shared turn', () => {
    const { source, fork } = seedFork()
    const before = dbh.db.select().from(sessionGraphAncestorLockTable).all()
    const next = messageService.create(fork.topicId, {
      role: 'user',
      parentId: fork.answerId,
      data,
      status: 'success'
    })
    const second = topicService.duplicate(fork.topicId, { nodeId: next.id })
    const after = dbh.db.select().from(sessionGraphAncestorLockTable).all()
    for (const lock of before) expect(after.find((row) => row.messageId === lock.messageId)).toEqual(lock)
    for (const id of [source.questionId, fork.questionId, next.id, second.activeNodeId!]) {
      expect(() => messageService.update(id, { data })).toThrow(/shared ancestor/)
    }
    expect(messageService.update('alternative', { data }).data).toEqual(data)
  })

  it('rolls back the copied topic and identities if lock persistence fails', () => {
    seedFork()
    const before = {
      topics: dbh.db.select().from(topicTable).all(),
      messages: dbh.db.select().from(messageTable).all(),
      identities: dbh.sqlite.prepare('SELECT * FROM session_graph_message_copy ORDER BY message_id').all(),
      locks: dbh.db.select().from(sessionGraphAncestorLockTable).all()
    }
    dbh.sqlite.exec(`CREATE TEMP TRIGGER reject_ancestor_lock BEFORE INSERT ON session_graph_ancestor_lock
      BEGIN SELECT RAISE(ABORT, 'lock persistence failed'); END`)
    try {
      expect(() => topicService.duplicate('source', { nodeId: 'answer' })).toThrow()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_ancestor_lock')
    }
    expect(dbh.db.select().from(topicTable).all()).toEqual(before.topics)
    expect(dbh.db.select().from(messageTable).all()).toEqual(before.messages)
    expect(dbh.sqlite.prepare('SELECT * FROM session_graph_message_copy ORDER BY message_id').all()).toEqual(
      before.identities
    )
    expect(dbh.db.select().from(sessionGraphAncestorLockTable).all()).toEqual(before.locks)
  })

  it('locks every copied record on a legacy path even when no logical turn can be mapped', () => {
    dbh.db.insert(topicTable).values({ id: 'legacy', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('legacy', [
          { id: 'system', topicId: 'legacy', parentId: null, role: 'system', data, status: 'success' },
          { id: 'orphan', topicId: 'legacy', parentId: 'system', role: 'assistant', data, status: 'success' }
        ])
      )
      .run()
    const copied = topicService.duplicate('legacy', { nodeId: 'orphan' })
    expect(() => messageService.update('system', { data })).toThrow(/shared ancestor/)
    expect(() => messageService.update(copied.activeNodeId!, { data })).toThrow(/shared ancestor/)
    expect(dbh.db.select().from(sessionGraphAncestorLockTable).all()).toHaveLength(4)
  })

  it('rejects unfinished history before creating a topic, identities, or locks', () => {
    dbh.db.insert(topicTable).values({ id: 'streaming', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('streaming', [
          { id: 'pending', topicId: 'streaming', parentId: null, role: 'user', data, status: 'pending' }
        ])
      )
      .run()
    expect(() => topicService.duplicate('streaming', { nodeId: 'pending' })).toThrow(/still generating/)
    expect(dbh.db.select().from(topicTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(sessionGraphAncestorLockTable).all()).toHaveLength(0)
    expect(dbh.sqlite.prepare('SELECT count(*) AS n FROM session_graph_message_copy').get()).toEqual({ n: 0 })
  })
})

describe('Shared-history UI read model', () => {
  const dbh = setupTestDatabase()
  it('distinguishes shared content, regeneration, and hidden reply-group members across topics', () => {
    dbh.db.insert(topicTable).values({ id: 'protection-source', orderKey: 'a0' }).run()
    const topicId = 'protection-source'
    const data = { parts: [{ type: 'text' as const, text: 'Network question' }] }
    dbh.db
      .insert(messageTable)
      .values(
        withRoot(topicId, [
          { id: 'shared-question', topicId, parentId: null, role: 'user', data, status: 'success' },
          {
            id: 'shared-answer',
            topicId,
            parentId: 'shared-question',
            role: 'assistant',
            data,
            status: 'success',
            siblingsGroupId: 42
          },
          {
            id: 'hidden-alternative',
            topicId,
            parentId: 'shared-question',
            role: 'assistant',
            data,
            status: 'success',
            siblingsGroupId: 42
          },
          { id: 'independent-question', topicId, parentId: 'shared-answer', role: 'user', data, status: 'success' },
          {
            id: 'independent-answer',
            topicId,
            parentId: 'independent-question',
            role: 'assistant',
            data,
            status: 'success',
            siblingsGroupId: 42
          }
        ])
      )
      .run()
    const fork = topicService.duplicate(topicId, { nodeId: 'shared-answer' })
    const source = sessionGraphProtectionService.getTopicProtection(topicId)
    expect(source.lockedMessageIds.sort()).toEqual(['shared-answer', 'shared-question'])
    expect(source.deleteBlockedMessageIds).not.toContain('hidden-alternative')
    expect(source.replyGroupDeleteBlockedMessageIds.sort()).toEqual(['hidden-alternative', 'shared-answer'])
    expect(source.regenerateBlockedMessageIds.sort()).toEqual([
      'hidden-alternative',
      'shared-answer',
      'shared-question'
    ])
    expect(source.regenerateBlockedMessageIds).not.toContain('independent-answer')
    const copied = sessionGraphProtectionService.getTopicProtection(fork.id)
    expect(copied.lockedMessageIds).toHaveLength(2)
    expect(copied.lockedMessageIds).not.toContain('shared-answer')
    expect(copied.regenerateBlockedMessageIds.sort()).toEqual(copied.lockedMessageIds.sort())
    topicService.delete(fork.id)
    expect(() => sessionGraphProtectionService.getTopicProtection(fork.id)).toThrow(DataApiError)
    expect(sessionGraphProtectionService.getTopicProtection(topicId).lockedMessageIds.sort()).toEqual(
      source.lockedMessageIds.sort()
    )
  })
  it('returns an empty protection model for ordinary history and rejects missing topics', () => {
    dbh.db.insert(topicTable).values({ id: 'ordinary', orderKey: 'a0' }).run()
    expect(sessionGraphProtectionService.getTopicProtection('ordinary')).toEqual({
      lockedMessageIds: [],
      deleteBlockedMessageIds: [],
      replyGroupDeleteBlockedMessageIds: [],
      regenerateBlockedMessageIds: []
    })
    expect(() => sessionGraphProtectionService.getTopicProtection('missing')).toThrow(DataApiError)
  })
})
