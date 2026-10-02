import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { uuidPrimaryKeyOrdered } from './_columnHelpers'
import { messageTable } from './message'

export const sessionGraphTurnTable = sqliteTable('session_graph_turn', {
  id: uuidPrimaryKeyOrdered(),
  createdAt: integer().notNull().$defaultFn(Date.now)
})

export const sessionGraphMessageTable = sqliteTable(
  'session_graph_message',
  {
    id: uuidPrimaryKeyOrdered(),
    turnId: text()
      .notNull()
      .references(() => sessionGraphTurnTable.id, { onDelete: 'restrict' }),
    role: text({ enum: ['user', 'assistant'] }).notNull(),
    createdAt: integer().notNull().$defaultFn(Date.now)
  },
  (t) => [
    index('session_graph_message_turn_id_idx').on(t.turnId),
    check('session_graph_message_role_check', sql`${t.role} IN ('user', 'assistant')`)
  ]
)

export const sessionGraphMessageCopyTable = sqliteTable(
  'session_graph_message_copy',
  {
    messageId: text()
      .primaryKey()
      .references(() => messageTable.id, { onDelete: 'cascade' }),
    graphMessageId: text()
      .notNull()
      .references(() => sessionGraphMessageTable.id, { onDelete: 'restrict' })
  },
  (t) => [index('session_graph_message_copy_graph_message_id_idx').on(t.graphMessageId)]
)

export type SessionGraphTurnRow = typeof sessionGraphTurnTable.$inferSelect
export type SessionGraphMessageRow = typeof sessionGraphMessageTable.$inferSelect
export type SessionGraphMessageCopyRow = typeof sessionGraphMessageCopyTable.$inferSelect
