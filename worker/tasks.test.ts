import { describe, expect, it } from 'vitest'
import { filterNodesByName, parseSubscriptionUserinfo } from './tasks'

describe('parseSubscriptionUserinfo', () => {
  it('过滤非法到期时间', () => {
    expect(parseSubscriptionUserinfo('upload=1; expire=0')).toEqual({ upload: 1 })
    expect(parseSubscriptionUserinfo('expire=')).toBeNull()
    expect(parseSubscriptionUserinfo('expire=1735689600')).toEqual({ expire: 1735689600 })
  })
})

describe('filterNodesByName', () => {
  it('按节点名称正则过滤', () => {
    const nodes = [{ config: { name: '香港 01' } }, { config: { name: '日本 01' } }]
    expect(filterNodesByName(nodes, '香港')).toHaveLength(1)
    expect(filterNodesByName(nodes, null)).toHaveLength(2)
  })
})
