import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
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
