import { useCallback, useEffect, useState } from 'react'
import { api } from './client'
import type { Job } from './types'

export function useApi<T>(path: string) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!signal) setLoading(true)
      try {
        const response = await api<T>(path, { signal })
        if (!signal?.aborted) {
          setData(response)
          setError('')
        }
      } catch (reason) {
        if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '请求失败')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [path],
  )
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])
  return { data, error, loading, reload: () => load() }
}

export async function waitForJob(jobId: string) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const job = await api<Job>(`/jobs/${jobId}`)
    if (job.status === 'succeeded') return
    if (job.status === 'failed') throw new Error(job.error || '任务失败')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('任务等待超时')
}
