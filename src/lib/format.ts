const pad = (value: number) => String(value).padStart(2, '0')

export function formatDate(value: string | number | null) {
  if (value == null) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatRelativeTime(value: string | number | null) {
  if (value == null) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 0) return '即将'
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}小时前`
  return `${Math.floor(seconds / 86_400)}天前`
}

export function formatBytes(value: number | null) {
  if (value == null) return '未提供'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = -1
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`
}
