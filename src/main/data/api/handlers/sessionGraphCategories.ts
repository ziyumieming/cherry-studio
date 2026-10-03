import * as z from 'zod'

import { sessionGraphCategoryService } from '@data/services/SessionGraphCategoryService'
import {
  CategoryTopicsQuerySchema,
  CreateSessionGraphCategorySchema,
  SetTopicCategoriesSchema,
  type SessionGraphCategorySchemas,
  UpdateSessionGraphCategorySchema
} from '@shared/data/api/schemas/sessionGraphCategories'
import type { HandlersFor } from '@shared/data/api/types'
import { SessionGraphCategoryIdSchema } from '@shared/data/types/sessionGraphCategory'

const TopicIdSchema = z.string().min(1)

export const sessionGraphCategoryHandlers: HandlersFor<SessionGraphCategorySchemas> = {
  '/session-graph/categories': {
    GET: async () => sessionGraphCategoryService.list(),
    POST: async ({ body }) => sessionGraphCategoryService.create(CreateSessionGraphCategorySchema.parse(body))
  },
  '/session-graph/categories/:id': {
    PATCH: async ({ params, body }) =>
      sessionGraphCategoryService.update(
        SessionGraphCategoryIdSchema.parse(params.id),
        UpdateSessionGraphCategorySchema.parse(body)
      ),
    DELETE: async ({ params }) => {
      sessionGraphCategoryService.delete(SessionGraphCategoryIdSchema.parse(params.id))
      return undefined
    }
  },
  '/session-graph/categories/:id/topics': {
    GET: async ({ params, query }) => ({
      topicIds: sessionGraphCategoryService.getTopicIds(
        SessionGraphCategoryIdSchema.parse(params.id),
        CategoryTopicsQuerySchema.parse(query ?? {}).includeDescendants
      )
    })
  },
  '/topics/:topicId/session-graph-categories': {
    GET: async ({ params }) => sessionGraphCategoryService.getTopicCategories(TopicIdSchema.parse(params.topicId)),
    PUT: async ({ params, body }) => {
      sessionGraphCategoryService.setTopicCategories(
        TopicIdSchema.parse(params.topicId),
        SetTopicCategoriesSchema.parse(body).categoryIds
      )
      return undefined
    }
  }
}
