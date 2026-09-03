import { nanoid } from 'nanoid'

export function createBlankTemplate(): string {
  const slotKey = `__WANGWANG_SOURCE_SLOT_${nanoid(6)}__`
  return `x-wangwang:
  sources:
    - key: ${slotKey}
      name: 默认节点源
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - ${slotKey}
      - DIRECT
rules:
  - MATCH,节点选择
`
}
