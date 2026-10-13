import assert from 'node:assert/strict'
import { nanoid } from 'nanoid'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { z } from 'zod'
import { revalidateLogic } from '@tanstack/react-form'
import { createServer } from 'vite'

// Deterministic hook/event checks against actual source, not a React scheduler or DOM simulation.
const tick = () => new Promise((resolve) => setImmediate(resolve))
const sources = new Map()
function source(path) {
  if (!sources.has(path)) {
    const text = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
    sources.set(path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))
  }
  return sources.get(path)
}
function nodes(path, predicate) {
  const result = []
  function visit(node) {
    if (predicate(node)) result.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source(path))
  return result
}
function evaluate(text, context) {
  const code = ts.transpileModule(`const run = (${text.replace(/^export\s+/, '')}); exports.run = run`, {
    fileName: 'check.tsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, AbortController, Error, ...context })
  return exports.run
}
function harness(path, name, dependencies = {}) {
  const ast = source(path)
  const fn = nodes(path, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name)[0]
  assert.ok(fn, `${path}: ${name}`)
  const slots = []
  const requests = []
  let cursor = 0
  let effects = []
  const changed = (previous, next) => !previous || next.some((value, index) => !Object.is(value, previous[index]))
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [
        slots[index].value,
        (next) => {
          slots[index].value = typeof next === 'function' ? next(slots[index].value) : next
        },
      ]
    },
    useRef(initial) {
      const index = cursor++
      slots[index] ||= { value: { current: initial } }
      return slots[index].value
    },
    useMemo(fn, deps) {
      const index = cursor++
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { value: fn(), deps }
      return slots[index].value
    },
    useCallback(fn, deps) {
      return hooks.useMemo(() => fn, deps)
    },
    useEffect(fn, deps) {
      const index = cursor++
      if (!slots[index] || changed(slots[index].deps, deps)) {
        const cleanup = slots[index]?.cleanup
        slots[index] = { deps, effect: fn }
        effects.push(() => {
          cleanup?.()
          slots[index].cleanup = fn()
        })
      }
    },
  }
  const symbols = {}
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    if (node.importClause?.name) symbols[node.importClause.name.text] = node.importClause.name.text
    const bindings = node.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) symbols[binding.name.text] = binding.name.text
    }
  }
  const run = evaluate(fn.getText(ast), {
    ...symbols,
    ...hooks,
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    api: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
    useNavigate: () => () => {},
    useTheme: () => ({ resolvedTheme: 'light' }),
    cache: new Map(),
    ...dependencies,
  })
  return {
    requests,
    render(...args) {
      cursor = 0
      return run(...args)
    },
    flush() {
      const pending = effects
      effects = []
      pending.forEach((effect) => effect())
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.())
      effects = []
    },
    replayEffects() {
      slots.forEach((slot) => {
        if (slot.effect) {
          slot.cleanup?.()
          slot.cleanup = slot.effect()
        }
      })
    },
  }
}
function find(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((node) => find(node, type))
  if (!tree || typeof tree !== 'object') return []
  return [...(tree.type === type ? [tree] : []), ...find(tree.props?.children, type)]
}

const api = harness('api/use-api.ts', 'useApi')
api.render('/nodes?q=A')
api.flush()
api.requests[0].resolve({ result: 'A' })
await tick()
const staleReload = api.render('/nodes?q=A').reload
const refreshing = staleReload()
assert.equal(api.requests[0].options.signal.aborted, true)
assert.equal(api.render('/nodes?q=A').loading, true)
assert.equal(api.render('/nodes?q=A').data.result, 'A', 'same-path refresh preserves data')
assert.equal(api.render('/nodes?q=B').data, undefined, 'new path hides old results before effects run')
api.flush()
assert.equal(api.requests[1].options.signal.aborted, true, 'path cleanup cancels manual refresh')
api.requests[2].resolve({ result: 'B' })
await tick()
api.requests[1].resolve({ result: 'stale A' })
await refreshing
assert.equal(api.render('/nodes?q=B').data.result, 'B')
await staleReload()
assert.equal(api.requests.length, 3, 'an old event closure cannot cancel the current path request')
const first = api.render('/nodes?q=B').reload()
const second = api.render('/nodes?q=B').reload()
api.requests[4].reject(new Error('offline'))
await second
api.requests[3].resolve({ result: 'stale B' })
await first
assert.equal(api.render('/nodes?q=B').error, 'offline')
assert.equal(api.render('/nodes?q=B').loading, false)
const recovery = api.render('/nodes?q=B').reload()
api.requests[5].resolve({ result: 'recovered B' })
await recovery
assert.equal(api.render('/nodes?q=B').error, '')
const unmounted = api.render('/nodes?q=B').reload()
api.unmount()
assert.equal(api.requests[6].options.signal.aborted, true)
api.requests[6].resolve({ result: 'unmounted' })
await unmounted
assert.equal(api.render('/nodes?q=B').data.result, 'recovered B')
await api.render('/nodes?q=B').reload()
assert.equal(api.requests.length, 7)
const strict = harness('api/use-api.ts', 'useApi')
strict.render('/nodes')
strict.flush()
strict.replayEffects()
assert.equal(strict.requests[0].options.signal.aborted, true)
strict.requests[1].resolve('current')
await tick()
strict.requests[0].resolve('discarded')
await tick()
assert.equal(strict.render('/nodes').data, 'current')
strict.unmount()

