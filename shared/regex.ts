import { RE2JS } from 're2js'

export const REGEX_ERROR = '正则表达式无效或不受支持：请使用 RE2 语法，不支持前后断言和反向引用'

export function compileRegex(pattern: string) {
  try {
    return RE2JS.compile(pattern)
  } catch {
    throw new Error(REGEX_ERROR)
  }
}

export function validRegex(pattern: string | null) {
  try {
    if (pattern) compileRegex(pattern)
    return true
  } catch {
    return false
  }
}

export function compileRegexFilters(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return []
  return value
    .split('`')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map(compileRegex)
}
