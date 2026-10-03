import { sql } from 'drizzle-orm'
import { type AnySQLiteColumn, check, index, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { topicTable } from './topic'

export const sessionGraphCategoryTable = sqliteTable(
  'session_graph_category',
  {
    id: uuidPrimaryKey(),
    parentId: text().references((): AnySQLiteColumn => sessionGraphCategoryTable.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    color: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('session_graph_category_sibling_name_idx').on(t.parentId, t.name),
    uniqueIndex('session_graph_category_root_name_idx')
      .on(t.name)
      .where(sql`${t.parentId} IS NULL`),
    check('session_graph_category_parent_check', sql`${t.parentId} IS NULL OR ${t.parentId} != ${t.id}`)
  ]
)

export const sessionGraphTopicCategoryTable = sqliteTable(
  'session_graph_topic_category',
  {
    topicId: text()
      .notNull()
      .references(() => topicTable.id, { onDelete: 'cascade' }),
    categoryId: text()
      .notNull()
      .references(() => sessionGraphCategoryTable.id, { onDelete: 'restrict' })
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.categoryId] }),
    index('session_graph_topic_category_category_id_idx').on(t.categoryId)
  ]
)

export type SessionGraphCategoryRow = typeof sessionGraphCategoryTable.$inferSelect
