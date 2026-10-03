import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { applyMigrations } from '@data/db/applyMigrations'
import { snapshotTo } from '@data/db/restore/snapshot'
import { sessionGraphCategoryTable, sessionGraphTopicCategoryTable } from '@data/db/schemas/sessionGraphCategory'
import { topicTable } from '@data/db/schemas/topic'
import { sessionGraphCategoryService as service } from '@data/services/SessionGraphCategoryService'
import { tagService } from '@data/services/TagService'
import { topicService } from '@data/services/TopicService'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

describe('SessionGraphCategoryService', () => {
  const dbh = setupTestDatabase()
  const topic = (id: string) => dbh.db.insert(topicTable).values({ id, orderKey: id }).run()

  it('uses stable IDs and complete paths for names reused under different parents', () => {
    const network = service.create({ name: 'Computing' })
    const history = service.create({ name: 'History' })
    const first = service.create({ name: 'Architecture', parentId: network.id })
    const second = service.create({ name: 'Architecture', parentId: history.id })
    const root = service.create({ name: 'Architecture' })
    expect(new Set([first.id, second.id, root.id]).size).toBe(3)
    expect(first.path).toEqual([
      { id: network.id, name: 'Computing' },
      { id: first.id, name: 'Architecture' }
    ])
    expect(second.path).toEqual([
      { id: history.id, name: 'History' },
      { id: second.id, name: 'Architecture' }
    ])
    expect(root.path).toEqual([{ id: root.id, name: 'Architecture' }])
    const ordinary = tagService.create({ name: 'Architecture' })
    expect(tagService.getById(ordinary.id)).toEqual(ordinary)
    expect(tagService.list()).toHaveLength(1)
    expect(service.list()).toHaveLength(5)
  })

  it('rejects duplicate root and sibling names atomically, including conflicting moves and renames', () => {
    const first = service.create({ name: 'Root' })
    const second = service.create({ name: 'Other' })
    const child = service.create({ name: 'Child', parentId: first.id })
    const otherChild = service.create({ name: 'Child', parentId: second.id })
    const before = service.list()
    expect(() => service.create({ name: 'Root' })).toThrow(/same parent/)
    expect(() => service.create({ name: 'Child', parentId: first.id })).toThrow(/same parent/)
    expect(() => service.update(second.id, { name: 'Root' })).toThrow(/same parent/)
    expect(() => service.update(otherChild.id, { parentId: first.id, color: '#123456' })).toThrow(/same parent/)
    expect(service.list()).toEqual(before)
    expect(service.list().find((item) => item.id === child.id)?.parentId).toBe(first.id)
  })

  it('updates descendant paths without changing identities or topic membership after move and rename', () => {
    topic('sdn')
    const root = service.create({ name: 'Computing' })
    const other = service.create({ name: 'Infrastructure' })
    const child = service.create({ name: 'Networks', parentId: root.id })
    const leaf = service.create({ name: 'VXLAN', parentId: child.id })
    service.setTopicCategories('sdn', [leaf.id])
    expect(service.getTopicIds(root.id, true)).toEqual(['sdn'])
    service.update(child.id, { parentId: other.id, name: 'Overlays', color: '#123456' })
    expect(service.getTopicCategories('sdn')[0]).toMatchObject({
      id: leaf.id,
      path: [
        { id: other.id, name: 'Infrastructure' },
        { id: child.id, name: 'Overlays' },
        { id: leaf.id, name: 'VXLAN' }
      ]
    })
    expect(service.getTopicIds(root.id, true)).toEqual([])
    expect(service.getTopicIds(other.id, true)).toEqual(['sdn'])
    expect(service.update(child.id, { parentId: null, color: null })).toMatchObject({
      id: child.id,
      parentId: null,
      color: null
    })
    expect(service.getTopicCategories('sdn')[0].path.map((item) => item.id)).toEqual([child.id, leaf.id])
  })

  it('rejects cycles and missing parents before publishing or changing any category', () => {
    const root = service.create({ name: 'Root' })
    const child = service.create({ name: 'Child', parentId: root.id })
    const leaf = service.create({ name: 'Leaf', parentId: child.id })
    const before = service.list()
    vi.mocked(notifyDataApiDataChange).mockClear()
    expect(() => service.update(root.id, { parentId: root.id })).toThrow(/descendants/)
    expect(() => service.update(root.id, { parentId: leaf.id, name: 'Broken' })).toThrow(/descendants/)
    expect(() => service.create({ name: 'Orphan', parentId: 'missing' })).toThrow(/not found/)
    expect(() => service.update(child.id, { parentId: 'missing' })).toThrow(/not found/)
    expect(service.list()).toEqual(before)
    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('rejects nonempty category deletion and permits explicit cleanup without destroying other categories', () => {
    topic('topic')
    const root = service.create({ name: 'Root' })
    const child = service.create({ name: 'Child', parentId: root.id })
    service.setTopicCategories('topic', [child.id])
    expect(() => service.delete(root.id)).toThrow(/child categories/)
    expect(() => service.delete(child.id)).toThrow(/topic associations/)
    expect(service.getTopicCategories('topic').map((item) => item.id)).toEqual([child.id])
    service.setTopicCategories('topic', [])
    service.delete(child.id)
    service.delete(root.id)
    expect(service.list()).toEqual([])
    expect(() => service.delete(root.id)).toThrow(/not found/)
  })

  it('supports several categories per topic and rejects missing categories without losing existing bindings', () => {
    topic('topic')
    const first = service.create({ name: 'First' })
    const second = service.create({ name: 'Second' })
    service.setTopicCategories('topic', [first.id, second.id, first.id])
    expect(service.getTopicCategories('topic').map((item) => item.id)).toEqual([first.id, second.id])
    vi.mocked(notifyDataApiDataChange).mockClear()
    expect(() => service.setTopicCategories('topic', [second.id, 'missing'])).toThrow(/not found/)
    expect(() => service.setTopicCategories('missing-topic', [first.id])).toThrow(/not found/)
    expect(service.getTopicCategories('topic').map((item) => item.id)).toEqual([first.id, second.id])
    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
    service.setTopicCategories('topic', [])
    expect(service.getTopicCategories('topic')).toEqual([])
  })

  it('filters by category identity, optionally includes descendants, and returns each active topic once', () => {
    for (const id of ['direct', 'child', 'deep', 'other', 'trashed']) topic(id)
    const root = service.create({ name: 'Computing' })
    const history = service.create({ name: 'History' })
    const child = service.create({ name: 'Architecture', parentId: root.id })
    const other = service.create({ name: 'Architecture', parentId: history.id })
    const leaf = service.create({ name: 'Networking', parentId: child.id })
    service.setTopicCategories('direct', [root.id, child.id])
    service.setTopicCategories('child', [child.id, leaf.id])
    service.setTopicCategories('deep', [leaf.id])
    service.setTopicCategories('other', [other.id])
    service.setTopicCategories('trashed', [leaf.id])
    topicService.delete('trashed')
    expect(service.getTopicIds(root.id)).toEqual(['direct'])
    expect(service.getTopicIds(root.id, true)).toEqual(['child', 'deep', 'direct'])
    expect(service.getTopicIds(other.id, true)).toEqual(['other'])
    expect(() => service.getTopicIds('missing')).toThrow(/not found/)
    expect(() => service.setTopicCategories('trashed', [])).toThrow(/not found/)
    expect(() => service.getTopicCategories('trashed')).toThrow(/not found/)
    topicService.restore('trashed')
    expect(service.getTopicCategories('trashed').map((item) => item.id)).toEqual([leaf.id])
    dbh.db.delete(topicTable).where(eq(topicTable.id, 'trashed')).run()
    expect(
      dbh.db
        .select()
        .from(sessionGraphTopicCategoryTable)
        .where(eq(sessionGraphTopicCategoryTable.topicId, 'trashed'))
        .all()
    ).toEqual([])
  })

  it('rolls back replacement bindings and emits no successful-write signal when insertion fails', () => {
    topic('topic')
    const first = service.create({ name: 'First' })
    const second = service.create({ name: 'Second' })
    service.setTopicCategories('topic', [first.id])
    vi.mocked(notifyDataApiDataChange).mockClear()
    dbh.sqlite.exec(
      "CREATE TEMP TRIGGER reject_category_binding BEFORE INSERT ON session_graph_topic_category BEGIN SELECT RAISE(ABORT, 'binding failed'); END"
    )
    try {
      expect(() => service.setTopicCategories('topic', [second.id])).toThrow(/binding failed/)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_category_binding')
    }
    expect(service.getTopicCategories('topic').map((item) => item.id)).toEqual([first.id])
    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('publishes refresh effects only after the data can be read as committed', () => {
    topic('topic')
    const observer = new Database(dbh.sqlite.name, { readonly: true })
    const readAtPublish: string[] = []
    vi.mocked(notifyDataApiDataChange).mockImplementation((effects) => {
      if (effects.some((effect) => effect.endpoint === '/session-graph/categories')) {
        const committed = observer.prepare('SELECT name FROM session_graph_category ORDER BY name').all() as Array<{
          name: string
        }>
        readAtPublish.push(...committed.map((item) => item.name))
      }
    })
    try {
      const category = service.create({ name: 'Networks' })
      expect(readAtPublish).toEqual(['Networks'])
      service.setTopicCategories('topic', [category.id])
      expect(notifyDataApiDataChange).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          { endpoint: '/topics/:topicId/session-graph-categories', routeParams: { topicId: 'topic' } },
          { endpoint: '/session-graph/categories/:id/topics' }
        ])
      )
    } finally {
      vi.mocked(notifyDataApiDataChange).mockReset()
      observer.close()
    }
  })

  it('retains stable category paths and multi-category bindings in a restored SQLite snapshot', () => {
    topic('topic')
    const root = service.create({ name: 'Networks' })
    const leaf = service.create({ name: 'VXLAN', parentId: root.id })
    service.setTopicCategories('topic', [root.id, leaf.id])
    const before = service.getTopicCategories('topic')
    const snapshot = join(dirname(dbh.sqlite.name), 'category-snapshot.db')
    const restoredPath = join(dirname(dbh.sqlite.name), 'category-restored.db')
    snapshotTo(dbh.sqlite, snapshot)
    service.update(root.id, { name: 'Changed after backup' })
    service.setTopicCategories('topic', [])
    copyFileSync(snapshot, restoredPath)
    const restored = new Database(restoredPath)
    try {
      restored.pragma('foreign_keys = ON')
      const restoredDb = drizzle({ client: restored, casing: 'snake_case' })
      applyMigrations(restoredDb, resolveMigrationsPath())
      MockMainDbServiceUtils.setDb(restoredDb)
      expect(service.getTopicCategories('topic')).toEqual(before)
      expect(service.getTopicIds(root.id, true)).toEqual(['topic'])
      expect(restored.pragma('foreign_key_check')).toEqual([])
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      MockMainDbServiceUtils.setDb(dbh.db)
      restored.close()
    }
    expect(service.getTopicCategories('topic')).toEqual([])
  })

  it('supports deeper category chains without a fixed UI depth cutoff', () => {
    let parent = service.create({ name: 'Level 0' })
    const rootId = parent.id
    for (let level = 1; level <= 70; level++) parent = service.create({ name: `Level ${level}`, parentId: parent.id })
    expect(parent.path).toHaveLength(71)
    expect(parent.path[0].id).toBe(rootId)
    expect(() => service.update(rootId, { parentId: parent.id })).toThrow(/descendants/)
    expect(dbh.db.select().from(sessionGraphCategoryTable).all()).toHaveLength(71)
  })
})
