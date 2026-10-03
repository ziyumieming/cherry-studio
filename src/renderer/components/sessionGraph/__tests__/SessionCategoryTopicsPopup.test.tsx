import '@testing-library/jest-dom/vitest'
import { mockDataApiService, MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { ListTopicsQuery } from '@shared/data/api/schemas/topics'
import type { SessionGraphCategory } from '@shared/data/types/sessionGraphCategory'
import type { Topic } from '@shared/data/types/topic'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useDataApi')
vi.unmock('react-i18next')
const navigation = vi.hoisted(() => ({ openConversation: vi.fn() }))
vi.mock('@renderer/hooks/useConversationNavigation', () => ({ useConversationNavigation: () => navigation }))

import { SessionCategoryTopicsDialog, SessionCategoryTopicsPicker } from '../SessionCategoryTopicsPopup'

const language = createInstance()
await language.init({
  keySeparator: false,
  lng: 'en-US',
  load: 'currentOnly',
  resources: { 'en-US': { translation: en } },
  interpolation: { escapeValue: false }
})
const rootId = '11111111-1111-4111-8111-111111111111'
const childId = '22222222-2222-4222-8222-222222222222'
const otherId = '33333333-3333-4333-8333-333333333333'
function category(id: string, name: string, path: Array<{ id: string; name: string }> = []): SessionGraphCategory {
  return {
    id,
    name,
    parentId: path.at(-1)?.id ?? null,
    color: null,
    path: [...path, { id, name }],
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z'
  }
}
function topic(id: string, name: string): Topic {
  return {
    id,
    name,
    isNameManuallyEdited: true,
    orderKey: id,
    lastActivityAt: '2026-10-03T00:00:00.000Z',
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z'
  }
}
let categories: SessionGraphCategory[]
let rejectTopics: boolean
let selectedRemoved: boolean
let pending: Promise<unknown> | undefined
let selectionPending: Promise<unknown> | undefined
function mount(dialog = false) {
  const onSelect = vi.fn()
  const onCancel = vi.fn()
  const resolve = vi.fn()
  render(
    <I18nextProvider i18n={language}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {dialog ? (
          <SessionCategoryTopicsDialog open resolve={resolve} />
        ) : (
          <SessionCategoryTopicsPicker onSelect={onSelect} onCancel={onCancel} />
        )}
      </SWRConfig>
    </I18nextProvider>
  )
  return { onSelect, onCancel, resolve }
}

describe('Category conversation browsing', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    navigation.openConversation.mockReset()
    categories = [
      category(rootId, 'Networking'),
      category(childId, 'Overview', [{ id: rootId, name: 'Networking' }]),
      category(otherId, 'Overview', [{ id: 'history', name: 'History' }])
    ]
    rejectTopics = false
    selectedRemoved = false
    pending = undefined
    selectionPending = undefined
    mockDataApiService.get.mockImplementation(async (path, options) => {
      if (path === '/session-graph/categories') return [...categories]
      if (path !== '/topics') throw new Error(`Unexpected request: ${path}`)
      const query = options?.query as ListTopicsQuery
      if (query.ids) {
        if (selectionPending) return selectionPending
        return {
          items:
            selectedRemoved || (query.q && !'Current title'.includes(query.q))
              ? []
              : [topic(query.ids[0], 'Current title')]
        }
      }
      if (rejectTopics) throw new Error('Read unavailable')
      if (query.sessionGraphCategoryId === otherId && pending) return pending
      if (query.q) return { items: query.q === 'VXLAN' ? [topic('vxlan', 'VXLAN tunnels')] : [] }
      if (query.cursor) return { items: [topic('second-page', 'Later discussion')] }
      if (query.includeCategoryDescendants) return { items: [topic('child-topic', 'Subcategory conversation')] }
      if (query.sessionGraphCategoryId === otherId) return { items: [topic('history-topic', 'History conversation')] }
      return { items: [topic('network-topic', 'Network conversation')], nextCursor: 'page-2' }
    })
  })
  afterEach(cleanup)

  it('chooses full category paths, loads later pages and revalidates the exact target before selection', async () => {
    const user = userEvent.setup()
    const { onSelect } = mount()
    await user.click(await screen.findByRole('button', { name: 'Networking / Overview' }))
    expect(await screen.findByRole('button', { name: 'Open Network conversation' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await user.click(await screen.findByRole('button', { name: 'Open Later discussion' }))
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({ categoryId: childId, topic: topic('second-page', 'Current title') })
    )
    await user.type(screen.getByRole('searchbox', { name: 'Search conversation titles' }), 'VXLAN')
    await user.click(await screen.findByRole('button', { name: 'Open VXLAN tunnels' }))
    await waitFor(() =>
      expect(onSelect).toHaveBeenLastCalledWith({ categoryId: childId, topic: topic('vxlan', 'Current title') })
    )
  })

  it('searches category paths and titles, optionally includes descendants and drops old results on category changes', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Networking' }))
    await screen.findByRole('button', { name: 'Open Network conversation' })
    await user.click(screen.getByRole('checkbox', { name: 'Include subcategories' }))
    expect(await screen.findByRole('button', { name: 'Open Subcategory conversation' })).toBeEnabled()
    await user.type(screen.getByRole('searchbox', { name: 'Search conversation titles' }), 'VXLAN')
    expect(await screen.findByRole('button', { name: 'Open VXLAN tunnels' })).toBeEnabled()
    await user.type(screen.getByRole('searchbox', { name: 'Search category paths' }), 'History')
    expect(screen.queryByRole('button', { name: 'Networking / Overview' })).not.toBeInTheDocument()
    let release!: (value: unknown) => void
    pending = new Promise((resolve) => {
      release = resolve
    })
    await user.click(screen.getByRole('button', { name: 'History / Overview' }))
    expect(screen.queryByRole('button', { name: 'Open VXLAN tunnels' })).not.toBeInTheDocument()
    await act(async () => release({ items: [topic('history-topic', 'History conversation')] }))
    expect(await screen.findByRole('button', { name: 'Open History conversation' })).toBeEnabled()
  })

  it('fails closed on reads, retries and shows empty searches without requesting all conversations', async () => {
    rejectTopics = true
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Networking' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load conversations')
    expect(screen.queryByRole('button', { name: 'Open Network conversation' })).not.toBeInTheDocument()
    rejectTopics = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: 'Open Network conversation' })
    await user.type(screen.getByRole('searchbox', { name: 'Search conversation titles' }), 'nothing')
    expect(await screen.findByText('No conversations match this category and search.')).toBeInTheDocument()
    const topicRequests = mockDataApiService.get.mock.calls.filter(([path]) => path === '/topics')
    expect(
      topicRequests.every(([, options]) => (options?.query as ListTopicsQuery).sessionGraphCategoryId === rootId)
    ).toBe(true)
  })

  it('refreshes membership changes and clears a category removed in another window', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Networking' }))
    await screen.findByRole('button', { name: 'Open Network conversation' })
    mockDataApiService.get.mockImplementation(async (path) =>
      path === '/session-graph/categories' ? [...categories] : { items: [] }
    )
    await act(async () => MockDataApiUtils.emitDataChange([{ endpoint: '/topics', kind: 'membership' }]))
    expect(await screen.findByText('No conversations match this category and search.')).toBeInTheDocument()
    categories = categories.filter((category) => category.id !== rootId)
    await act(async () =>
      MockDataApiUtils.emitDataChange([{ endpoint: '/session-graph/categories', kind: 'membership' }])
    )
    expect(await screen.findByText('Choose a category to find conversations.')).toBeInTheDocument()
  })

  it('keeps the picker open when the target disappears and suppresses a selection completed after cancel', async () => {
    const user = userEvent.setup()
    const { onSelect, onCancel } = mount()
    await user.click(await screen.findByRole('button', { name: 'Networking' }))
    selectedRemoved = true
    await user.click(await screen.findByRole('button', { name: 'Open Network conversation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available')
    expect(onSelect).not.toHaveBeenCalled()
    let release!: (value: unknown) => void
    selectionPending = new Promise((resolve) => {
      release = resolve
    })
    await user.click(screen.getByRole('button', { name: 'Open Network conversation' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    await act(async () => release({ items: [topic('network-topic', 'Current title')] }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens the revalidated conversation through existing navigation and resolves the dialog', async () => {
    const user = userEvent.setup()
    const { resolve } = mount(true)
    await user.click(await screen.findByRole('button', { name: 'Networking' }))
    await user.click(await screen.findByRole('button', { name: 'Open Network conversation' }))
    await waitFor(() => expect(navigation.openConversation).toHaveBeenCalledWith('network-topic', 'Current title'))
    expect(resolve).toHaveBeenCalledWith({ categoryId: rootId, topic: topic('network-topic', 'Current title') })
  })

  it('does not select an old target after switching categories during its revalidation', async () => {
    const user = userEvent.setup()
    const { onSelect } = mount()
    await user.click(await screen.findByRole('button', { name: 'Networking' }))
    let release!: (value: unknown) => void
    selectionPending = new Promise((resolve) => {
      release = resolve
    })
    await user.click(await screen.findByRole('button', { name: 'Open Network conversation' }))
    await user.click(screen.getByRole('button', { name: 'History / Overview' }))
    await screen.findByRole('button', { name: 'Open History conversation' })
    await act(async () => release({ items: [topic('network-topic', 'Current title')] }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
