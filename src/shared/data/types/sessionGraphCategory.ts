import * as z from 'zod'

import { TagColorSchema, TagNameSchema } from './tag'

export const SessionGraphCategoryIdSchema = z.uuidv4()
export const SessionGraphCategorySchema = z.strictObject({
  id: SessionGraphCategoryIdSchema,
  parentId: SessionGraphCategoryIdSchema.nullable(),
  name: TagNameSchema,
  color: TagColorSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  path: z.array(z.strictObject({ id: SessionGraphCategoryIdSchema, name: TagNameSchema }))
})
export type SessionGraphCategory = z.infer<typeof SessionGraphCategorySchema>
