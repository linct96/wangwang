export type SubscriptionFormat = 'yaml' | 'uri' | 'base64'
export function detectFormat(text: string): SubscriptionFormat {
  const value = text.trim()
  if (/^(?:proxies\s*:|-)\s*/m.test(value)) return 'yaml'
  if (value.includes('://')) return 'uri'
  return 'base64'
}
