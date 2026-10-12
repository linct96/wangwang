import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse(readFileSync(new URL('../components.json', import.meta.url), 'utf8'))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(config.style, 'base-nova')
assert.ok(!Object.keys(pkg.dependencies).some((name) => /radix/.test(name)))

for (const [file, prefix] of [
  ['templates.css', 'template'],
  ['profile-editor.css', 'profile'],
]) {
  const styles = readFileSync(`${root}src/styles/${file}`, 'utf8')
  assert.match(styles, new RegExp(`\\.${prefix}-collapse-icon \\{[^}]*transform: rotate\\(-90deg\\)`), '折叠箭头朝右')
  assert.match(
    styles,
    new RegExp(`\\.${prefix}-collapse-icon\\.expanded \\{[^}]*transform: rotate\\(0deg\\)`),
    '展开箭头朝下',
  )
}

// Catch incompatible call sites before they become silent runtime regressions.
for (const file of readdirSync(`${root}src`, { recursive: true }).filter((file) => file.endsWith('.tsx'))) {
  const text = readFileSync(`${root}src/${file}`, 'utf8')
  assert.doesNotMatch(text, /radix-ui|asChild|--radix-/, file)
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function visit(node, inForm = false) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const element = ts.isJsxElement(node) ? node.openingElement : node
      const tag = element.tagName.getText(source)
      const attributes = element.attributes.properties
      const prop = (name) => attributes.find((attribute) => attribute.name?.getText(source) === name)
      inForm ||= tag === 'form'
      if (tag === 'Select') assert.ok(prop('items'), `${file}: Select needs labels before its popup mounts`)
      if (inForm && tag === 'Button' && !prop('render')) {
        assert.ok(prop('type'), `${file}: form buttons must declare submit or button`)
      }
    }
    ts.forEachChild(node, (child) => visit(child, inForm))
  }
  visit(source)
}

