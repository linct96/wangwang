import { describe, expect, it } from 'vitest'
import {
  validateBindingsPure,
  type BindingSourceRecord,
  type ProfileSourceBindingInput,
} from '../worker/profile-source-bindings'
import type { TemplateSourceSlot } from '../worker/templates/source-slots'

describe('Profile source bindings validation', () => {
  const slots: TemplateSourceSlot[] = [
    { key: '__WANGWANG_SOURCE_SLOT_main01__', name: '主力节点' },
    { key: '__WANGWANG_SOURCE_SLOT_game01__', name: '游戏节点' },
  ]

  const sourcesMap = new Map<string, BindingSourceRecord>([
    ['src-1', { id: 'src-1', enabled: true }],
    ['src-2', { id: 'src-2', enabled: true }],
    ['src-disabled', { id: 'src-disabled', enabled: false }],
  ])

  it('有效绑定保持模板槽位顺序并去除单槽位内重复 sourceId', () => {
    const input: ProfileSourceBindingInput[] = [
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: ['src-2', 'src-2'] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ['src-1', 'src-2'] },
    ]
    const result = validateBindingsPure({
      slots,
      bindings: input,
      knownSources: sourcesMap,
    })
    expect(result).toEqual([
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ['src-1', 'src-2'] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: ['src-2'] },
    ])
  })

  it('缺少槽位绑定时报错', () => {
    const input: ProfileSourceBindingInput[] = [{ slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ['src-1'] }]
    expect(() =>
      validateBindingsPure({
        slots,
        bindings: input,
        knownSources: sourcesMap,
      }),
    ).toThrow('缺少槽位绑定：游戏节点')
  })

  it('包含未声明的多余槽位时报错', () => {
    const input: ProfileSourceBindingInput[] = [
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ['src-1'] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: ['src-2'] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_extra1__', sourceIds: ['src-1'] },
    ]
    expect(() =>
      validateBindingsPure({
        slots,
        bindings: input,
        knownSources: sourcesMap,
      }),
    ).toThrow('包含未知的节点源槽位：__WANGWANG_SOURCE_SLOT_extra1__')
  })

  it('输入中存在重复槽位项时报错', () => {
    const input: ProfileSourceBindingInput[] = [
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ['src-1'] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ['src-2'] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: ['src-2'] },
    ]
    expect(() =>
      validateBindingsPure({
        slots,
        bindings: input,
        knownSources: sourcesMap,
      }),
    ).toThrow('槽位绑定重复：__WANGWANG_SOURCE_SLOT_main01__')
  })

  it('槽位未绑定任何节点源时报错', () => {
    const input: ProfileSourceBindingInput[] = [
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: [] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: ['src-2'] },
    ]
    expect(() =>
      validateBindingsPure({
        slots,
        bindings: input,
        knownSources: sourcesMap,
      }),
    ).toThrow('槽位“主力节点”必须至少绑定一个节点源')
  })

  it('引用不存在的节点源时报错', () => {
    const input: ProfileSourceBindingInput[] = [
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ['non-existent'] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: ['src-2'] },
    ]
    expect(() =>
      validateBindingsPure({
        slots,
        bindings: input,
        knownSources: sourcesMap,
      }),
    ).toThrow('节点源不存在：non-existent')
  })

  it('新绑定已禁用的节点源时报错', () => {
    const input: ProfileSourceBindingInput[] = [
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ['src-1', 'src-disabled'] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: ['src-2'] },
    ]
    expect(() =>
      validateBindingsPure({
        slots,
        bindings: input,
        knownSources: sourcesMap,
      }),
    ).toThrow('不能绑定已禁用的节点源：src-disabled')
  })

  it('允许已存在绑定的禁用节点源保留，但槽位全禁用时报错', () => {
    const existing = new Set(['__WANGWANG_SOURCE_SLOT_main01__:src-disabled'])
    const input: ProfileSourceBindingInput[] = [
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ['src-disabled'] },
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: ['src-2'] },
    ]
    expect(() =>
      validateBindingsPure({
        slots,
        bindings: input,
        knownSources: sourcesMap,
        existingSlotSourcePairs: existing,
      }),
    ).toThrow('槽位“主力节点”必须至少包含一个启用的节点源')
  })

  it('跨槽位引用相同节点源只计数一次且不超过 20 个', () => {
    const twentySources = new Map<string, BindingSourceRecord>()
    for (let i = 1; i <= 20; i++) {
      twentySources.set(`src-${i}`, { id: `src-${i}`, enabled: true })
    }
    const ids = Array.from({ length: 20 }, (_, i) => `src-${i + 1}`)
    const input: ProfileSourceBindingInput[] = [
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ids },
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: [ids[0], ids[1]] },
    ]
    const result = validateBindingsPure({
      slots,
      bindings: input,
      knownSources: twentySources,
    })
    expect(result.length).toBe(2)
  })

  it('超过 20 个不同节点源时报错', () => {
    const twentyOneSources = new Map<string, BindingSourceRecord>()
    for (let i = 1; i <= 21; i++) {
      twentyOneSources.set(`src-${i}`, { id: `src-${i}`, enabled: true })
    }
    const ids = Array.from({ length: 21 }, (_, i) => `src-${i + 1}`)
    const input: ProfileSourceBindingInput[] = [
      { slotKey: '__WANGWANG_SOURCE_SLOT_main01__', sourceIds: ids.slice(0, 15) },
      { slotKey: '__WANGWANG_SOURCE_SLOT_game01__', sourceIds: ids.slice(15) },
    ]
    expect(() =>
      validateBindingsPure({
        slots,
        bindings: input,
        knownSources: twentyOneSources,
      }),
    ).toThrow('配置引用的不同节点源总数不能超过 20 个')
  })
})
