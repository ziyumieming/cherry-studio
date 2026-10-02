import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { expect, it, vi } from 'vitest'

import type { TopicHistoryProtection } from '@shared/data/api/schemas/messages'

import { useTopicHistoryProtection } from '../useTopicHistoryProtection'

vi.mock('@data/hooks/useDataApi', async () => vi.importActual('@data/hooks/useDataApi'))

it('never uses the previous topic’s unlocked snapshot while the next topic is loading', async () => {
  let resolveProtection!: (value: TopicHistoryProtection) => void
  const next = new Promise<TopicHistoryProtection>((resolve) => {
    resolveProtection = resolve
  })
  mockDataApiService.get.mockImplementation(async (path) => {
    if (path === '/topics/shared/history-protection') return next
    return {
      lockedMessageIds: [],
      deleteBlockedMessageIds: [],
      replyGroupDeleteBlockedMessageIds: [],
      regenerateBlockedMessageIds: []
    }
  })
  const cache = new Map()
  const wrapper = ({ children }: PropsWithChildren) => (
    <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  )
  const { result, rerender } = renderHook(({ topicId }) => useTopicHistoryProtection(topicId), {
    initialProps: { topicId: 'ordinary' },
    wrapper
  })
  await waitFor(() => expect(result.current.getUnavailableReason('ordinary-question', 'edit')).toBeUndefined())
  rerender({ topicId: 'shared' })
  expect(result.current.data).toBeUndefined()
  expect(result.current.getUnavailableReason('shared-question', 'edit')).toBeTruthy()
  await act(async () =>
    resolveProtection({
      lockedMessageIds: ['shared-question'],
      deleteBlockedMessageIds: ['shared-question'],
      replyGroupDeleteBlockedMessageIds: [],
      regenerateBlockedMessageIds: ['shared-question']
    })
  )
  await waitFor(() => expect(result.current.getReadOnlyReason('shared-question')).toBeTruthy())
})
