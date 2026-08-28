import { describe, expect, it } from 'vitest'
import { parseVisualTemplate } from './yaml-adapter'
import { validateVisualDraft } from './validation'

describe('visual validation', () => {
  it('发现循环和 MATCH 顺序问题', () => {
    const draft = parseVisualTemplate(`proxy-groups:
  - name: A
    type: select
    proxies: [B]
  - name: B
    type: select
    proxies: [A]
rules:
  - MATCH,DIRECT
  - DOMAIN,,DIRECT
`).draft
    const issues = validateVisualDraft(draft)
    expect(issues.some((issue) => issue.code === 'GROUP_CYCLE' && issue.level === 'error')).toBe(true)
    expect(issues.some((issue) => issue.code === 'MATCH_NOT_LAST')).toBe(true)
  })
})
