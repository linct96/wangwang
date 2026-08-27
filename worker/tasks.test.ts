import { describe, expect, it } from 'vitest'
import { parseSubscriptionUserinfo } from './tasks'

describe('parseSubscriptionUserinfo', () => {
  it('过滤非法到期时间', () => {
    expect(parseSubscriptionUserinfo('upload=1; expire=0')).toEqual({ upload: 1 })
    expect(parseSubscriptionUserinfo('expire=')).toBeNull()
    expect(parseSubscriptionUserinfo('expire=1735689600')).toEqual({ expire: 1735689600 })
  })
})