const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': `${root}src` } },
  server: { middlewareMode: true },
})
try {
  const { Button } = await server.ssrLoadModule('/src/components/ui/button.tsx')
  const { Select, SelectTrigger, SelectValue } = await server.ssrLoadModule('/src/components/ui/select.tsx')
  const { Checkbox } = await server.ssrLoadModule('/src/components/ui/checkbox.tsx')
  const { Progress } = await server.ssrLoadModule('/src/components/ui/progress.tsx')
  const { Segmented } = await server.ssrLoadModule('/src/components/ui/segmented.tsx')
  assert.match(renderToStaticMarkup(createElement(Button, { type: 'submit' }, '保存')), /type="submit"/)
  assert.match(
    renderToStaticMarkup(
      createElement(Button, { render: createElement('a', { href: '/profiles' }), nativeButton: false }, '配置'),
    ),
    /<a[^>]*href="\/profiles"/,
  )
  assert.match(
    renderToStaticMarkup(
      createElement(
        Select,
        { value: 'all', items: [{ value: 'all', label: '全部标签' }] },
        createElement(SelectTrigger, null, createElement(SelectValue)),
      ),
    ),
    /全部标签/,
  )
  assert.match(renderToStaticMarkup(createElement(Checkbox, { indeterminate: true })), /aria-checked="mixed"/)
  assert.match(
    renderToStaticMarkup(createElement(Progress, { value: 37, 'aria-label': '流量使用' })),
    /aria-valuenow="37"/,
  )

  const changes = []
  const segmented = Segmented({
    value: 6,
    options: [
      { value: 0, label: '关闭' },
      { value: 6, label: '6 小时' },
    ],
    onChange: (value) => changes.push(value),
  })
  assert.deepEqual(segmented.props.value, ['1'])
  segmented.props.onValueChange([])
  segmented.props.onValueChange(['1'])
  assert.deepEqual(changes, [], 'deselecting or reselecting must not select option zero')
  segmented.props.onValueChange(['0'])
  assert.deepEqual(changes, [0], 'numeric options keep their original type')
  const { parseVisualTemplate, applyVisualTemplate, inferSourceSlots } = await server.ssrLoadModule(
    '/src/features/templates/visual/yaml-adapter.ts',
  )
  const { validateVisualDraft } = await server.ssrLoadModule('/src/features/templates/visual/validation.ts')
  const { parse } = await import('yaml')
  const nodeSlot = { key: '__WANGWANG_SOURCE_SLOT_Nodes1__', name: '普通节点' }
  const subscriptionSlot = { key: '__WANGWANG_SOURCE_SLOT_AirptA__', name: '机场 A', type: 'subscription' }
  const yaml = `proxy-providers:\n  external: {type: http, url: https://example.com/sub}\nproxy-groups:\n  - name: mixed\n    type: select\n    proxies: [${nodeSlot.key}, DIRECT]\n    use: [external, ${subscriptionSlot.key}]\nrules: ['MATCH,mixed']\n`
  const parsed = parseVisualTemplate(yaml, [nodeSlot, subscriptionSlot])
  assert.equal(parsed.draft.groups[0].members.length, 3)
  assert.deepEqual(parsed.draft.groups[0].extras.use, ['external'])
  assert.equal(validateVisualDraft(parsed.draft).filter(({ level }) => level === 'error').length, 0)
  const roundtrip = parse(applyVisualTemplate(yaml, parsed.draft))
  assert.deepEqual(roundtrip['proxy-groups'][0].proxies, [nodeSlot.key, 'DIRECT'])
  assert.deepEqual(roundtrip['proxy-groups'][0].use, ['external', subscriptionSlot.key])
  assert.deepEqual(
    inferSourceSlots(yaml).map(({ key, type }) => [key, type]),
    [
      [nodeSlot.key, 'nodes'],
      [subscriptionSlot.key, 'subscription'],
    ],
  )
  parsed.draft.groups[0].includeAllProviders = true
  assert.equal(
    validateVisualDraft(parsed.draft).filter(({ level }) => level === 'error').length,
    0,
    '显式 use 与自动包含全部 provider 不阻断校验',
  )
  parsed.draft.groups[0].includeAllProviders = false
  parsed.draft.groups[0].members = parsed.draft.groups[0].members.filter(
    (member) => member.kind !== 'source-slot' || member.slotKey !== subscriptionSlot.key,
  )
  parsed.draft.groups[0].includeAllProxies = true
  assert.ok(
    validateVisualDraft(parsed.draft).some(
      ({ code, slotKey }) => code === 'SLOT_UNUSED' && slotKey === subscriptionSlot.key,
    ),
    '自动包含静态节点不能代替订阅槽位引用',
  )
  parsed.draft.groups[0].includeAllProviders = true
  assert.ok(
    !validateVisualDraft(parsed.draft).some(({ code }) => code === 'SLOT_UNUSED'),
    '自动包含 provider 也计为引用订阅槽位',
  )
  for (const flag of ['include-all', 'include-all-providers']) {
    const automatic = parseVisualTemplate(
      `proxy-groups:\n  - name: 自动包含\n    type: select\n    ${flag}: true\nrules: ['MATCH,自动包含']`,
      [subscriptionSlot],
    )
    assert.equal(validateVisualDraft(automatic.draft).filter(({ level }) => level === 'error').length, 0)
  }
  const { SlotCard } = await server.ssrLoadModule('/src/features/templates/visual/slots/slot-card.tsx')
  const slotMarkup = (slot, issues) =>
    renderToStaticMarkup(
      createElement(SlotCard, {
        slot,
        slots: [slot],
        groups: [],
        index: 0,
        issues,
        onSave() {},
        onDelete() {},
      }),
    )
  for (const slot of [nodeSlot, subscriptionSlot]) {
    const unused = slotMarkup(slot, [{ level: 'error', code: 'SLOT_UNUSED', message: '槽位未引用', slotKey: slot.key }])
    assert.match(unused, /未被代理组引用/)
    assert.match(unused, /lucide-plug/, '两种槽位使用相同插头图标')
    assert.match(
      unused,
      slot.type === 'subscription' ? /text-indigo-500/ : /text-amber-500/,
      'use 与 proxies 使用不同颜色',
    )
    assert.doesNotMatch(unused, /template-rule-issue|text-destructive/, '两种槽位未引用时均使用普通灰色提示')
    const invalid = slotMarkup(slot, [{ level: 'error', code: 'SLOT_NAME', message: '名称无效', slotKey: slot.key }])
    assert.match(invalid, /template-rule-issue/)
    assert.match(invalid, /text-destructive/, '其他槽位错误仍然标红')
  }
  const { SubscriptionSlotBindingEditor } = await server.ssrLoadModule(
    '/src/features/profiles/subscription-slot-binding-editor.tsx',
  )
  const picker = (sourceIds) =>
    renderToStaticMarkup(
      createElement(SubscriptionSlotBindingEditor, {
        slot: subscriptionSlot,
        value: { mode: 'source', sourceIds, includeRegex: null, excludeRegex: null },
        sources: [{ id: 'airport', name: '机场', kind: 'url', enabled: true, url: 'https://example.com/sub' }],
        onChange() {},
      }),
    )
  assert.match(picker([]), /请为此槽位选择一个订阅节点源/)
  assert.match(picker(['missing']), /绑定的节点源不存在/)
  assert.match(picker(['airport']), /机场 · 已启用/)
  const { ConfigPreviewPanel } = await server.ssrLoadModule('/src/components/config-preview-panel.tsx')
  const providerPreview = renderToStaticMarkup(
    createElement(ConfigPreviewPanel, { groups: [{ name: '仅订阅', type: 'select', use: ['wangwang-AirptA'] }] }),
  )
  assert.match(providerPreview, /use: wangwang-AirptA/)
  assert.doesNotMatch(providerPreview, /0 节点/)
  for (const group of [
    { name: '自动包含', type: 'select', includeAllProxies: true, includeAllProviders: true },
    { name: '标签兼容', type: 'select', staticProxies: ['包含全部节点', '包含全部代理集合'] },
  ]) {
    const markup = renderToStaticMarkup(createElement(ConfigPreviewPanel, { groups: [group] }))
    assert.match(markup, /text-amber-500/, '预览的全部节点沿用 proxies 槽位颜色')
    assert.match(markup, /text-indigo-500/, '预览的全部代理集合沿用 use 槽位颜色')
    assert.doesNotMatch(markup, /sky-/, '不再使用与 proxies 不一致的天蓝色')
  }
  console.log('订阅槽位 UI 回归通过：混用序列化、导入类型、自动包含兼容、单选状态与 provider 预览。')
  console.log('UI 迁移回归通过：单一 Base UI、调用 API、显式表单提交、首屏选项标签、半选、进度语义与分段选择。')
} finally {
  await server.close()
}
