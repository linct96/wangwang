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

const slotDialogSource = readFileSync(`${root}src/features/templates/visual/slots/slot-dialog.tsx`, 'utf8')
assert.match(slotDialogSource, /value: 'nodes', label: '节点槽位'/, '槽位类型选择器使用新名称')
assert.match(slotDialogSource, /<SelectItem value="nodes">节点槽位<\/SelectItem>/, '槽位类型选项名称保持一致')
assert.doesNotMatch(slotDialogSource, /普通节点槽位/, '不再展示旧类型名称')

const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': `${root}src` } },
  server: { middlewareMode: true },
})
try {
  const { Badge } = await server.ssrLoadModule('/src/components/ui/badge.tsx')
  const headerBadge = (label) => renderToStaticMarkup(createElement(Badge, { variant: 'secondary' }, label))
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
    assert.ok(
      unused.includes(headerBadge(slot.type === 'subscription' ? 'use' : 'proxies')),
      '槽位标题标签与代理组使用相同的 secondary 样式和默认尺寸',
    )
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
  const { compareMihomoNames } = await server.ssrLoadModule('/src/lib/mihomo.ts')
  const nodeNames = ['😀', '香港', '🇭🇰 HK', 'Z2', 'Z10', 'a', 'A1', 'A', '\uE000']
  const expectedNames = [...nodeNames].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  assert.deepEqual([...nodeNames].sort(compareMihomoNames), expectedNames, '名称排序与 Mihomo UTF-8 字节序一致')
  assert.equal(compareMihomoNames('香港', '香港'), 0)
  const directNodes = nodeNames.map((name, index) => ({
    id: `node-${index}`,
    physicalNodeId: `physical-${index}`,
    name,
    sourceId: 'source',
    sourceName: '节点源',
    enabled: true,
    sourceEnabled: true,
    tags: [],
  }))
  const directBinding = { mode: 'node', nodeIds: directNodes.map(({ id }) => id), missingNodeIds: [] }
  const { SlotBindingEditor } = await server.ssrLoadModule('/src/features/profiles/slot-binding-editor.tsx')
  const directPicker = (allowReorder, value = directBinding, nodes = directNodes) =>
    renderToStaticMarkup(
      createElement(SlotBindingEditor, {
        slot: nodeSlot,
        value,
        nodes,
        sources: [],
        tags: [],
        allowReorder,
        onChange() {},
      }),
    )
  const selectedNames = (markup) =>
    [...markup.matchAll(/class="selected-node-name"[^>]*>([^<]*)<\/span>/g)].map((match) => match[1])
  const automaticPicker = directPicker(false)
  assert.deepEqual(selectedNames(automaticPicker), expectedNames, '全部节点按名称展示，忽略选择顺序')
  assert.doesNotMatch(
    automaticPicker,
    /selected-node-drag-handle|已选及排序|勾选顺序即输出顺序|点击箭头|不支持手动排序|上下拖拽手柄/,
  )
  const regularPicker = directPicker(undefined)
  assert.deepEqual(selectedNames(regularPicker), nodeNames, '普通节点槽位保留指定顺序')
  assert.match(regularPicker, /selected-node-drag-handle/)
  assert.doesNotMatch(regularPicker, /不支持手动排序|上下拖拽手柄/)
  assert.match(directPicker(false, { ...directBinding, nodeIds: [] }), /已选节点自动按名称排序/)
  const unavailablePicker = directPicker(false, { ...directBinding, nodeIds: ['missing', 'node-0'] }, [
    { ...directNodes[0], enabled: false },
  ])
  assert.match(unavailablePicker, /2<\/strong> 个节点当前已停用或失效/)
  assert.match(unavailablePicker, /一键清除失效节点/)
  assert.match(unavailablePicker, /未知或已失效节点/)
  assert.equal((automaticPicker.match(/aria-label="移除该节点"/g) || []).length, nodeNames.length)
  assert.deepEqual(
    directBinding.nodeIds,
    directNodes.map(({ id }) => id),
    '展示排序不改写已保存的绑定顺序',
  )
  const { useProfilePreview } = await server.ssrLoadModule('/src/features/profiles/use-profile-preview.ts')
  function PreviewOrderCheck() {
    const automaticPreview = useProfilePreview(
      {
        yaml: `proxy-groups: [{name: 自动组, type: select, include-all-proxies: true}, {name: 槽位组, type: select, proxies: [${nodeSlot.key}]}]`,
        sourceSlots: [nodeSlot],
      },
      directBinding,
      [{ ...directBinding, slotKey: nodeSlot.key }],
      directNodes,
    )
    assert.deepEqual(
      automaticPreview.groups[0].nodes.map(({ name }) => name),
      expectedNames,
      '右侧全部节点预览与已选列表同序',
    )
    assert.deepEqual(
      automaticPreview.groups[1].nodes.map(({ name }) => name),
      nodeNames,
      '显式 proxies 槽位预览保留原顺序',
    )
    return null
  }
  renderToStaticMarkup(createElement(PreviewOrderCheck))

  const { SubscriptionSlotBindingEditor } = await server.ssrLoadModule(
    '/src/features/profiles/subscription-slot-binding-editor.tsx',
  )
  const picker = (sourceIds, showValidation = false, sourceOverrides = {}) =>
    renderToStaticMarkup(
      createElement(SubscriptionSlotBindingEditor, {
        slot: subscriptionSlot,
        value: { mode: 'source', sourceIds, includeRegex: null, excludeRegex: null },
        sources: [
          {
            id: 'airport',
            name: '机场',
            kind: 'url',
            enabled: true,
            url: 'https://example.com/sub',
            ...sourceOverrides,
          },
        ],
        showValidation,
        onChange() {},
      }),
    )
  assert.doesNotMatch(
    picker([]),
    /请为此槽位选择一个订阅节点源|aria-invalid="true"|data-invalid="true"/,
    '空槽位首屏不报错',
  )
  assert.match(picker([], true), /请为此槽位选择一个订阅节点源/, '提交后提示空槽位必填')
  assert.match(picker([], true), /aria-invalid="true"/)
  assert.match(picker(['missing']), /绑定的节点源不存在/)
  assert.match(picker(['airport'], false, { enabled: false }), /绑定的节点源已停用/)
  assert.match(picker(['airport'], false, { url: null }), /绑定源的订阅 URL 不可用/)
  assert.match(picker(['airport']), /机场/)
  assert.doesNotMatch(picker(['airport']), /已启用|不可用/, '订阅源选项仅显示名称')
  assert.doesNotMatch(picker(['airport'], true), /aria-invalid="true"/, '有效选择消除提交错误')
  const { SourceSlotTag } = await server.ssrLoadModule('/src/components/source-slot-tag.tsx')
  const { ConfigPreviewPanel } = await server.ssrLoadModule('/src/components/config-preview-panel.tsx')
  for (const type of ['select', 'url-test', 'fallback', 'load-balance', '自定义类型']) {
    for (const nodes of [[], [{ id: 'node', name: '节点' }]]) {
      const markup = renderToStaticMarkup(
        createElement(ConfigPreviewPanel, { groups: [{ name: '标题标签', type, nodes }] }),
      )
      assert.ok(markup.includes(headerBadge(type)), '预览组类型标签复用左侧代理组样式，不按类型换色或缩小')
      assert.ok(markup.includes(headerBadge(`${nodes.length} 节点`)), '预览标题右侧计数标签使用相同样式')
    }
  }
  for (const filter of [undefined, '不匹配']) {
    const emptyPreview = renderToStaticMarkup(
      createElement(ConfigPreviewPanel, { groups: [{ name: '空节点组', type: 'select', filter }] }),
    )
    assert.match(emptyPreview, /暂无节点/)
    assert.match(emptyPreview, /0 节点/)
    assert.doesNotMatch(
      emptyPreview,
      /当前未选择节点|preview-group-card-empty|data-variant="destructive"/,
      '空组使用中性占位',
    )
  }
  const nodePreview = renderToStaticMarkup(
    createElement(ConfigPreviewPanel, {
      sourceSlots: [nodeSlot],
      groups: [{ name: '节点槽位', type: 'select', staticProxies: [nodeSlot.key, 'DIRECT', '子组'] }],
    }),
  )
  assert.ok(
    nodePreview.includes(renderToStaticMarkup(createElement(SourceSlotTag, { slot: nodeSlot, placeholder: true }))),
  )
  assert.doesNotMatch(nodePreview, /普通节点示例/, '普通槽位显示占位标签，不显示示例节点')
  assert.match(nodePreview, /lucide-radio/, '内建策略图标不变')
  assert.match(nodePreview, /lucide-network/, '子组图标不变')
  const tagStyles = readFileSync(`${root}src/styles/components.css`, 'utf8')
  assert.match(tagStyles, /\.template-node-tag,\s*\.preview-node-tag\s*\{/, '左右标签共享基础样式')
  const emptyNoteStyles = tagStyles.match(/\.preview-empty-group-note\s*\{([^}]+)\}/)[1]
  assert.doesNotMatch(emptyNoteStyles, /destructive/, '空节点占位不使用错误色')
  assert.match(emptyNoteStyles, /var\(--muted-foreground\)/)
  const providerPreview = renderToStaticMarkup(
    createElement(ConfigPreviewPanel, { groups: [{ name: '仅订阅', type: 'select', use: ['wangwang-AirptA'] }] }),
  )
  assert.match(providerPreview, /use: wangwang-AirptA/)
  assert.doesNotMatch(providerPreview, /0 节点/)
  for (const reference of [subscriptionSlot.key, 'wangwang-AirptA']) {
    const markup = renderToStaticMarkup(
      createElement(ConfigPreviewPanel, {
        sourceSlots: [nodeSlot, subscriptionSlot],
        groups: [{ name: '槽位名称', type: 'select', use: [reference, 'external'] }],
      }),
    )
    const text = markup.replace(/<[^>]*>/g, '')
    assert.match(text, /机场 A/, 'use 槽位的原始 key 和编译标识都显示左侧槽位名称')
    assert.doesNotMatch(text, /订阅源 · 机场 A|wangwang-AirptA|__WANGWANG_SOURCE_SLOT_/, '不展示槽位内部标识或额外前缀')
    assert.match(text, /订阅源 · external/, '外部 provider 仍显示自己的名称')
    assert.match(markup, new RegExp(`use: ${reference}`), '提示保留真实引用标识')
    assert.ok(
      markup.includes(
        renderToStaticMarkup(
          createElement(SourceSlotTag, { slot: subscriptionSlot, title: `use: ${reference}`, placeholder: true }),
        ),
      ),
      '订阅槽位保留插头图标与槽位名称，并使用右侧占位标签样式',
    )
  }
  const { ProfilePreviewPanel } = await server.ssrLoadModule('/src/features/profiles/profile-preview-panel.tsx')
  const profileMarkup = renderToStaticMarkup(
    createElement(ProfilePreviewPanel, {
      sourceSlots: [subscriptionSlot],
      sources: [
        { id: 'airport', name: '真实订阅源' },
        { id: 'bound-airport', name: '槽位绑定订阅源' },
      ],
      slotBindings: [{ slotKey: subscriptionSlot.key, mode: 'source', sourceIds: ['bound-airport'] }],
      preview: {
        groups: [
          { name: '配置槽位', type: 'select', use: ['wangwang-AirptA'] },
          {
            name: '全部成员',
            type: 'select',
            nodes: [{ id: 'node', name: '真实节点' }],
            use: ['wangwang-source-airport', 'wangwang-AirptA'],
            includeAllProxies: true,
            includeAllProviders: true,
          },
          { name: '未选择成员', type: 'select', includeAllProxies: true, includeAllProviders: true },
        ],
        totalUniqueNodes: 1,
        emptyGroupCount: 0,
      },
    }),
  )
  assert.equal(
    (profileMarkup.match(/preview-node-tag-name">槽位绑定订阅源<\/span>/g) || []).length,
    2,
    '单独引用与自动包含的已绑定槽位都展示真实订阅源名称',
  )
  assert.match(
    profileMarkup,
    /class="preview-node-tag border-amber-500\/40[^>]*>[\s\S]*?preview-node-tag-name">真实节点/,
    '全部节点展示真实节点，使用实线边框并沿用橙色样式',
  )
  assert.match(
    profileMarkup,
    /class="preview-node-tag border-indigo-500\/40[^>]*>[\s\S]*?preview-node-tag-name">真实订阅源/,
    '全部订阅源展示源名称，使用实线边框并沿用靛蓝样式',
  )
  assert.match(profileMarkup, /preview-node-tag-name">槽位绑定订阅源/, '复用槽位 provider 时仍展示真实源名')
  assert.doesNotMatch(profileMarkup, /订阅源 · 真实订阅源/, '实际配置不显示额外前缀')
  assert.equal(
    (profileMarkup.match(/preview-node-tag-name">全部节点<\/span>/g) || []).length,
    1,
    '未选择节点时保留全部节点占位，已有节点时不重复显示',
  )
  assert.equal(
    (profileMarkup.match(/preview-node-tag-name">全部订阅源<\/span>/g) || []).length,
    1,
    '未选择订阅源时保留全部订阅源占位，已有订阅源时不重复显示',
  )
  assert.doesNotMatch(profileMarkup, /暂无节点/, '自动包含的占位符不应被空状态隐藏')
  for (const group of [
    { name: '自动包含', type: 'select', includeAllProxies: true, includeAllProviders: true },
    { name: '标签兼容', type: 'select', staticProxies: ['全部节点', '全部订阅源'] },
  ]) {
    const markup = renderToStaticMarkup(createElement(ConfigPreviewPanel, { groups: [group] }))
    assert.match(markup, /text-amber-500/, '预览的全部节点沿用 proxies 槽位颜色')
    assert.match(markup, /text-indigo-500/, '预览的全部订阅源沿用 use 槽位颜色')
    assert.doesNotMatch(markup, /sky-/, '不再使用与 proxies 不一致的天蓝色')
  }
  const profileEditorSource = readFileSync(`${root}src/features/profiles/profile-editor.tsx`, 'utf8')
  assert.match(
    profileEditorSource,
    /slot=\{NODE_BINDING_EDITOR_SCOPE\}\s+allowReorder=\{false\}/,
    '全部节点入口禁用手动排序',
  )
  assert.doesNotMatch(profileEditorSource, /动态节点槽 ·|订阅源槽位 ·/, '槽位标题不再带有旧前缀')
  assert.match(profileEditorSource, /Network className="size-4 text-amber-500"/, '全部节点图标与右侧预览配色一致')
  assert.match(
    profileEditorSource,
    /Boxes className="size-4 text-indigo-500"/,
    '全部订阅源图标与右侧预览全部订阅源配色一致',
  )
  assert.match(
    profileEditorSource,
    /slot\.type === 'subscription' \? 'text-indigo-500' : 'text-amber-500'/,
    '槽位图标配色与模板保持一致',
  )
  assert.doesNotMatch(
    profileEditorSource,
    /<Badge\b[^>]*>\s*(?:proxy-providers|\{slot\.type === 'subscription' \? 'use' : 'proxies'\})\s*<\/Badge>/,
    '订阅配置模块标题不展示配置字段类型 Badge',
  )
  const subscriptionSourcesEditorSource = readFileSync(
    `${root}src/features/profiles/subscription-sources-editor.tsx`,
    'utf8',
  )
  assert.doesNotMatch(
    subscriptionSourcesEditorSource,
    /由客户端拉取和更新，不展开本地节点/,
    '全部订阅源不再展示冗余的更新说明文案',
  )
  assert.match(subscriptionSourcesEditorSource, /选择接入订阅源/, '全部订阅源对齐全部节点的接入选择标题')
  assert.match(subscriptionSourcesEditorSource, /source-picker-grid/, '全部订阅源沿用全部节点的网格布局')
  const geoPanelSource = readFileSync(`${root}src/features/templates/visual/geo/geo-settings-panel.tsx`, 'utf8')
  assert.doesNotMatch(geoPanelSource, /GEO 规则数据源/, 'GEO 面板标题不再使用旧文案')
  assert.match(geoPanelSource, /<strong>GEO 数据库 \(GeoData\)<\/strong>/, 'GEO 标题采用与流量嗅探一致的中英文规范')
  assert.match(geoPanelSource, /Map className="size-4 text-sky-500"/, 'GEO 图标采用地图图标并搭配明亮天蓝色')

  const { GeoSettingsPanel } = await server.ssrLoadModule('/src/features/templates/visual/geo/geo-settings-panel.tsx')
  const { SnifferSettingsPanel } = await server.ssrLoadModule(
    '/src/features/templates/visual/sniffer/sniffer-settings-panel.tsx',
  )
  const geoMarkup = renderToStaticMarkup(
    createElement(GeoSettingsPanel, { value: { geoxUrl: {} }, issues: [], onChange: () => {} }),
  )
  const snifferMarkup = renderToStaticMarkup(
    createElement(SnifferSettingsPanel, {
      value: { sniff: { HTTP: {}, TLS: {}, QUIC: {} } },
      issues: [],
      onChange: () => {},
    }),
  )
  assert.match(geoMarkup, /class="[^"]*lucide-map[^"]*size-4 text-sky-500[^"]*"/, 'GEO 模块渲染专属 Map 图标与配色')
  assert.match(geoMarkup, /<strong>GEO 数据库 \(GeoData\)<\/strong>/, 'GEO 模块渲染统一风格标题')
  assert.match(
    snifferMarkup,
    /class="[^"]*lucide-radar[^"]*size-4 text-purple-500[^"]*"/,
    '流量嗅探渲染 Radar 图标与配色',
  )
  assert.match(snifferMarkup, /<strong>流量嗅探 \(Sniffer\)<\/strong>/, '流量嗅探保持统一风格标题')

  console.log('订阅槽位 UI 回归通过：混用序列化、导入类型、自动包含兼容、单选状态与 provider 预览。')
  console.log('UI 迁移回归通过：单一 Base UI、调用 API、显式表单提交、首屏选项标签、半选、进度语义与分段选择。')
} finally {
  await server.close()
}
