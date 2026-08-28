import { describe, expect, it } from 'vitest'
import { mergeNodeTags, parseSubscriptionUserinfo, removeNodesByName } from './tasks'

describe('parseSubscriptionUserinfo', () => {
  it('过滤非法到期时间', () => {
    expect(parseSubscriptionUserinfo('upload=1; expire=0')).toEqual({ upload: 1 })
    expect(parseSubscriptionUserinfo('expire=')).toBeNull()
    expect(parseSubscriptionUserinfo('expire=1735689600')).toEqual({ expire: 1735689600 })
  })
})

describe('removeNodesByName', () => {
  it('移除匹配节点名称正则的节点', () => {
    const nodes = [{ config: { name: '香港 01' } }, { config: { name: '日本 01' } }]
    expect(removeNodesByName(nodes, '香港')).toEqual([{ config: { name: '日本 01' } }])
    expect(removeNodesByName(nodes, null)).toHaveLength(2)
  })
})

describe('mergeNodeTags', () => {
  it('合并节点标签与订阅标签并去重', () => {
    expect(mergeNodeTags(['香港'], ['机场 A', '香港', null])).toEqual(['香港', '机场 A'])
  })
})
