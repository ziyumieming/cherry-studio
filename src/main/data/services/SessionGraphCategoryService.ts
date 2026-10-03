import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import {
  sessionGraphCategoryTable,
  type SessionGraphCategoryRow,
  sessionGraphTopicCategoryTable
} from '@data/db/schemas/sessionGraphCategory'
import { topicTable } from '@data/db/schemas/topic'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  CreateSessionGraphCategoryDto,
  UpdateSessionGraphCategoryDto
} from '@shared/data/api/schemas/sessionGraphCategories'
import { SESSION_GRAPH_CATEGORY_ORDER } from '@shared/data/api/schemas/sessionGraphCategories'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import type { SessionGraphCategory } from '@shared/data/types/sessionGraphCategory'

import { timestampToISO } from './utils/rowMappers'

function categoryPath(
  row: SessionGraphCategoryRow,
  rows: ReadonlyMap<string, SessionGraphCategoryRow>
): SessionGraphCategory['path'] {
  const path: SessionGraphCategory['path'] = []
  const seen = new Set<string>()
  let current: SessionGraphCategoryRow | undefined = row
  while (current) {
    if (seen.has(current.id))
      throw DataApiErrorFactory.dataInconsistent('SessionGraphCategory', 'Category hierarchy contains a cycle')
    seen.add(current.id)
    path.push({ id: current.id, name: current.name })
    if (!current.parentId) break
    const parent = rows.get(current.parentId)
    if (!parent) throw DataApiErrorFactory.dataInconsistent('SessionGraphCategory', 'Category parent is missing')
    current = parent
  }
  return path.reverse()
}

function categories(rows: SessionGraphCategoryRow[]): SessionGraphCategory[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  return rows.map((row) => ({
    ...row,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt),
    path: categoryPath(row, byId)
  }))
}

function notifyCategoriesChanged(kind: 'membership' | 'projection', orderChanged = false): void {
  const effects: DataApiDataChangeEffect[] = [
    { endpoint: '/session-graph/categories', kind },
    { endpoint: '/session-graph/categories/:id/topics' }
  ]
  if (kind === 'projection') {
    // Paths embedded in topic categories can change for every descendant.
    effects.push({ endpoint: '/topics/:topicId/session-graph-categories', kind: 'projection' })
  }
  if (orderChanged) {
    effects.push(
      { endpoint: '/session-graph/categories', kind: 'order', dimension: SESSION_GRAPH_CATEGORY_ORDER },
      { endpoint: '/topics/:topicId/session-graph-categories', kind: 'order', dimension: SESSION_GRAPH_CATEGORY_ORDER }
    )
  }
  notifyDataApiDataChange(effects)
}

export class SessionGraphCategoryService {
  private rows(tx: Pick<DbOrTx, 'select'>): SessionGraphCategoryRow[] {
    return tx
      .select()
      .from(sessionGraphCategoryTable)
      .orderBy(asc(sessionGraphCategoryTable.name), asc(sessionGraphCategoryTable.id))
      .all()
  }

  private assertTopic(tx: DbOrTx, topicId: string): void {
    const [topic] = tx
      .select({ id: topicTable.id })
      .from(topicTable)
      .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
      .limit(1)
      .all()
    if (!topic) throw DataApiErrorFactory.notFound('Topic', topicId)
  }

  private assertParent(rows: SessionGraphCategoryRow[], parentId: string | null, id?: string): void {
    if (!parentId) return
    const byId = new Map(rows.map((row) => [row.id, row]))
    const parent = byId.get(parentId)
    if (!parent) throw DataApiErrorFactory.notFound('SessionGraphCategory', parentId)
    if (categoryPath(parent, byId).some((item) => item.id === id)) {
      throw DataApiErrorFactory.invalidOperation(
        'Cannot move a category below itself or its descendants',
        'SessionGraphCategory'
      )
    }
  }

  list(): SessionGraphCategory[] {
    return categories(this.rows(application.get('DbService').getDb()))
  }

  create(dto: CreateSessionGraphCategoryDto): SessionGraphCategory {
    const result = application.get('DbService').withWriteTx((tx) => {
      this.assertParent(this.rows(tx), dto.parentId ?? null)
      const [row] = withSqliteErrors(
        () =>
          tx
            .insert(sessionGraphCategoryTable)
            .values({ name: dto.name, parentId: dto.parentId ?? null, color: dto.color ?? null })
            .returning()
            .all(),
        {
          ...defaultHandlersFor('SessionGraphCategory', dto.name),
          unique: () =>
            DataApiErrorFactory.conflict(
              'A category with this name already exists under the same parent',
              'SessionGraphCategory'
            )
        }
      )
      return categories(this.rows(tx)).find((item) => item.id === row.id)!
    })
    notifyCategoriesChanged('membership')
    return result
  }

