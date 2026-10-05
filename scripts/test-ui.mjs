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
  console.log('UI 迁移回归通过：单一 Base UI、调用 API、显式表单提交、首屏选项标签、半选、进度语义与分段选择。')
} finally {
  await server.close()
}
