import { describe, expectTypeOf, it } from 'vitest'

import type { ListTopicsQuery } from '../schemas/topics'
import type { ApiHandler, ApiQuery } from '../types'

describe('API handler query types', () => {
  it('accepts optional topic queries while allowing requests without them', () => {
    type Request = Parameters<ApiHandler<'/topics', 'GET'>>[0]
    expectTypeOf<ApiQuery<'/topics', 'GET'>>().toEqualTypeOf<ListTopicsQuery | undefined>()
    expectTypeOf<{}>().toExtend<Request>()
    expectTypeOf<{ query: { sessionGraphCategoryId: string } }>().toExtend<Request>()
  })

  it('keeps mandatory queries required', () => {
    type Request = Parameters<ApiHandler<'/topics/:id', 'DELETE'>>[0]
    expectTypeOf<Request>().toExtend<{ query: ApiQuery<'/topics/:id', 'DELETE'> }>()
  })

  it('rejects query parameters on endpoints without a query contract', () => {
    expectTypeOf<ApiQuery<'/topics', 'POST'>>().toEqualTypeOf<never>()
  })
})
