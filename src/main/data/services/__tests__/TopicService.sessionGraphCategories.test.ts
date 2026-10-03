import '@data/services/MessageService'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { sessionGraphCategoryService as categories } from '@data/services/SessionGraphCategoryService'
import { topicService } from '@data/services/TopicService'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

describe('TopicService duplicate session categories', () => {
  const dbh = setupTestDatabase()

  function source() {
    dbh.db.insert(topicTable).values({ id: 'source', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('source', [
          {
            id: 'question',
            topicId: 'source',
            parentId: null,
            role: 'user',
            data: { parts: [{ type: 'text', text: 'SDN?' }] },
            status: 'success'
          },
          {
            id: 'answer',
            topicId: 'source',
            parentId: 'question',
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'VXLAN' }] },
            status: 'success'
          }
        ])
      )
      .run()
  }

  function ids(topicId: string) {
    return categories
      .getTopicCategories(topicId)
      .map((category) => category.id)
      .sort()
  }

  it('inherits all assigned category IDs without creating categories or changing their hierarchy', () => {
    source()
    const root = categories.create({ name: 'Networks' })
    const leaf = categories.create({ name: 'VXLAN', parentId: root.id })
    const other = categories.create({ name: 'History' })
    categories.setTopicCategories('source', [leaf.id, other.id])
    const before = categories.list()

    const copied = topicService.duplicate('source', { nodeId: 'answer' })

    expect(ids(copied.id)).toEqual([leaf.id, other.id].sort())
    expect(ids('source')).toEqual(ids(copied.id))
    expect(categories.list()).toEqual(before)
    expect(categories.getTopicIds(root.id)).toEqual([])
    expect(categories.getTopicIds(root.id, true)).toEqual([copied.id, 'source'].sort())
    expect(categories.getTopicIds(other.id)).toEqual([copied.id, 'source'].sort())
  })

  it('keeps assignments independent and inherits the immediate source when forking again', () => {
    source()
    const broad = categories.create({ name: 'Networks' })
    const refined = categories.create({ name: 'VXLAN', parentId: broad.id })
    const unrelated = categories.create({ name: 'History' })
    categories.setTopicCategories('source', [broad.id])
    const first = topicService.duplicate('source', { nodeId: 'answer' })

    categories.setTopicCategories(first.id, [refined.id])
    expect(ids('source')).toEqual([broad.id])
    categories.setTopicCategories('source', [unrelated.id])
    expect(ids(first.id)).toEqual([refined.id])
    const second = topicService.duplicate(first.id, { nodeId: first.activeNodeId! })
    expect(ids(second.id)).toEqual([refined.id])
    categories.setTopicCategories(first.id, [])
    expect(ids(second.id)).toEqual([refined.id])
    expect(ids('source')).toEqual([unrelated.id])
  })

  it('inherits current assignments for an earlier fork point and still rejects empty paths', () => {
    source()
    const category = categories.create({ name: 'Networks' })
    categories.setTopicCategories('source', [category.id])

    const partial = topicService.duplicate('source', { nodeId: 'question' })
    expect(ids(partial.id)).toEqual([category.id])
    const topicsBefore = dbh.db.select().from(topicTable).all()
    expect(() => topicService.duplicate('source', { nodeId: 'vroot-source' })).toThrow(/Source path is empty/)
    expect(dbh.db.select().from(topicTable).all()).toEqual(topicsBefore)
  })

  it('allows unclassified topics to be duplicated without inventing an assignment', () => {
    source()
    const copied = topicService.duplicate('source', { nodeId: 'answer' })
    expect(ids(copied.id)).toEqual([])
    expect(categories.list()).toEqual([])
  })

  it('rolls back the topic, history, identities and locks when category inheritance fails', () => {
    source()
    const category = categories.create({ name: 'Networks' })
    categories.setTopicCategories('source', [category.id])
    const tables = [
      'topic',
      'message',
      'session_graph_turn',
      'session_graph_message',
      'session_graph_message_copy',
      'session_graph_ancestor_lock',
      'session_graph_topic_category'
    ]
    const snapshot = () => tables.map((table) => dbh.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
    const before = snapshot()
    vi.mocked(notifyDataApiDataChange).mockClear()
    dbh.sqlite.exec(
      "CREATE TEMP TRIGGER reject_fork_categories BEFORE INSERT ON session_graph_topic_category WHEN NEW.topic_id != 'source' BEGIN SELECT RAISE(ABORT, 'fork category failed'); END"
    )
    try {
      expect(() => topicService.duplicate('source', { nodeId: 'answer' })).toThrow(/fork category failed/)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_fork_categories')
    }
    expect(snapshot()).toEqual(before)
    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('publishes category refresh effects only after the copied assignments are committed', () => {
    source()
    const category = categories.create({ name: 'Networks' })
    categories.setTopicCategories('source', [category.id])
    const observer = new Database(dbh.sqlite.name, { readonly: true })
    const observed: Array<{ topic_id: string; category_id: string }> = []
    vi.mocked(notifyDataApiDataChange).mockClear()
    vi.mocked(notifyDataApiDataChange).mockImplementation((effects) => {
      if (effects.some((effect) => effect.endpoint === '/topics/:topicId/session-graph-categories')) {
        observed.push(
          ...(observer
            .prepare("SELECT topic_id, category_id FROM session_graph_topic_category WHERE topic_id != 'source'")
            .all() as typeof observed)
        )
      }
    })
    try {
      const copied = topicService.duplicate('source', { nodeId: 'answer' })
      expect(observed).toEqual([{ topic_id: copied.id, category_id: category.id }])
      expect(notifyDataApiDataChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          {
            endpoint: '/topics/:topicId/session-graph-categories',
            kind: 'membership',
            routeParams: { topicId: copied.id }
          },
          { endpoint: '/session-graph/categories/:id/topics' }
        ])
      )
    } finally {
      vi.mocked(notifyDataApiDataChange).mockReset()
      observer.close()
    }
  })
})
