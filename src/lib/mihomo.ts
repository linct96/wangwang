/**
 * 解析单个 include-all 子开关（proxies 或 providers）的最终状态。
 *
 * 规则遵循 Mihomo 实际解析规范：
 * - `include-all: true` 是总开关，强制两子开关最终都为 `true`。
 * - `include-all: false` 不覆盖具体子开关。
 * - 两个子开关彼此独立。
 * - 当均未配置时返回 `undefined`，以便适配器（adapter）在未配置字段时保留 undefined，避免序列化出无意义的 false。
 */
export function resolveIncludeAllFlag(includeAll: unknown, specific: unknown): boolean | undefined {
  if (includeAll === true) return true
  if (typeof specific === 'boolean') return specific
  return undefined
}

export type ProxyGroupIncludeAllFlags = {
  includeAllProxies: boolean
  includeAllProviders: boolean
}

/**
 * 从原始策略组对象或配置中提取最终生效的布尔开关（常用于预览或运行时解析）。
 * 最终语义等价于：
 * effectiveIncludeAllProxies = include-all === true || include-all-proxies === true
 * effectiveIncludeAllProviders = include-all === true || include-all-providers === true
 */
export function resolveProxyGroupIncludeAll(group: unknown): ProxyGroupIncludeAllFlags {
  if (!group || typeof group !== 'object') {
    return { includeAllProxies: false, includeAllProviders: false }
  }
  const rec = group as Record<string, unknown>
  return {
    includeAllProxies: resolveIncludeAllFlag(rec['include-all'], rec['include-all-proxies']) ?? false,
    includeAllProviders: resolveIncludeAllFlag(rec['include-all'], rec['include-all-providers']) ?? false,
  }
}
