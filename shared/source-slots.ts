export type TemplateSourceSlot = { key: string; name: string; type: 'nodes' | 'subscription' }

export function slotProviderName(key: string) {
  return `wangwang-${key.replace(/^__WANGWANG_SOURCE_SLOT_/, '').replace(/__$/, '')}`
}

export function sourceProviderName(sourceId: string) {
  return `wangwang-source-${sourceId}`
}
