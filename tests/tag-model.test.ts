import { describe, expect, it } from 'vitest'
import { matchesAnyTag, mergeTagViews, normalizeTagInputs, normalizeTagName } from '../worker/tag-model'

describe('tag model', () => {
  it('normalizes ASCII case and trims whitespace', () => {
    expect(normalizeTagName('  HK  ')).toBe('hk')
    expect(normalizeTagName(' 香港 ')).toBe('香港')
  })

  it('deduplicates by normalized name and preserves first display name', () => {
    expect(normalizeTagInputs(['HK', ' hk ', '香港'], 10)).toEqual(['HK', '香港'])
  })

  it('rejects empty, too long, and over-limit tags', () => {
    expect(() => normalizeTagInputs([''], 10)).toThrow('标签不能为空')
    expect(() => normalizeTagInputs(['a'.repeat(25)], 10)).toThrow('单个标签不能超过 24 个字符')
    expect(() =>
      normalizeTagInputs(
        Array.from({ length: 11 }, (_, index) => `tag-${index}`),
        10,
      ),
    ).toThrow('标签不能超过 10 个')
  })

  it('merges direct and inherited tags by id', () => {
    const direct = [{ id: 'a', name: '高速' }]
    const inherited = [
      { id: 'b', name: '香港' },
      { id: 'a', name: '高速' },
    ]
    expect(mergeTagViews(direct, inherited)).toEqual([
      { id: 'a', name: '高速' },
      { id: 'b', name: '香港' },
    ])
  })

  it('matches profile filters with OR semantics', () => {
    expect(matchesAnyTag(['a', 'b'], [])).toBe(true)
    expect(matchesAnyTag(['a', 'b'], ['b', 'c'])).toBe(true)
    expect(matchesAnyTag(['a'], ['b'])).toBe(false)
  })
})
