import { localApi } from '@/local-mock/api'

async function httpApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (response.status === 401 && path !== '/auth/login') {
    window.location.href = '/admin/login'
    throw new Error('请先登录')
  }
  const payload = (await response.json()) as { data?: T; error?: { message: string } }
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || '请求失败')
  return payload.data
}

const useLocalData = import.meta.env.VITE_DATA_SOURCE
  ? import.meta.env.VITE_DATA_SOURCE === 'local'
  : import.meta.env.DEV

export const api = useLocalData ? localApi : httpApi
