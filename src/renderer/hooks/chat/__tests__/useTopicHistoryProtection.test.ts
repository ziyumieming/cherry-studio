import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@data/hooks/useDataApi', async () => {
  const { MockUseDataApi } = await import('@test-mocks/renderer/useDataApi')
  const { useDataChange } = await import('@renderer/data/hooks/useDataChange')
  return { ...MockUseDataApi, useDataChange }
})

import { useTopicHistoryProtection } from '../useTopicHistoryProtection'

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
})

it('refreshes the protection snapshot only for the topic whose history changed', () => {
  const refetch = vi.fn().mockResolvedValue(undefined)
  MockUseDataApiUtils.mockQueryResult('/topics/:topicId/history-protection', {
    data: {
      lockedMessageIds: ['shared'],
      deleteBlockedMessageIds: ['shared'],
      replyGroupDeleteBlockedMessageIds: ['shared'],
      regenerateBlockedMessageIds: ['shared', 'alternative']
    },
    refetch
  })
  const { result } = renderHook(() => useTopicHistoryProtection('source'))
  expect(result.current.getReadOnlyReason('shared')).toBeTruthy()
  expect(result.current.getReadOnlyReason('alternative')).toBeUndefined()
  expect(result.current.getUnavailableReason('alternative', 'edit')).toBeUndefined()
  expect(result.current.getUnavailableReason('alternative', 'regenerate')).toBeTruthy()
  act(() =>
    MockUseDataApiUtils.emitDataChange([
      { endpoint: '/topics/:topicId/history-protection', routeParams: { topicId: 'other' } }
    ])
  )
  expect(refetch).not.toHaveBeenCalled()
  act(() =>
    MockUseDataApiUtils.emitDataChange([
      { endpoint: '/topics/:topicId/history-protection', routeParams: { topicId: 'source' } }
    ])
  )
  expect(refetch).toHaveBeenCalledOnce()
})
