import { useEffect, useRef, useState } from 'react'
import { api } from './client'
import type { Job } from './types'

export function useApi<T>(path: string) {
  const [state, setState] = useState<{ path: string; data?: T; error: string; loading: boolean }>({
    path,
    error: '',
    loading: true,
  })
  const request = useRef<{ path: string; load: () => Promise<void> } | null>(null)

  useEffect(() => {
    let controller: AbortController | undefined
    async function load() {
      controller?.abort()
      const next = new AbortController()
      controller = next
      setState((current) => ({
        path,
        data: current.path === path ? current.data : undefined,
        error: '',
        loading: true,
      }))
      try {
        const data = await api<T>(path, { signal: next.signal })
        if (!next.signal.aborted) setState({ path, data, error: '', loading: false })
      } catch (reason) {
        if (!next.signal.aborted) {
          setState((current) => ({
            ...current,
            error: reason instanceof Error ? reason.message : '请求失败',
            loading: false,
          }))
        }
      }
    }
    request.current = { path, load }
    void load()
    return () => {
      controller?.abort()
      request.current = null
    }
  }, [path])

  function reload() {
    const active = request.current
    return active?.path === path ? active.load() : Promise.resolve()
  }
  const current = state.path === path ? state : { data: undefined, error: '', loading: true }
  return { data: current.data, error: current.error, loading: current.loading, reload }
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
