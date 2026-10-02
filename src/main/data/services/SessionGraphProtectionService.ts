import { inArray } from 'drizzle-orm'

import { sessionGraphAncestorLockTable } from '@data/db/schemas/sessionGraph'
import type { DbOrTx } from '@data/db/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'

const SQLITE_INARRAY_CHUNK = 500
const SQLITE_INSERT_CHUNK = 100

export class SessionGraphProtectionService {
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
