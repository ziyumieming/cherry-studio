import { eq } from 'drizzle-orm'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import {
  sessionGraphMessageCopyTable,
  sessionGraphMessageTable,
  sessionGraphTurnTable
} from '@data/db/schemas/sessionGraph'
import type { DbOrTx } from '@data/db/types'

type MessageIdentity = { turnId: string; graphMessageId: string }

export class SessionGraphIdentityService {
  getIdentity(messageId: string): MessageIdentity | null {
    return this.getIdentityTx(application.get('DbService').getDb(), messageId)
  }

  getIdentityTx(tx: DbOrTx, messageId: string): MessageIdentity | null {
    const [row] = tx
      .select({ turnId: sessionGraphMessageTable.turnId, graphMessageId: sessionGraphMessageTable.id })
      .from(sessionGraphMessageCopyTable)
      .innerJoin(sessionGraphMessageTable, eq(sessionGraphMessageCopyTable.graphMessageId, sessionGraphMessageTable.id))
      .where(eq(sessionGraphMessageCopyTable.messageId, messageId))
      .limit(1)
      .all()
    return row ?? null
  }

  ensureIdentity(messageId: string): MessageIdentity {
    return application.get('DbService').withWriteTx((tx) => this.ensureIdentityTx(tx, messageId))
  }

  ensureIdentityTx(tx: DbOrTx, messageId: string): MessageIdentity {
    const existing = this.getIdentityTx(tx, messageId)
    if (existing) return existing

    const [message] = tx
      .select({ parentId: messageTable.parentId, role: messageTable.role })
      .from(messageTable)
      .where(eq(messageTable.id, messageId))
      .limit(1)
      .all()
    if (!message) throw new Error(`Message not found: ${messageId}`)
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error(`Cannot map ${message.role} message: ${messageId}`)
    }

    let turnId: string
    if (message.role === 'user') {
      const [turn] = tx.insert(sessionGraphTurnTable).values({}).returning({ id: sessionGraphTurnTable.id }).all()
      turnId = turn.id
    } else {
      const [parent] = tx
        .select({ role: messageTable.role })
        .from(messageTable)
        .where(eq(messageTable.id, message.parentId!))
        .limit(1)
        .all()
      if (parent?.role !== 'user') throw new Error(`Assistant message has no user parent: ${messageId}`)
      turnId = this.ensureIdentityTx(tx, message.parentId!).turnId
    }

    const [graphMessage] = tx
      .insert(sessionGraphMessageTable)
      .values({ turnId, role: message.role })
      .returning({ id: sessionGraphMessageTable.id })
      .all()
    tx.insert(sessionGraphMessageCopyTable).values({ messageId, graphMessageId: graphMessage.id }).run()
    return { turnId, graphMessageId: graphMessage.id }
  }

  mapCopyTx(tx: DbOrTx, sourceMessageId: string, copiedMessageId: string): MessageIdentity {
    const source = this.ensureIdentityTx(tx, sourceMessageId)
    const [copied] = tx
      .select({ role: messageTable.role })
      .from(messageTable)
      .where(eq(messageTable.id, copiedMessageId))
      .limit(1)
      .all()
    const [original] = tx
      .select({ role: messageTable.role })
      .from(messageTable)
      .where(eq(messageTable.id, sourceMessageId))
      .limit(1)
      .all()
    if (!copied || copied.role !== original?.role) {
      throw new Error(`Copied message role mismatch: ${copiedMessageId}`)
    }
    const existing = this.getIdentityTx(tx, copiedMessageId)
    if (existing) {
      if (existing.graphMessageId !== source.graphMessageId) {
        throw new Error(`Copied message already maps to another identity: ${copiedMessageId}`)
      }
      return existing
    }
    tx.insert(sessionGraphMessageCopyTable)
      .values({ messageId: copiedMessageId, graphMessageId: source.graphMessageId })
      .run()
    return source
  }
}

export const sessionGraphIdentityService = new SessionGraphIdentityService()