const geo = harness('features/templates/visual/rules/use-geo-catalog.ts', 'useGeoCatalog')
geo.render('geosite', 'metacubex')
geo.flush()
geo.requests[0].resolve({ items: ['geosite-only'] })
await tick()
assert.equal(geo.render('geoip', 'metacubex').data, undefined)
geo.flush()
assert.equal(geo.render('geoip', 'metacubex').loading, true)
assert.equal(geo.render('geoip', 'custom').loading, false)
assert.equal(geo.render('geoip', 'custom').data, undefined)
geo.flush()
geo.requests[1].resolve({ items: ['stale-geoip'] })
await tick()
geo.render('geoip', 'loyalsoldier')
geo.flush()
geo.requests[2].reject(new Error('catalog offline'))
await tick()
assert.equal(geo.render('geoip', 'loyalsoldier').error, 'catalog offline')
geo.render('geoip', 'custom')
geo.flush()
geo.render('geoip', 'loyalsoldier')
geo.flush()
assert.equal(geo.render('geoip', 'loyalsoldier').error, undefined)
geo.requests[3].resolve({ items: ['recovered'] })
await tick()
assert.equal(geo.render('geoip', 'loyalsoldier').data.items[0], 'recovered')

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  resolve: { alias: { '@': new URL('../src', import.meta.url).pathname } },
})
try {
  const adapter = await server.ssrLoadModule('/src/features/templates/visual/yaml-adapter.ts')
  const validation = await server.ssrLoadModule('/src/features/templates/visual/validation.ts')
  const geoCatalog = await server.ssrLoadModule('/src/features/templates/visual/rules/geo-catalog.ts')
  const timers = new Map()
  let timerId = 0
  const editorPath = 'features/templates/editor.tsx'
  const blank = nodes(
    editorPath,
    (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'blankTemplate',
  )[0]
  const editor = harness(editorPath, 'TemplateEditor', {
    ...adapter,
    ...validation,
    ...geoCatalog,
    blankTemplate: evaluate(`() => ${blank.initializer.getText()}`, {})(),
    blankSourceSlots: [],
    YamlCodeEditor: 'YamlCodeEditor',
    window: {
      setTimeout(fn) {
        timers.set(++timerId, fn)
        return timerId
      },
      clearTimeout(id) {
        timers.delete(id)
      },
    },
  })
  let tree = editor.render({ source: 'blank' })
  editor.flush()
  assert.equal(find(tree, 'Segmented')[0].props.value, 'visual')
  find(tree, 'Segmented')[0].props.onChange('yaml')
  tree = editor.render({ source: 'blank' })
  editor.flush()
  const yaml =
    'proxy-groups:\n  - name: Test\n    type: select\n    proxies: [DIRECT]\nrules:\n  - DOMAIN,example.com,DIRECT\n  - MATCH,Test\n'
  find(tree, 'YamlCodeEditor')[0].props.onChange(yaml)
  tree = editor.render({ source: 'blank' })
  editor.flush()
  assert.equal(find(tree, 'Segmented')[0].props.value, 'yaml', 'valid YAML edits must not switch modes')
  find(tree, 'Segmented')[0].props.onChange('visual')
  tree = editor.render({ source: 'blank' })
  editor.flush()
  const visual = find(tree, 'VisualTemplateEditor')[0].props
  visual.onChange({ ...visual.draft, rules: [...visual.draft.rules].reverse() }, { type: 'reorder', scope: 'rules' })
  tree = editor.render({ source: 'blank' })
  const preview = find(tree, 'TemplatePreview')[0].props.yaml
  assert.match(preview, /MATCH,Test[\s\S]*DOMAIN,example.com,DIRECT/)
  find(tree, 'Segmented')[0].props.onChange('yaml')
  tree = editor.render({ source: 'blank' })
  assert.equal(find(tree, 'YamlCodeEditor')[0].props.value, preview, 'materialized YAML matches the preview')
  assert.equal(timers.size, 1)
  editor.unmount()
  assert.equal(timers.size, 0)

  const { parse } = await import('yaml')
  const { compareMihomoNames, resolveProxyGroupIncludeAll } = await server.ssrLoadModule('/src/lib/mihomo.ts')
  const directNodes = ['z', 'A', '香港', '😀'].map((name, index) => ({
    id: `direct-${index}`,
    name,
    sourceId: 'source',
    sourceName: '节点源',
    enabled: true,
    sourceEnabled: true,
  }))
  let directValue = { mode: 'node', nodeIds: directNodes.map(({ id }) => id), missingNodeIds: [] }
  const direct = harness('features/profiles/direct-node-binding-editor.tsx', 'DirectNodeBindingEditor', {
    compareMihomoNames,
    cn: (...classes) => classes.filter(Boolean).join(' '),
    isSortableOperation: () => true,
  })
  const directProps = {
    slot: { key: 'global' },
    nodes: directNodes,
    allowReorder: false,
    onChange(next) {
      directValue = next
    },
  }
  const directTree = () => direct.render({ ...directProps, value: directValue })
  const selectedIds = (tree) => find(tree, 'SortableSelectedNode').map(({ props }) => props.nodeId)
  let directTreeValue = directTree()
  assert.deepEqual(selectedIds(directTreeValue), ['direct-1', 'direct-0', 'direct-2', 'direct-3'])
  assert.ok(find(directTreeValue, 'SortableSelectedNode').every(({ props }) => props.allowReorder === false))
  const originalValue = directValue
  find(directTreeValue, 'DragDropProvider')[0].props.onDragEnd({
    operation: { source: { initialIndex: 0, index: 2 } },
  })
  assert.equal(directValue, originalValue, '全部节点即使收到拖拽事件也不修改顺序')
  find(directTreeValue, 'SortableSelectedNode')[0].props.onRemove()
  assert.deepEqual(
    Array.from(directValue.nodeIds),
    ['direct-0', 'direct-2', 'direct-3'],
    '名称排序后按 ID 移除，不按显示索引移除',
  )
  directTreeValue = directTree()
  find(directTreeValue, 'Checkbox')[1].props.onCheckedChange()
  assert.deepEqual(selectedIds(directTree()), ['direct-1', 'direct-0', 'direct-2', 'direct-3'], '重新选择仍按名称排序')
  directTreeValue = direct.render({ ...directProps, value: directValue, allowReorder: true })
  assert.deepEqual(selectedIds(directTreeValue), ['direct-0', 'direct-2', 'direct-3', 'direct-1'])
  find(directTreeValue, 'DragDropProvider')[0].props.onDragEnd({
    operation: { source: { initialIndex: 0, index: 2 } },
  })
  assert.deepEqual(
    Array.from(directValue.nodeIds),
    ['direct-2', 'direct-3', 'direct-0', 'direct-1'],
    '普通槽位仍允许手动排序',
  )
  const sortableCalls = []
  const selectedRow = harness('features/profiles/sortable-selected-node.tsx', 'SortableSelectedNode', {
    useSortable(input) {
      sortableCalls.push(input)
      return { ref: 'sortable-ref' }
    },
    cn: (...classes) => classes.filter(Boolean).join(' '),
  })
  const automaticRow = selectedRow.render({
    node: directNodes[0],
    nodeId: 'direct-0',
    index: 0,
    allowReorder: false,
    onRemove() {},
  })
  const manualRow = selectedRow.render({ node: directNodes[0], nodeId: 'direct-0', index: 0, onRemove() {} })
  assert.equal(automaticRow.props.ref, undefined, '自动排序行不挂载拖拽 DOM 属性，移除按钮保持可用')
  assert.equal(manualRow.props.ref, 'sortable-ref')
  assert.deepEqual(
    sortableCalls.map(({ disabled }) => disabled),
    [true, false],
    '全部节点禁用拖拽传感器，普通槽位保留拖拽',
  )
  const previewSlots = [
    { key: '__WANGWANG_SOURCE_SLOT_Nodes1__', name: '普通节点', type: 'nodes' },
    { key: '__WANGWANG_SOURCE_SLOT_AirptA__', name: '机场 A', type: 'subscription' },
  ]
  const templateYaml = `proxy-groups:\n  - name: 模板组\n    type: select\n    proxies: [${previewSlots[0].key}, DIRECT]\n    use: [${previewSlots[1].key}, external]\n    include-all: true\nrules: ['MATCH,模板组']\n`
  const compiledYaml =
    'proxy-groups: [{name: 模板组, type: select, proxies: [普通节点示例, DIRECT], use: [wangwang-AirptA, external], include-all: true}]'
  const templatePreview = () =>
    harness('features/templates/template-preview.tsx', 'TemplatePreview', {
      parse,
      resolveProxyGroupIncludeAll,
      setTimeout(fn) {
        timers.set(++timerId, fn)
        return timerId
      },
      clearTimeout(id) {
        timers.delete(id)
      },
    })
  for (const props of [
    { yaml: templateYaml, sourceSlots: previewSlots },
    { templateId: 'saved-template', auto: true },
  ]) {
    const view = templatePreview()
    view.render(props)
    view.flush()
    for (const [id, run] of timers) {
      timers.delete(id)
      run()
    }
    if (props.templateId) {
      assert.equal(view.requests[0].path, '/templates/saved-template')
      view.requests[0].resolve({ yaml: templateYaml, sourceSlots: previewSlots })
      await tick()
    }
    const request = view.requests.at(-1)
    assert.equal(request.path, '/templates/preview')
    assert.deepEqual(JSON.parse(request.options.body), { yaml: templateYaml, sourceSlots: previewSlots })
    request.resolve({ yaml: compiledYaml, nodeCount: 2 })
    await tick()
    const panel = find(view.render(props), 'ConfigPreviewPanel')[0].props
    assert.deepEqual(
      Array.from(panel.groups[0].staticProxies),
      [previewSlots[0].key, 'DIRECT'],
      '标签来源于模板，不是假节点',
    )
    assert.deepEqual(Array.from(panel.groups[0].use), [previewSlots[1].key, 'external'])
    assert.equal(panel.groups[0].includeAllProxies, true)
    assert.equal(panel.groups[0].includeAllProviders, true)
    assert.deepEqual(panel.sourceSlots, previewSlots)
    assert.equal(panel.yaml, compiledYaml, '编译 YAML 保持原样')
    assert.equal(panel.nodeCount, 2)
    view.unmount()
    assert.equal(timers.size, 0)
  }

  const slotFixtures = [
    { key: '__WANGWANG_SOURCE_SLOT_Bound1__', name: '已绑定', type: 'nodes' },
    { key: '__WANGWANG_SOURCE_SLOT_Free01__', name: '未绑定', type: 'nodes' },
  ]
  for (const props of [{ id: 'in-use' }, { source: 'builtin:minimal' }]) {
    const loaded = harness(editorPath, 'TemplateEditor', {
      ...adapter,
      ...validation,
      ...geoCatalog,
      blankSourceSlots: [],
    })
    loaded.render(props)
    loaded.flush()
    loaded.requests[0].resolve({
      name: '在用模板',
      description: null,
      profileCount: 5,
      sourceSlots: slotFixtures,
      boundSlotKeys: [slotFixtures[0].key],
      yaml,
    })
    await tick()
    const loadedTree = loaded.render(props)
    assert.deepEqual(
      Array.from(find(loadedTree, 'VisualTemplateEditor')[0].props.boundSlotKeys),
      props.id ? [slotFixtures[0].key] : [],
      '仅编辑原模板时使用槽位绑定锁定，复制不继承锁定',
    )
    loaded.unmount()
  }
  const slotList = harness('features/templates/visual/slots/slot-list.tsx', 'SlotList')
  const slotListTree = slotList.render({
    slots: slotFixtures,
    groups: [],
    issues: [],
    boundSlotKeys: [slotFixtures[0].key],
    onChange() {},
    onSave() {},
    onDelete() {},
  })
  assert.deepEqual(
    find(slotListTree, 'SlotCard').map(({ props }) => props.typeLocked),
    [true, false],
    '锁定按槽位 key 分配，不再锁住整个模板',
  )
  for (const typeLocked of [true, false]) {
    const dialog = harness('features/templates/visual/slots/slot-dialog.tsx', 'SlotDialog', { slotTypeOptions: [] })
    const props = { slots: slotFixtures, groups: [], value: slotFixtures[0], typeLocked, children: '编辑', onSave() {} }
    const closed = dialog.render(props)
    find(closed, 'span')[0].props.onClick({ stopPropagation() {} })
    assert.equal(
      find(dialog.render(props), 'Select')[0].props.disabled,
      typeLocked,
      '未被代理组引用时仍按实际配置绑定判断类型控件是否禁用',
    )
  }

  const subscriptionFixture = { key: '__WANGWANG_SOURCE_SLOT_AirptA__', name: '机场 A', type: 'subscription' }
  const structuredGroup = {
    kind: 'structured',
    id: 'test-group',
    name: '测试组',
    type: 'select',
    members: [{ kind: 'source-slot', slotKey: subscriptionFixture.key }],
    extras: {},
    includeAllProviders: true,
  }
  const warningCases = [
    [structuredGroup, true],
    [{ ...structuredGroup, includeAllProxies: true }, true],
    [{ ...structuredGroup, members: [], extras: { use: ['external'] } }, true],
    [{ ...structuredGroup, members: [{ kind: 'source-slot', slotKey: slotFixtures[0].key }] }, false],
    [{ ...structuredGroup, members: [] }, false],
    [{ ...structuredGroup, includeAllProviders: false }, false],
    [
      {
        kind: 'raw',
        id: 'raw-group',
        name: '高级组',
        type: 'select',
        raw: { 'include-all': true, 'include-all-providers': false, use: ['external'] },
      },
      true,
    ],
    [
      {
        kind: 'raw',
        id: 'raw-group',
        name: '高级组',
        type: 'select',
        raw: { 'include-all-proxies': true, use: ['external'] },
      },
      false,
    ],
  ]
  const { cn } = await server.ssrLoadModule('/src/lib/utils.ts')
  for (const type of ['select', 'url-test', 'fallback', 'load-balance']) {
    assert.deepEqual(adapter.newGroup(type, []).members, [], '所有新代理组默认不引用槽位')
  }
  for (const sourceSlots of [[], previewSlots, [...previewSlots].reverse()]) {
    const dialog = harness('features/templates/visual/groups/group-dialog.tsx', 'GroupDialog', {
      newGroup: adapter.newGroup,
      memberLabel: () => 'DIRECT',
      cn,
      FieldHelp: 'FieldHelp',
      ProxyGroupIconPicker: 'ProxyGroupIconPicker',
    })
    const props = { groups: [], sourceSlots, onSave() {}, children: '添加' }
    const open = () => {
      find(dialog.render(props), 'span')[0].props.onClick({ stopPropagation() {} })
      return dialog.render(props)
    }
    let tree = open()
    const members = find(tree, 'MemberEditor')[0].props
    assert.equal(members.form.members.length, 0, '有无槽位及槽位顺序都不影响新建默认留空')
    members.onChange({ ...members.form, members: [{ kind: 'builtin', value: 'DIRECT' }] })
    tree = dialog.render(props)
    find(tree, 'AppDialog')[0].props.onClose()
    tree = open()
    assert.equal(find(tree, 'MemberEditor')[0].props.form.members.length, 0, '重新打开添加弹窗恢复空成员')
    dialog.unmount()
  }
  const memberPath = 'features/templates/visual/groups/member-editor.tsx'
  const duplicateDraft = adapter.parseVisualTemplate(
    templateYaml.replace('DIRECT]', `DIRECT, DIRECT, ${previewSlots[0].key}]`),
    previewSlots,
  ).draft
  let memberForm = duplicateDraft.groups[0]
  const originalMembers = JSON.stringify(memberForm.members)
  let memberChanges = 0
  const memberEditor = harness(memberPath, 'MemberEditor', {
    nanoid,
    cn,
    memberLabel: (member) => member.value || member.slotKey,
    MemberTag: 'MemberTag',
    isSortableOperation: () => true,
  })
  const renderMembers = () =>
    memberEditor.render({
      form: memberForm,
      groups: duplicateDraft.groups,
      sourceSlots: previewSlots,
      onChange(next) {
        memberForm = next
        memberChanges++
      },
    })
  let memberTree = renderMembers()
  const initialTags = find(memberTree, 'MemberTag')
  const ids = new Map(initialTags.map(({ props }) => [props.member, props.id]))
  assert.equal(new Set(ids.values()).size, memberForm.members.length, '导入的重复节点和槽位拥有独立身份')
  const checkMemberIds = () => {
    const tags = find(memberTree, 'MemberTag')
    tags.forEach(({ props }, index) => {
      assert.equal(props.key, props.id, 'React key 与拖拽 id 相同')
      assert.equal(props.id, ids.get(props.member), '移动或删除不改变其他成员身份')
      let sortable
      harness(memberPath, 'MemberTag', {
        cn,
        memberLabel: () => '成员',
        useSortable(input) {
          sortable = input
          return {}
        },
      }).render(props)
      assert.equal(sortable.id, props.id)
      assert.equal(sortable.index, index, '只有排序位置随顺序变化')
    })
  }
  checkMemberIds()
  for (const [from, to] of [
    [0, 4],
    [3, 1],
    [4, 0],
  ]) {
    find(memberTree, 'DragDropProvider')[0].props.onDragEnd({
      operation: { source: { initialIndex: from, index: to } },
    })
    memberTree = renderMembers()
    checkMemberIds()
  }
  for (const event of [
    { canceled: true, operation: { source: { initialIndex: 0, index: 2 } } },
    { operation: {} },
    { operation: { source: { initialIndex: 0, index: 0 } } },
    { operation: { source: { initialIndex: -1, index: 2 } } },
    { operation: { source: { initialIndex: 0, index: 99 } } },
  ])
    find(memberTree, 'DragDropProvider')[0].props.onDragEnd(event)
  assert.equal(memberChanges, 3, '取消、无目标、原位和越界拖拽不修改成员')
  const remaining = memberForm.members.filter((_, index) => index !== 1)
  find(memberTree, 'MemberTag')[1].props.onDelete()
  assert.deepEqual(Array.from(memberForm.members), Array.from(remaining))
  memberTree = renderMembers()
  checkMemberIds()
  find(memberTree, 'DropdownMenuItem')
    .find((item) => find(item, 'span').some(({ props }) => props.children[0] === 'REJECT'))
    .props.onClick()
  memberTree = renderMembers()
  const addedTag = find(memberTree, 'MemberTag').at(-1)
  assert.equal(addedTag.props.member.value, 'REJECT')
  assert.ok(!new Set(ids.values()).has(addedTag.props.id), '新添加成员获得独立标识')
  ids.set(addedTag.props.member, addedTag.props.id)
  checkMemberIds()
  assert.equal(JSON.stringify(duplicateDraft.groups[0].members), originalMembers, '身份标识和排序不污染原始成员数据')
  const savedMembers = parse(adapter.applyVisualTemplate(templateYaml, { ...duplicateDraft, groups: [memberForm] }))[
    'proxy-groups'
  ][0]
  assert.deepEqual(
    savedMembers.proxies,
    Array.from(memberForm.members)
      .filter((m) => m.kind !== 'source-slot' || m.slotKey === previewSlots[0].key)
      .map((m) => m.value || m.slotKey),
  )
  assert.deepEqual(savedMembers.use, ['external', previewSlots[1].key], '订阅引用保持原样')
  memberEditor.unmount()

  for (const [group, expectedWarning] of warningCases) {
    const card = harness('features/templates/visual/groups/group-card.tsx', 'GroupCard', {
      useSortable: () => ({}),
      memberLabel: () => '引用',
      cn,
    })
    const props = {
      group,
      groups: [group],
      sourceSlots: [...slotFixtures, subscriptionFixture],
      index: 0,
      onSave() {},
      onDelete() {},
    }
    const collapsed = card.render(props)
    assert.equal(find(collapsed, 'Alert').length, 0, '代理组折叠时不显示告警')
    find(collapsed, 'div')
      .find(({ props }) => props.className === 'template-group-header-info')
      .props.onKeyDown({ key: 'Enter', preventDefault() {} })
    const expanded = card.render(props)
    assert.equal(find(expanded, 'Alert').length, 0, '代理组展开面板不再显示覆盖 use 告警')
    if (group.kind === 'raw') continue
    if (group.includeAllProxies)
      assert.ok(
        find(expanded, 'Network')[0].props.className.includes('text-amber-500'),
        '全部节点与 proxies 槽位颜色一致',
      )
    if (group.includeAllProviders)
      assert.ok(find(expanded, 'Boxes')[0].props.className.includes('text-indigo-500'), '全部订阅源与 use 槽位颜色一致')
    for (const [index, member] of group.members.filter((member) => member.kind === 'source-slot').entries()) {
      const expectedColor = member.slotKey === subscriptionFixture.key ? 'text-indigo-500' : 'text-amber-500'
      const sharedTag = find(expanded, 'SourceSlotTag')[index]
      assert.equal(sharedTag.props.slot.key, member.slotKey, '代理组复用共享槽位标签')
      const slotTag = harness('components/source-slot-tag.tsx', 'SourceSlotTag', { cn })
      assert.ok(
        find(slotTag.render(sharedTag.props), 'Plug')[0].props.className.includes(expectedColor),
        '代理组引用沿用槽位类型颜色',
      )
      const tag = harness('features/templates/visual/groups/member-editor.tsx', 'MemberTag', {
        useSortable: () => ({}),
        memberLabel: () => '引用',
        cn,
      })
      const tagTree = tag.render({
        member,
        id: `fixture-${index}`,
        index,
        groups: props.groups,
        sourceSlots: props.sourceSlots,
        onDelete() {},
      })
      assert.ok(find(tagTree, 'Plug')[0].props.className.includes(expectedColor), '弹窗已选成员沿用槽位类型颜色')
    }
    let savedGroup
    const dialog = harness('features/templates/visual/groups/group-dialog.tsx', 'GroupDialog', {
      memberLabel: () => '引用',
      cn,
      FieldHelp: 'FieldHelp',
      ProxyGroupIconPicker: 'ProxyGroupIconPicker',
    })
    const dialogProps = {
      value: group,
      groups: [group],
      sourceSlots: props.sourceSlots,
      children: '编辑',
      onSave(next) {
        savedGroup = next
      },
    }
    const closedDialog = dialog.render(dialogProps)
    assert.equal(find(closedDialog, 'Alert').length, 0)
    find(closedDialog, 'span')[0].props.onClick({ stopPropagation() {} })
    let opened = dialog.render(dialogProps)
    const memberProps = find(opened, 'MemberEditor')[0].props
    assert.deepEqual(memberProps.form.members, group.members, '编辑已有代理组保留成员')
    const memberPanel = harness('features/templates/visual/groups/member-editor.tsx', 'MemberEditor', {
      nanoid,
      cn,
      MemberTag: 'MemberTag',
    }).render(memberProps)
    assert.equal(memberPanel.props.children.at(-1), memberProps.children, '提示位于成员表单项内部的底部')
    assert.ok(
      find(memberPanel, 'span').some(({ props }) => props.children[0] === '代理组节点'),
      '成员模块标题使用新名称',
    )
    const availableSlotIcons = find(memberPanel, 'Plug')
    const unselectedSlots = props.sourceSlots.filter(
      (slot) => !group.members.some((member) => member.kind === 'source-slot' && member.slotKey === slot.key),
    )
    assert.equal(availableSlotIcons.length, unselectedSlots.length)
    unselectedSlots.forEach((slot, index) =>
      assert.ok(
        availableSlotIcons[index].props.className.includes(
          slot.type === 'subscription' ? 'text-indigo-500' : 'text-amber-500',
        ),
        '成员选择菜单沿用槽位类型颜色',
      ),
    )
    assert.equal(find(opened, 'Alert').length, Number(expectedWarning), '覆盖 use 仅在编辑代理组弹窗中提示')
    if (expectedWarning) {
      assert.notEqual(find(opened, 'Alert')[0].props.variant, 'destructive', '提示不是阻断性错误')
      assert.equal(find(opened, 'AlertDescription')[0].props.children[0], '「包含全部订阅源」开启后将会覆盖use选择')
    }
    const providerSelect = (tree) =>
      find(tree, 'Select').filter(({ props }) => props.items.length === 2 && props.items[0].value === 'false')[1]
    providerSelect(opened).props.onValueChange('false')
    opened = dialog.render(dialogProps)
    assert.equal(find(opened, 'Alert').length, 0, '关闭自动包含后告警实时消失')
    providerSelect(opened).props.onValueChange('true')
    opened = dialog.render(dialogProps)
    const members = find(opened, 'MemberEditor')[0].props
    members.onChange({ ...members.form, members: [], extras: {} })
    opened = dialog.render(dialogProps)
    assert.equal(find(opened, 'Alert').length, 0, '无显式 use 时不提示')
    const cleared = find(opened, 'MemberEditor')[0].props
    cleared.onChange({ ...cleared.form, members: structuredGroup.members })
    opened = dialog.render(dialogProps)
    assert.equal(find(opened, 'Alert').length, 1, '加入订阅槽位后告警实时出现')
    find(opened, 'Button')
      .find(({ props }) => props.children[0] === '保存')
      .props.onClick()
    assert.equal(savedGroup.includeAllProviders, true, '告警不阻止保存或修改自动包含开关')
  }

  const failed = harness(editorPath, 'TemplateEditor', { ...adapter, ...validation, blankSourceSlots: [] })
  failed.render({ id: 'B' })
  failed.flush()
  failed.requests[0].reject(new Error('load failed'))
  await tick()
  tree = failed.render({ id: 'B' })
  assert.equal(find(tree, 'PageState')[0].props.error, 'load failed')
  assert.equal(find(tree, 'form').length, 0, 'failed template loads cannot submit an old form')
  const editors = nodes(
    editorPath,
    (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'TemplateEditor',
  )
  assert.equal(editors.length, 2)
  assert.ok(editors.every((node) => node.attributes.properties.some((prop) => prop.name?.getText() === 'key')))
} finally {
  await server.close()
}

const subscriptionEditor = harness(
  'features/profiles/subscription-slot-binding-editor.tsx',
  'SubscriptionSlotBindingEditor',
)
const subscriptionSourcePicker = harness(
  'features/profiles/subscription-sources-editor.tsx',
  'SubscriptionSourcesEditor',
  {
    cn: (...names) => names.filter(Boolean).join(' '),
  },
)
const subscriptionChoices = (tree) => subscriptionSourcePicker.render(find(tree, 'SubscriptionSourcesEditor')[0].props)
let subscriptionValue = { mode: 'source', sourceIds: [], includeRegex: null, excludeRegex: null }
const subscriptionProps = () => ({
  slot: { key: 'subscription', name: '机场', type: 'subscription' },
  value: subscriptionValue,
  sources: [
    { id: 'airport', name: '机场', kind: 'url', enabled: true, url: 'https://example.com/sub' },
    { id: 'airport2', name: '机场二', kind: 'url', enabled: true, url: 'https://example.com/sub2' },
  ],
  onChange(next) {
    subscriptionValue = next
  },
})
let subscriptionTree = subscriptionEditor.render(subscriptionProps())
assert.equal(find(subscriptionTree, 'FieldError').length, 0, '空订阅槽位初始不报错')
assert.equal(find(subscriptionChoices(subscriptionTree), 'SelectionActionButton').length, 0, '单选槽位不显示全选')
find(subscriptionChoices(subscriptionTree), 'Checkbox')[0].props.onCheckedChange(true)
subscriptionTree = subscriptionEditor.render(subscriptionProps())
assert.equal(find(subscriptionTree, 'FieldError').length, 0, '选择有效订阅后消除错误')
assert.equal(subscriptionValue.sourceIds[0], 'airport')
find(subscriptionChoices(subscriptionTree), 'Checkbox')[1].props.onCheckedChange(true)
subscriptionTree = subscriptionEditor.render(subscriptionProps())
assert.deepEqual(Array.from(subscriptionValue.sourceIds), ['airport2'], '选择另一个订阅源替换旧选择，始终只选一个')
find(subscriptionChoices(subscriptionTree), 'SelectionActionButton')[0].props.onClear()
assert.equal(find(subscriptionEditor.render(subscriptionProps()), 'FieldError').length, 1, '清空已操作槽位后报错')
assert.equal(subscriptionValue.sourceIds.length, 0)

const profilePath = 'features/profiles/profile-editor.tsx'
const profileHelper = (name) =>
  evaluate(
    nodes(profilePath, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name)[0].getText(
      source(profilePath),
    ),
    {},
  )
const subscriptionSlot = { key: 'subscription', name: '机场', type: 'subscription' }
const profileTemplates = [{ id: 'customtpl001', name: '模板副本', kind: 'custom', sourceSlots: [subscriptionSlot] }]
let profileFormOptions
let profileValues
const profileForm = { Field: 'Field', Subscribe: 'Subscribe', store: {}, state: {} }
const profileEditor = harness(profilePath, 'ProfileEditor', {
  z,
  revalidateLogic,
  NODE_BINDING_EDITOR_SCOPE: { key: 'profile-node-binding', name: '全部节点', type: 'nodes' },
  emptyNodeBinding: profileHelper('emptyNodeBinding'),
  validRegex: profileHelper('validRegex'),
  hasConfiguration: profileHelper('hasConfiguration'),
  cn: (...names) => names.filter(Boolean).join(' '),
  useApi: (path) => ({ data: path === '/templates' ? profileTemplates : subscriptionProps().sources, loading: false }),
  useStore: () => 'customtpl001',
  useForm(options) {
    profileFormOptions = options
    profileValues ||= {
      ...options.defaultValues,
      name: '配置',
      templateId: profileTemplates[0].id,
      slotBindings: [{ ...subscriptionValue, slotKey: subscriptionSlot.key }],
    }
    profileForm.state.values = profileValues
    return profileForm
  },
})
const profileTree = profileEditor.render({})
const profileSubscriptions = find(profileTree, 'Subscribe')
const profileState = { values: profileValues, isSubmitting: false, canSubmit: true, submissionAttempts: 0 }
const footer = profileSubscriptions.find(({ props }) => props.selector(profileState)[0] === profileValues)
const submitButton = () =>
  find(footer.props.children[0](footer.props.selector(profileState)), 'Button').find(
    ({ props }) => props.type === 'submit',
  )
assert.equal(submitButton().props.disabled, false, '空订阅槽位允许点击创建以触发校验')
assert.equal(
  profileFormOptions.validators.onDynamic.safeParse(profileValues).success,
  false,
  '空槽位仍无法通过保存校验',
)
profileValues.slotBindings[0].sourceIds = ['missing']
assert.equal(submitButton().props.disabled, true, '已失效的绑定仍禁止保存')
profileValues.slotBindings[0].sourceIds = ['airport']
assert.equal(submitButton().props.disabled, false)
assert.equal(
  profileFormOptions.validators.onDynamic.safeParse(profileValues).success,
  true,
  '有效订阅允许仅 provider 配置',
)
const slotsSubscriber = profileSubscriptions.find(({ props }) => {
  const selected = props.selector(profileState)
  return selected.length === 3 && selected[0] === profileValues.templateId && selected[2] === 0
})
for (const submissionAttempts of [0, 1]) {
  const slotsField = slotsSubscriber.props.children[0](
    slotsSubscriber.props.selector({ ...profileState, submissionAttempts }),
  )
  const slotTree = slotsField.props.children[0]({
    state: { value: profileValues.slotBindings, meta: { isValid: true } },
    handleChange() {},
  })
  assert.equal(
    find(slotTree, 'SubscriptionSlotBindingEditor')[0].props.showValidation,
    submissionAttempts > 0,
    '提交状态传递到每个订阅槽位',
  )
}

let data = { items: [{ id: 'A', name: 'Alpha' }] }
let selected = []
const picker = harness('features/nodes/node-dialogs.tsx', 'PreferredNodeSelect', {
  useApi: () => ({ data, loading: false }),
  useComboboxAnchor: () => ({}),
})
const pickerProps = () => ({
  value: selected,
  invalid: false,
  onBlur() {},
  onChange(next) {
    selected = next
  },
})
let pickerTree = picker.render(pickerProps())
pickerTree.props.onValueChange(['A'])
data = { items: [{ id: 'B', name: 'Beta' }] }
pickerTree = picker.render(pickerProps())
const valueRenderer = find(pickerTree, 'ComboboxValue')[0].props.children[0]
assert.equal(find(valueRenderer(selected), 'span')[0].props.children[0], 'Alpha', 'selected labels survive searches')
pickerTree.props.onValueChange(['A', 'B'])
pickerTree = picker.render(pickerProps())
assert.equal(
  find(find(pickerTree, 'ComboboxValue')[0].props.children[0](selected), 'span')[1].props.children[0],
  'Beta',
)

const inline = harness('features/templates/visual/rules/rule-card.tsx', 'InlineValueEdit')
let inlineTree = inline.render({ value: 'old', onSave() {} })
find(inlineTree, 'button')[0].props.onClick()
inlineTree = inline.render({ value: 'old', onSave() {} })
inline.flush()
find(inlineTree, 'Input')[0].props.onChange({ target: { value: 'typing' } })
inlineTree = inline.render({ value: 'updated externally', onSave() {} })
inline.flush()
assert.equal(find(inlineTree, 'Input')[0].props.value, 'typing', 'prop updates do not erase active input')

let retried = false
const wrapper = harness('features/profiles/profile-editor.tsx', 'LivePreviewWrapper', {
  useProfilePreview: () => ({ groups: [], totalUniqueNodes: 0 }),
})
const wrapperProps = {
  templateId: 'B',
  templateDetailLoading: false,
  templateDetailError: { id: 'B', message: 'offline' },
  onRetryTemplateDetail() {
    retried = true
  },
}
const errorTree = wrapper.render(wrapperProps)
assert.equal(find(errorTree, 'ProfilePreviewPanel')[0].props.loading, false)
find(errorTree, 'Button')[0].props.onClick()
assert.equal(retried, true)
assert.equal(
  find(wrapper.render({ ...wrapperProps, templateId: 'C' }), 'Alert').length,
  0,
  'old template errors are hidden',
)
console.log(
  'React 数据流回归通过：请求取消/乱序/资源身份、GEO 切换、YAML 模式/排序、节点标签快照、编辑输入与预览错误重试。',
)
