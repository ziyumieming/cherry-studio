import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useDataChange, useQuery } from '@data/hooks/useDataApi'

import type { MessageMutation } from './ChatWriteContext'

export function useTopicHistoryProtection(topicId: string | undefined) {
  const { t } = useTranslation()
  const { data, refetch } = useQuery('/topics/:topicId/history-protection', {
    params: { topicId: topicId ?? '' },
    enabled: !!topicId,
    swrOptions: { keepPreviousData: false }
  })
  useDataChange(
    topicId ? ['/topics/:topicId/history-protection', '/topics/:topicId/messages'] : [],
    () => {
      void refetch()
    },
    {
      routeParams: { topicId: topicId ?? '' }
    }
  )
  const blockedIds = useMemo(
    () => ({
      edit: new Set(data?.lockedMessageIds),
      regenerate: new Set(data?.regenerateBlockedMessageIds),
      delete: new Set(data?.deleteBlockedMessageIds),
      'delete-group': new Set(data?.replyGroupDeleteBlockedMessageIds)
    }),
    [data]
  )
  const getUnavailableReason = useCallback(
    (messageId: string, operation: MessageMutation): string | undefined => {
      if (!data) return t('message.shared_history.checking')
      return blockedIds[operation].has(messageId) ? t('message.shared_history.explanation') : undefined
    },
    [blockedIds, data, t]
  )
  const getReadOnlyReason = useCallback(
    (messageId: string) => (blockedIds.edit.has(messageId) ? t('message.shared_history.explanation') : undefined),
    [blockedIds, t]
  )
  return { data, refetch, getUnavailableReason, getReadOnlyReason }
}
