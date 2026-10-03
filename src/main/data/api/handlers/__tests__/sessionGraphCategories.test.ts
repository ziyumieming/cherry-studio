import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { sessionGraphCategoryHandlers as handlers } from '@data/api/handlers/sessionGraphCategories'
import { topicTable } from '@data/db/schemas/topic'
import { sessionGraphCategoryService } from '@data/services/SessionGraphCategoryService'
import { CategoryTopicsQuerySchema } from '@shared/data/api/schemas/sessionGraphCategories'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

describe('Session graph category API validation and persistence', () => {
  const dbh = setupTestDatabase()
  it('normalizes category names, supports null parent/color and persists topic assignments', async () => {
    dbh.db.insert(topicTable).values({ id: 'topic', orderKey: 'a0' }).run()
    const root = await handlers['/session-graph/categories'].POST({ body: { name: '  Networks  ' } })
    const leaf = await handlers['/session-graph/categories'].POST({
      body: { name: ' VXLAN ', parentId: root.id, color: '#123456' }
    })
    await handlers['/topics/:topicId/session-graph-categories'].PUT({
      params: { topicId: 'topic' },
      body: { categoryIds: [leaf.id] }
    })
    expect(await handlers['/topics/:topicId/session-graph-categories'].GET({ params: { topicId: 'topic' } })).toEqual([
      leaf
    ])
    expect(await handlers['/session-graph/categories/:id/topics'].GET({ params: { id: root.id } })).toEqual({
      topicIds: []
    })
    expect(
      await handlers['/session-graph/categories/:id/topics'].GET({
        params: { id: root.id },
        query: { includeDescendants: true }
      })
    ).toEqual({ topicIds: ['topic'] })
    expect(
      await handlers['/session-graph/categories/:id'].PATCH({
        params: { id: leaf.id },
        body: { parentId: null, color: null }
      })
    ).toMatchObject({ id: leaf.id, parentId: null, color: null, path: [{ id: leaf.id, name: 'VXLAN' }] })
  })
  it('rejects invalid input at the boundary and preserves the category tree and bindings', async () => {
    dbh.db.insert(topicTable).values({ id: 'topic', orderKey: 'a0' }).run()
    const root = await handlers['/session-graph/categories'].POST({ body: { name: 'Root' } })
    for (const body of [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(65) },
      { name: 'Other', parentId: 'bad-id' },
      { name: 'Other', color: '#nothex' }
    ]) {
      await expect(handlers['/session-graph/categories'].POST({ body })).rejects.toHaveProperty('name', 'ZodError')
    }
    await expect(
      handlers['/topics/:topicId/session-graph-categories'].PUT({
        params: { topicId: 'topic' },
        body: { categoryIds: [root.id, root.id] }
      })
    ).rejects.toHaveProperty('name', 'ZodError')
    await expect(handlers['/session-graph/categories/:id'].DELETE({ params: { id: 'bad-id' } })).rejects.toHaveProperty(
      'name',
      'ZodError'
    )
    expect(await handlers['/session-graph/categories'].GET({})).toEqual([root])
    expect(sessionGraphCategoryService.getTopicCategories('topic')).toEqual([])
  })
  it('treats empty or explicitly undefined optional patches as no-ops', async () => {
    const root = await handlers['/session-graph/categories'].POST({ body: { name: 'Root' } })
    for (const body of [{}, { name: undefined, parentId: undefined, color: undefined }]) {
      expect(await handlers['/session-graph/categories/:id'].PATCH({ params: { id: root.id }, body })).toEqual(root)
    }
  })

  it('parses false query strings as false and rejects ambiguous values', () => {
    expect(CategoryTopicsQuerySchema.parse({ includeDescendants: 'false' })).toEqual({ includeDescendants: false })
    expect(CategoryTopicsQuerySchema.parse({ includeDescendants: 'true' })).toEqual({ includeDescendants: true })
    expect(CategoryTopicsQuerySchema.parse({})).toEqual({ includeDescendants: false })
    expect(() => CategoryTopicsQuerySchema.parse({ includeDescendants: '0' })).toThrow()
  })
})
