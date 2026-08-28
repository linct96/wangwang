import { yaml } from '@codemirror/lang-yaml'
import { linter, lintGutter } from '@codemirror/lint'
import { parseDocument } from 'yaml'

export const yamlEditorExtensions = [
  yaml(),
  linter((view) =>
    parseDocument(view.state.doc.toString()).errors.map((error) => ({
      from: error.pos[0],
      to: error.pos[1],
      severity: 'error',
      message: error.message,
    })),
  ),
  lintGutter(),
]

export function formatYaml(value: string) {
  const document = parseDocument(value)
  return document.errors.length ? null : document.toString({ lineWidth: 0 })
}
