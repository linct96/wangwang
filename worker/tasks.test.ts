import { describe, expect, it, vi } from 'vitest'
import {
  fetchSource,
  mergeNodeTags,
  parseContentDispositionFilename,
  parseSubscriptionUserinfo,
  removeNodesByName,
} from './tasks'

describe('fetchSource', () => {
  it('使用节点源设置的 User-Agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await fetchSource('https://example.com/sub', 'Shadowrocket', null, null)
      expect(new Headers(fetchMock.mock.calls[0][1].headers).get('User-Agent')).toBe('Shadowrocket')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('响应没有文件名时使用订阅域名', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('proxies: []'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const response = await fetchSource('https://example.com/sub', 'mihomo', null, null)
      expect(response.name).toBe('example.com')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('parseSubscriptionUserinfo', () => {
  it('解析实际订阅响应头', () => {
    expect(parseContentDispositionFilename("attachment;filename*=UTF-8''%E5%AE%9D%E5%8F%AF%E6%A2%A6")).toBe('宝可梦')
    expect(
      parseSubscriptionUserinfo('upload=324877095; download=4231556257; total=64424509440; expire=1788239433'),
    ).toEqual({ upload: 324877095, download: 4231556257, total: 64424509440, expire: 1788239433 })
  })

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
