import * as z from 'zod'

import {
  SessionGraphCategoryIdSchema,
  SessionGraphCategorySchema,
  type SessionGraphCategory
} from '../../types/sessionGraphCategory'

export const CreateSessionGraphCategorySchema = SessionGraphCategorySchema.pick({
  name: true,
  color: true,
  parentId: true
})
  .partial()
  .required({ name: true })
export type CreateSessionGraphCategoryDto = z.infer<typeof CreateSessionGraphCategorySchema>
export const UpdateSessionGraphCategorySchema = CreateSessionGraphCategorySchema.partial()
export type UpdateSessionGraphCategoryDto = z.infer<typeof UpdateSessionGraphCategorySchema>
export const SetTopicCategoriesSchema = z.strictObject({
  categoryIds: z
    .array(SessionGraphCategoryIdSchema)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate category ids are not allowed' })
})
export const CategoryTopicsQuerySchema = z.strictObject({
  includeDescendants: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
    .optional()
    .default(false)
})

export type SessionGraphCategorySchemas = {
  '/session-graph/categories': {
    GET: { response: SessionGraphCategory[] }
    POST: { body: CreateSessionGraphCategoryDto; response: SessionGraphCategory }
  }
  '/session-graph/categories/:id': {
    PATCH: { params: { id: string }; body: UpdateSessionGraphCategoryDto; response: SessionGraphCategory }
    DELETE: { params: { id: string }; response: void }
  }
  '/session-graph/categories/:id/topics': {
    GET: { params: { id: string }; query?: { includeDescendants?: boolean }; response: { topicIds: string[] } }
  }
  '/topics/:topicId/session-graph-categories': {
    GET: { params: { topicId: string }; response: SessionGraphCategory[] }
    PUT: { params: { topicId: string }; body: z.infer<typeof SetTopicCategoriesSchema>; response: void }
  }
}
