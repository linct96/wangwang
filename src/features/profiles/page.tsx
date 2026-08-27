import { useState } from 'react'
import { FileCode2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type { Profile, Source } from '@/api/types'
import { IconButton, PageState, Status } from '@/components/app-primitives'
import { Button } from '@/components/ui/button'
import { Link } from '@tanstack/react-router'
import { formatDate } from '@/lib/format'
import { ProfileDialog } from './profile-dialog'

export function ProfilesPage() {
  const { data: profiles = [], error, loading, reload } = useApi<Profile[]>('/profiles')
  const { data: sources = [] } = useApi<Source[]>('/sources?includeSystem=1')
  const [adding, setAdding] = useState(false)
  async function remove(id: string) {
    if (!window.confirm('确定删除这个配置？')) return
    try {
      await api(`/profiles/${id}`, { method: 'DELETE' })
      await reload()
      toast.success('配置已删除')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '删除失败')
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>配置</h1>
          <p>{profiles.length}/20 个订阅配置</p>
        </div>
        <Button disabled={!sources.length} onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          新建
        </Button>
      </div>
      <PageState loading={loading} error={error} />
      <section className="profile-list">
        {profiles.length ? (
          profiles.map((profile) => (
            <article className="profile-row" key={profile.id}>
              <div className="profile-icon">
                <FileCode2 />
              </div>
              <div>
                <Link to="/profiles/$id" params={{ id: profile.id }}>
                  {profile.name}
                </Link>
                <p>
                  {profile.sourceIds.length} 个来源 · revision {profile.revision}
                </p>
              </div>
              <Status value={profile.error ? 'error' : profile.compiledAt ? 'ready' : 'idle'} />
              <time>{formatDate(profile.compiledAt)}</time>
              <IconButton label="删除" onClick={() => void remove(profile.id)}>
                <Trash2 />
              </IconButton>
            </article>
          ))
        ) : (
          <div className="empty-block">
            <FileCode2 />
            <strong>暂无配置</strong>
          </div>
        )}
      </section>
      {adding && (
        <ProfileDialog
          sources={sources}
          onClose={() => setAdding(false)}
          onSaved={async (jobId) => {
            setAdding(false)
            try {
              await waitForJob(jobId)
              toast.success('配置生成成功')
            } catch (reason) {
              toast.error(reason instanceof Error ? reason.message : '生成失败')
            }
            await reload()
          }}
        />
      )}
    </>
  )
}
