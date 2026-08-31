import { parseDocument } from 'yaml'

export function formatYaml(value: string) {
  const document = parseDocument(value)
  return document.errors.length ? null : document.toString({ lineWidth: 0 })
}
