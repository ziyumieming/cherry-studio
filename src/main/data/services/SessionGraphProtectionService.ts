import { and, eq, inArray, isNull } from 'drizzle-orm'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { sessionGraphAncestorLockTable } from '@data/db/schemas/sessionGraph'
import { topicTable } from '@data/db/schemas/topic'
import type { DbOrTx } from '@data/db/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { TopicHistoryProtection } from '@shared/data/api/schemas/messages'

const SQLITE_INARRAY_CHUNK = 500
const SQLITE_INSERT_CHUNK = 100

export class SessionGraphProtectionService {
  getTopicProtection(topicId: string): TopicHistoryProtection {
    const db = application.get('DbService').getDb()
    const [topic] = db
      .select({ id: topicTable.id })
      .from(topicTable)
      .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
      .limit(1)
      .all()
    if (!topic) throw DataApiErrorFactory.notFound('Topic', topicId)
    const rows = db
      .select({
        id: messageTable.id,
        parentId: messageTable.parentId,
        role: messageTable.role,
        siblingsGroupId: messageTable.siblingsGroupId,
        lockedId: sessionGraphAncestorLockTable.messageId
      })
      .from(messageTable)
      .leftJoin(sessionGraphAncestorLockTable, eq(messageTable.id, sessionGraphAncestorLockTable.messageId))
      .where(and(eq(messageTable.topicId, topicId), isNull(messageTable.deletedAt)))
      .all()
    const locked = new Set(rows.filter((row) => row.lockedId !== null).map((row) => row.id))
    const deleteBlocked = new Set(locked)
    for (const row of rows) {
      if (locked.has(row.id) && row.parentId) deleteBlocked.add(row.parentId)
    }
    const groupKey = (row: (typeof rows)[number]) =>
      row.siblingsGroupId > 0 ? `${row.parentId}:${row.siblingsGroupId}` : row.id
    const blockedGroups = new Set(
      rows.filter((row) => row.role === 'assistant' && deleteBlocked.has(row.id)).map(groupKey)
    )
    return {
      lockedMessageIds: [...locked],
      deleteBlockedMessageIds: [...deleteBlocked],
      replyGroupDeleteBlockedMessageIds: rows
        .filter((row) => row.role === 'assistant' && blockedGroups.has(groupKey(row)))
        .map((row) => row.id),
      regenerateBlockedMessageIds: rows
        .filter((row) => locked.has(row.id) || (row.role === 'assistant' && row.parentId && locked.has(row.parentId)))
        .map((row) => row.id)
    }
  }

  lockCopiedPathTx(tx: DbOrTx, copiedMessageIds: ReadonlyMap<string, string>): void {
    const messageIds = [...new Set([...copiedMessageIds.keys(), ...copiedMessageIds.values()])]
    const lockedAt = Date.now()
    for (let i = 0; i < messageIds.length; i += SQLITE_INSERT_CHUNK) {
      tx.insert(sessionGraphAncestorLockTable)
        .values(messageIds.slice(i, i + SQLITE_INSERT_CHUNK).map((messageId) => ({ messageId, lockedAt })))
        .onConflictDoNothing()
        .run()
    }
  }

  assertMutableTx(tx: DbOrTx, messageIds: readonly string[], operation: string): void {
    for (let i = 0; i < messageIds.length; i += SQLITE_INARRAY_CHUNK) {
      const [locked] = tx
        .select({ messageId: sessionGraphAncestorLockTable.messageId })
        .from(sessionGraphAncestorLockTable)
        .where(inArray(sessionGraphAncestorLockTable.messageId, messageIds.slice(i, i + SQLITE_INARRAY_CHUNK)))
        .limit(1)
        .all()
      if (locked) {
        throw DataApiErrorFactory.invalidOperation(operation, 'shared ancestor history is read-only')
      }
    }
  }
}

export const sessionGraphProtectionService = new SessionGraphProtectionService()
