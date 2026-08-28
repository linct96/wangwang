import dayjs from 'dayjs'

export function formatDate(value: string | number | null) {
  return value == null ? '-' : dayjs(value).format('YYYY/M/D HH:mm')
}

export function formatRelativeTime(value: string | number | null) {
  if (value == null) return '-'
  const date = dayjs(value)
  if (!date.isValid()) return '-'
  const seconds = dayjs().diff(date, 'second')
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
