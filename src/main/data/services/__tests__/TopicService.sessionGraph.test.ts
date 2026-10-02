import '@data/services/MessageService'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { messageTable } from '@data/db/schemas/message'
import {
  sessionGraphMessageCopyTable,
  sessionGraphMessageTable,
  sessionGraphTurnTable
} from '@data/db/schemas/sessionGraph'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import { sessionGraphIdentityService } from '@data/services/SessionGraphIdentityService'
import { topicService } from '@data/services/TopicService'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

describe('TopicService duplicate session graph mapping', () => {
  const dbh = setupTestDatabase()

  function path(topicId: string, nodeId: string) {
    return messageService.getPathRowsToNodeTx(dbh.db, nodeId, { topicId })
  }

  it('reuses ancestor identities across multiple fork levels and keeps new turns distinct', () => {
    dbh.db.insert(topicTable).values({ id: 'source', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('source', [
          {
            id: 'u1',
            topicId: 'source',
            parentId: null,
            role: 'user',
            data: { parts: [{ type: 'text', text: 'SDN?' }] },
            status: 'success'
          },
          {
            id: 'a1',
            topicId: 'source',
            parentId: 'u1',
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'VXLAN' }] },
            status: 'success'
          },
          {
            id: 'u2',
            topicId: 'source',
            parentId: 'a1',
            role: 'user',
            data: { parts: [{ type: 'text', text: 'How does VXLAN work?' }] },
            status: 'success'
          },
          {
            id: 'a2',
            topicId: 'source',
            parentId: 'u2',
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'Tunnel encapsulation' }] },
            status: 'success'
          },
          {
            id: 'other-answer',
            topicId: 'source',
            parentId: 'u1',
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'Unselected reply' }] },
            status: 'success'
          }
        ])
      )
      .run()

    const first = topicService.duplicate('source', { nodeId: 'a2' })
    const firstPath = path(first.id, first.activeNodeId!)
    expect(firstPath.map((row) => row.role)).toEqual(['user', 'assistant', 'user', 'assistant'])

    dbh.db
      .insert(messageTable)
      .values({
        id: 'new-question',
        topicId: first.id,
        parentId: first.activeNodeId!,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'What about EVPN?' }] },
        status: 'success'
      })
      .run()
    const second = topicService.duplicate(first.id, { nodeId: 'new-question' })
    const secondPath = path(second.id, second.activeNodeId!)
    expect(secondPath).toHaveLength(5)

    const third = topicService.duplicate(first.id, { nodeId: firstPath[1].id })
    const thirdPath = path(third.id, third.activeNodeId!)
    expect(thirdPath).toHaveLength(2)

    const identity = (messageId: string) => sessionGraphIdentityService.getIdentity(messageId)
    expect(identity('u1')).not.toBeNull()
    expect(identity('a1')).not.toBeNull()
    expect(identity('u2')).not.toBeNull()
    expect(identity('a2')).not.toBeNull()
    expect(identity('new-question')).not.toBeNull()
    for (const forkPath of [firstPath, secondPath, thirdPath]) {
      expect(identity(forkPath[0].id)).toEqual(identity('u1'))
      expect(identity(forkPath[1].id)).toEqual(identity('a1'))
    }
    for (const forkPath of [firstPath, secondPath]) {
      expect(identity(forkPath[2].id)).toEqual(identity('u2'))
      expect(identity(forkPath[3].id)).toEqual(identity('a2'))
    }
    expect(identity(secondPath[4].id)).toEqual(identity('new-question'))
    expect(identity('new-question')?.turnId).not.toBe(identity('u2')?.turnId)
    expect(identity('other-answer')).toBeNull()
    expect(identity('vroot-source')).toBeNull()
    expect(dbh.db.select().from(sessionGraphTurnTable).all()).toHaveLength(3)
    expect(dbh.db.select().from(sessionGraphMessageTable).all()).toHaveLength(5)
    expect(dbh.db.select().from(sessionGraphMessageCopyTable).all()).toHaveLength(16)
  })

  it('continues to copy legacy assistant-only paths without inventing a user turn', () => {
    dbh.db.insert(topicTable).values({ id: 'legacy', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('legacy', [
          {
            id: 'orphan-answer',
            topicId: 'legacy',
            parentId: null,
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'Old imported reply' }] },
            status: 'success'
          }
        ])
      )
      .run()

    const copied = topicService.duplicate('legacy', { nodeId: 'orphan-answer' })
    const copiedRows = dbh.db.select().from(messageTable).where(eq(messageTable.topicId, copied.id)).all()
    expect(copiedRows).toHaveLength(2)
    expect(sessionGraphIdentityService.getIdentity('orphan-answer')).toBeNull()
    expect(sessionGraphIdentityService.getIdentity(copied.activeNodeId!)).toBeNull()
    expect(dbh.db.select().from(sessionGraphTurnTable).all()).toHaveLength(0)
  })
})
