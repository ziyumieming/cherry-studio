import '@testing-library/jest-dom/vitest'
import { mockDataApiService, MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { SWRConfig } from 'swr'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { SessionGraphCategory } from '@shared/data/types/sessionGraphCategory'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useDataApi')
vi.unmock('react-i18next')

import { SessionCategoriesDialog } from '../SessionCategoriesPopup'

const networkId = '11111111-1111-4111-8111-111111111111'
const historyId = '22222222-2222-4222-8222-222222222222'
const childId = '33333333-3333-4333-8333-333333333333'
const otherChildId = '44444444-4444-4444-8444-444444444444'
const language = createInstance()
await language.init({
  keySeparator: false,
  lng: 'en-US',
  load: 'currentOnly',
  resources: { 'en-US': { translation: en } },
  interpolation: { escapeValue: false }
})

function category(id: string, name: string, parent?: SessionGraphCategory): SessionGraphCategory {
  return {
    id,
    name,
    parentId: parent?.id ?? null,
    color: null,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
    path: [...(parent?.path ?? []), { id, name }]
  }
}

let categories: SessionGraphCategory[]
let assignments: Record<string, SessionGraphCategory[]>

function mount(topicId = 'topic-a') {
  const resolve = vi.fn()
  const cache = new Map()
  const tree = (id: string) => (
    <I18nextProvider i18n={language}>
      <SWRConfig value={{ provider: () => cache }}>
        <SessionCategoriesDialog topicId={id} open resolve={resolve} />
      </SWRConfig>
    </I18nextProvider>
  )
  const view = render(tree(topicId))
  return { resolve, changeTopic: (id: string) => view.rerender(tree(id)) }
}

describe('Session categories', () => {
  beforeAll(() => {
    // jsdom does not implement the scrolling API used by the real Radix select.
    HTMLElement.prototype.scrollIntoView = () => {}
  })
  beforeEach(() => {
    expect(language.t('common.save')).toBe('Save')
    MockDataApiUtils.resetMocks()
    const network = category(networkId, 'Networking')
    const history = category(historyId, 'History')
    categories = [network, history, category(childId, 'Overview', network), category(otherChildId, 'Overview', history)]
    assignments = { 'topic-a': [categories[2]], 'topic-b': [categories[1]] }
    mockDataApiService.get.mockImplementation(async (path) => {
      if (path === '/session-graph/categories') return [...categories]
      const id = path.split('/')[2]
      if (path.endsWith('/session-graph-categories')) return [...(assignments[id] ?? [])]
      throw new Error(`Unexpected request: ${path}`)
    })
    mockDataApiService.post.mockReset().mockResolvedValue(undefined)
    mockDataApiService.patch.mockReset().mockResolvedValue(undefined)
    mockDataApiService.put.mockReset().mockResolvedValue(undefined)
    mockDataApiService.delete.mockReset().mockResolvedValue(undefined)
  })
  afterEach(cleanup)

  it('distinguishes full paths, retains hidden selections and preserves a failed save for retry', async () => {
    const user = userEvent.setup()
    const { resolve } = mount()
    expect(await screen.findByRole('checkbox', { name: 'Networking / Overview' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'History / Overview' }))
    await user.type(screen.getByRole('searchbox'), 'History')
    expect(screen.queryByRole('checkbox', { name: 'Networking / Overview' })).not.toBeInTheDocument()
    mockDataApiService.put.mockRejectedValueOnce(new Error('Save unavailable'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable')
    expect(resolve).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'History / Overview' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(true))
    expect(mockDataApiService.put).toHaveBeenLastCalledWith(
      '/topics/topic-a/session-graph-categories',
      expect.objectContaining({ body: { categoryIds: [childId, otherChildId] } })
    )
  })

  it('discards unsaved assignments on cancel and never carries them into another topic', async () => {
    const user = userEvent.setup()
    const { resolve, changeTopic } = mount()
    await user.click(await screen.findByRole('checkbox', { name: 'History / Overview' }))
    changeTopic('topic-b')
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'History' })).toBeChecked())
    expect(screen.getByRole('checkbox', { name: 'History / Overview' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Networking / Overview' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(resolve).toHaveBeenCalledWith(false)
    expect(mockDataApiService.put).not.toHaveBeenCalled()
  })

  it('fails closed on read errors and permits editing only after retry succeeds', async () => {
    mockDataApiService.get.mockRejectedValueOnce(new Error('Read unavailable'))
    const user = userEvent.setup()
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load categories')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New category' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  })

  it('refreshes changed paths and removes deleted categories without losing the remaining draft', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('checkbox', { name: 'History / Overview' }))
    const renamed = category(networkId, 'Networks')
    categories = [renamed, categories[1], category(childId, 'Overview', renamed)]
    await act(async () =>
      MockDataApiUtils.emitDataChange([{ endpoint: '/session-graph/categories', kind: 'membership' }])
    )
    expect(await screen.findByRole('checkbox', { name: 'Networks / Overview' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'History / Overview' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockDataApiService.put).toHaveBeenCalledWith(
        '/topics/topic-a/session-graph-categories',
        expect.objectContaining({ body: { categoryIds: [childId] } })
      )
    )
  })

  it('renames and moves by stable ID while excluding itself and its descendants from parents', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Edit Networking' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, '  Networks  ')
    screen.getByRole('combobox', { name: 'Parent category' }).focus()
    await user.keyboard('[Enter]')
    expect(screen.queryByRole('option', { name: 'Networking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Networking / Overview' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'History' }))
    const form = name.closest('form')!
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockDataApiService.patch).toHaveBeenCalledWith(
        `/session-graph/categories/${networkId}`,
        expect.objectContaining({ body: { name: 'Networks', parentId: historyId } })
      )
    )
    expect(mockDataApiService.put).not.toHaveBeenCalled()
  })

  it('requires deletion confirmation and leaves dependency errors visible without closing', async () => {
    const user = userEvent.setup()
    const { resolve } = mount()
    await user.click(await screen.findByRole('button', { name: 'Delete Networking' }))
    expect(mockDataApiService.delete).not.toHaveBeenCalled()
    mockDataApiService.delete.mockRejectedValueOnce(new Error('Category has children'))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Category has children')
    expect(screen.getByRole('checkbox', { name: 'Networking' })).toBeInTheDocument()
    expect(resolve).not.toHaveBeenCalled()
    expect(mockDataApiService.delete).toHaveBeenCalledWith(`/session-graph/categories/${networkId}`, expect.anything())
  })

  it('preserves a rejected new category and creates it without saving conversation assignments', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('checkbox', { name: 'Networking / Overview' })
    await user.click(screen.getByRole('button', { name: 'New category' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    const save = within(name.closest('form')!).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.type(name, '  Protocols  ')
    mockDataApiService.post.mockRejectedValueOnce(new Error('Name already exists'))
    await user.click(save)
    expect(await screen.findByRole('alert')).toHaveTextContent('Name already exists')
    expect(name).toHaveValue('  Protocols  ')
    await user.click(save)
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument())
    expect(mockDataApiService.post).toHaveBeenLastCalledWith(
      '/session-graph/categories',
      expect.objectContaining({ body: { name: 'Protocols', parentId: null } })
    )
    expect(mockDataApiService.put).not.toHaveBeenCalled()
  })
})
