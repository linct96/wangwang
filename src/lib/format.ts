import dayjs from 'dayjs'

export function formatDate(value: string | number | null) {
  return value == null ? '-' : dayjs(value).format('YYYY/M/D HH:mm')
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
