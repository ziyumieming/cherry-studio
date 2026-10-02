import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { dataApiService } from '@data/DataApiService'
import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { invalidateCachedMessageUiStates } from '@renderer/services/messageUiStateCache'
import type { TopicHistoryProtection } from '@shared/data/api/schemas/messages'

const logger = loggerService.withContext('useClearTopicMessages')

export function useClearTopicMessages() {
  const { t } = useTranslation()
  const { trigger } = useMutation('DELETE', '/topics/:topicId/messages', {
    refresh: ({ args }) => {
      const topicId = args!.params.topicId
      return [
        '/topics',
        `/topics/${topicId}`,
        '/topics/latest',
        `/topics/${topicId}/messages`,
        `/topics/${topicId}/tree`
      ]
    }
  })

  return useCallback(
    async (topicId: string) => {
      const protection = (await dataApiService.get(`/topics/${topicId}/history-protection`)) as TopicHistoryProtection
      if (protection.lockedMessageIds.length > 0) throw new Error(t('message.shared_history.explanation'))
      const result = await trigger({ params: { topicId } })
      invalidateCachedMessageUiStates(result.deletedIds)
      logger.info('Cleared all messages', { topicId, count: result.deletedIds.length })
    },
    [trigger, t]
  )
}