  update(id: string, dto: UpdateSessionGraphCategoryDto): SessionGraphCategory {
    const result = application.get('DbService').withWriteTx((tx) => {
      const rows = this.rows(tx)
      const existing = rows.find((row) => row.id === id)
      if (!existing) throw DataApiErrorFactory.notFound('SessionGraphCategory', id)
      this.assertParent(rows, dto.parentId === undefined ? existing.parentId : dto.parentId, id)
      const updates: Partial<typeof sessionGraphCategoryTable.$inferInsert> = {}
      if (dto.name !== undefined) updates.name = dto.name
      if (dto.color !== undefined) updates.color = dto.color
      if (dto.parentId !== undefined) updates.parentId = dto.parentId
      if (Object.keys(updates).length) {
        withSqliteErrors(
          () => tx.update(sessionGraphCategoryTable).set(updates).where(eq(sessionGraphCategoryTable.id, id)).run(),
          {
            ...defaultHandlersFor('SessionGraphCategory', id),
            unique: () =>
              DataApiErrorFactory.conflict(
                'A category with this name already exists under the same parent',
                'SessionGraphCategory'
              )
          }
        )
      }
      return categories(this.rows(tx)).find((item) => item.id === id)!
    })
    notifyCategoriesChanged('projection', dto.name !== undefined)
    return result
  }

  delete(id: string): void {
    application.get('DbService').withWriteTx((tx) => {
      if (!this.rows(tx).some((row) => row.id === id)) throw DataApiErrorFactory.notFound('SessionGraphCategory', id)
      const [child] = tx
        .select({ id: sessionGraphCategoryTable.id })
        .from(sessionGraphCategoryTable)
        .where(eq(sessionGraphCategoryTable.parentId, id))
        .limit(1)
        .all()
      const [binding] = tx
        .select({ topicId: sessionGraphTopicCategoryTable.topicId })
        .from(sessionGraphTopicCategoryTable)
        .where(eq(sessionGraphTopicCategoryTable.categoryId, id))
        .limit(1)
        .all()
      const blocked = () =>
        DataApiErrorFactory.invalidOperation(
          'Delete category',
          'Move child categories and remove topic associations first'
        )
      if (child || binding) throw blocked()
      withSqliteErrors(() => tx.delete(sessionGraphCategoryTable).where(eq(sessionGraphCategoryTable.id, id)).run(), {
        ...defaultHandlersFor('SessionGraphCategory', id),
        foreignKey: blocked
      })
    })
    notifyCategoriesChanged('membership')
  }

  getTopicCategories(topicId: string): SessionGraphCategory[] {
    const db = application.get('DbService').getDb()
    this.assertTopic(db, topicId)
    const bindings = db
      .select()
      .from(sessionGraphTopicCategoryTable)
      .where(eq(sessionGraphTopicCategoryTable.topicId, topicId))
      .all()
    const ids = new Set(bindings.map((row) => row.categoryId))
    return categories(this.rows(db)).filter((item) => ids.has(item.id))
  }

  /** Copy memberships into a newly created topic inside the caller's duplication transaction. */
  copyTopicCategoriesTx(tx: Pick<DbOrTx, 'select' | 'insert'>, sourceTopicId: string, targetTopicId: string): void {
    const bindings = tx
      .select({ categoryId: sessionGraphTopicCategoryTable.categoryId })
      .from(sessionGraphTopicCategoryTable)
      .where(eq(sessionGraphTopicCategoryTable.topicId, sourceTopicId))
      .all()
    if (bindings.length)
      tx.insert(sessionGraphTopicCategoryTable)
        .values(bindings.map(({ categoryId }) => ({ topicId: targetTopicId, categoryId })))
        .run()
  }

  setTopicCategories(topicId: string, categoryIds: string[]): void {
    application.get('DbService').withWriteTx((tx) => {
      this.assertTopic(tx, topicId)
      const ids = [...new Set(categoryIds)]
      const available = new Set(this.rows(tx).map((row) => row.id))
      for (const id of ids) if (!available.has(id)) throw DataApiErrorFactory.notFound('SessionGraphCategory', id)
      tx.delete(sessionGraphTopicCategoryTable).where(eq(sessionGraphTopicCategoryTable.topicId, topicId)).run()
      if (ids.length)
        tx.insert(sessionGraphTopicCategoryTable)
          .values(ids.map((categoryId) => ({ topicId, categoryId })))
          .run()
    })
    notifyDataApiDataChange([
      { endpoint: '/topics/:topicId/session-graph-categories', kind: 'membership', routeParams: { topicId } },
      { endpoint: '/session-graph/categories/:id/topics' }
    ])
  }

  getCategoryIdsTx(tx: Pick<DbOrTx, 'select'>, id: string, includeDescendants = false): string[] {
    const rows = this.rows(tx)
    if (!rows.some((row) => row.id === id)) throw DataApiErrorFactory.notFound('SessionGraphCategory', id)
    return includeDescendants
      ? categories(rows)
          .filter((row) => row.path.some((item) => item.id === id))
          .map((row) => row.id)
      : [id]
  }

  getTopicIds(id: string, includeDescendants = false): string[] {
    const db = application.get('DbService').getDb()
    const ids = this.getCategoryIdsTx(db, id, includeDescendants)
    return db
      .selectDistinct({ id: topicTable.id })
      .from(sessionGraphTopicCategoryTable)
      .innerJoin(topicTable, eq(sessionGraphTopicCategoryTable.topicId, topicTable.id))
      .where(and(inArray(sessionGraphTopicCategoryTable.categoryId, ids), isNull(topicTable.deletedAt)))
      .orderBy(asc(topicTable.id))
      .all()
      .map((row) => row.id)
  }
}

export const sessionGraphCategoryService = new SessionGraphCategoryService()
