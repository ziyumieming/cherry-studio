import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { topicHandlers } from '@data/api/handlers/topics'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import { sessionGraphCategoryService as categories } from '@data/services/SessionGraphCategoryService'
import { topicService } from '@data/services/TopicService'
import { ListTopicsQuerySchema } from '@shared/data/api/schemas/topics'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

describe('Category-filtered topic candidates', () => {
  const dbh = setupTestDatabase()
  function topic(id: string, name = id) {
    dbh.db.insert(topicTable).values({ id, name, orderKey: id }).run()
  }

  it('distinguishes paths, optionally includes descendants and deduplicates multi-category topics including pins', () => {
    const root = categories.create({ name: 'Networking' })
    const child = categories.create({ name: 'Overview', parentId: root.id })
    const otherRoot = categories.create({ name: 'History' })
    const otherChild = categories.create({ name: 'Overview', parentId: otherRoot.id })
    topic('direct')
    topic('child')
    topic('other')
    categories.setTopicCategories('direct', [root.id, child.id])
    categories.setTopicCategories('child', [child.id])
    categories.setTopicCategories('other', [otherChild.id])
    dbh.db.insert(pinTable).values({ entityType: 'topic', entityId: 'direct', orderKey: 'a0' }).run()
    dbh.db.insert(pinTable).values({ entityType: 'topic', entityId: 'other', orderKey: 'a1' }).run()

    expect(topicService.listByCursor({ sessionGraphCategoryId: root.id }).items.map((item) => item.id)).toEqual([
      'direct'
    ])
    expect(
      topicService
        .listByCursor({ sessionGraphCategoryId: root.id, includeCategoryDescendants: true })
        .items.map((item) => item.id)
    ).toEqual(['direct', 'child'])
    expect(topicService.listByCursor({ sessionGraphCategoryId: otherChild.id }).items.map((item) => item.id)).toEqual([
      'other'
    ])
  })

  it('pages more than 200 candidates without dropping or repeating topics', () => {
    const category = categories.create({ name: 'Networks' })
    topic('outside-category')
    for (let index = 0; index < 205; index++) {
      const id = `topic-${String(index).padStart(3, '0')}`
      topic(id)
      categories.setTopicCategories(id, [category.id])
    }
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = topicService.listByCursor({ sessionGraphCategoryId: category.id, limit: 50, cursor })
      expect(page.items.length).toBeLessThanOrEqual(50)
      seen.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toHaveLength(205)
    expect(new Set(seen).size).toBe(205)
    expect(seen[204]).toBe('topic-204')
  })

  it('intersects category, title and ID filters and excludes trashed conversations', () => {
    const category = categories.create({ name: 'Networks' })
    topic('match', 'VXLAN tunnels')
    topic('different-title', 'SDN controllers')
    topic('unclassified', 'VXLAN unrelated')
    topic('trashed', 'VXLAN deleted')
    for (const id of ['match', 'different-title', 'trashed']) categories.setTopicCategories(id, [category.id])
    topicService.delete('trashed')
    const query = { sessionGraphCategoryId: category.id, q: 'VXLAN', ids: ['match', 'trashed', 'unclassified'] }
    expect(topicService.listByCursor(query).items.map((item) => item.id)).toEqual(['match'])
    categories.setTopicCategories('match', [])
    expect(topicService.listByCursor(query).items).toEqual([])
  })

  it('validates category query IDs and rejects a removed category instead of returning all topics', () => {
    expect(ListTopicsQuerySchema.safeParse({ sessionGraphCategoryId: 'bad-id' }).success).toBe(false)
    expect(ListTopicsQuerySchema.safeParse({ includeCategoryDescendants: true }).success).toBe(false)
    const category = categories.create({ name: 'Empty' })
    topic('unrelated')
    expect(topicService.listByCursor({ sessionGraphCategoryId: category.id }).items).toEqual([])
    categories.delete(category.id)
    expect(() => topicService.listByCursor({ sessionGraphCategoryId: category.id })).toThrow(/not found/i)
  })

  it('accepts category filters through the public topic handler and validates malformed requests', async () => {
    const category = categories.create({ name: 'Networks' })
    topic('target')
    topic('unrelated')
    categories.setTopicCategories('target', [category.id])
    // Optional handler queries use the existing transport test convention; the Zod schema validates at runtime.
    expect(
      await topicHandlers['/topics'].GET({ query: { sessionGraphCategoryId: category.id } } as never)
    ).toMatchObject({
      items: [{ id: 'target' }]
    })
    await expect(
      topicHandlers['/topics'].GET({ query: { sessionGraphCategoryId: 'bad-id' } } as never)
    ).rejects.toHaveProperty('name', 'ZodError')
  })
})
