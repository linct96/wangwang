import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Copy, FileCode2, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type { Profile, Source, TemplateSummary } from '@/api/types'
import { AppConfirmDialog, IconButton, PageState } from '@/components/app-primitives'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import '@/styles/profiles.css'

function ProfileCardSkeleton() {
  return (
    <article className="profile-card" aria-hidden="true">
      <div className="profile-card-header">
        <div className="profile-card-title-wrap">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-5 w-32" />
        </div>
      </div>
      <div className="profile-card-body">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="profile-card-footer">
        <Skeleton className="h-4 w-20" />
        <div className="profile-action-buttons">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>
    </article>
  )
}

export function ProfilesPage() {
  const { data: profiles, error, loading, reload } = useApi<Profile[]>('/profiles')
  const { data: sources = [] } = useApi<Source[]>('/sources?includeSystem=1')
  const { data: templates = [] } = useApi<TemplateSummary[]>('/templates')
  const [deleting, setDeleting] = useState<Profile>()
  const [compileStatus, setCompileStatus] = useState<Record<string, 'loading' | 'success' | 'error'>>({})
  const [busyId, setBusyId] = useState('')
  const initialLoading = loading && !profiles

  const items = profiles || []
  const enabledCount = items.filter((p) => p.enabled).length
  const templateMap = new Map(templates.map((t) => [t.id, t.name]))
  const sourceMap = new Map(sources.map((s) => [s.id, s.name]))

  async function triggerCompile(id: string) {
    setCompileStatus((prev) => ({ ...prev, [id]: 'loading' }))
    try {
      const result = await api<{ jobId: string }>(`/profiles/${id}/compile`, { method: 'POST' })
      await waitForJob(result.jobId)
      setCompileStatus((prev) => ({ ...prev, [id]: 'success' }))
      toast.success('配置生成成功')
    } catch (reason) {
      setCompileStatus((prev) => ({ ...prev, [id]: 'error' }))
      toast.error(reason instanceof Error ? reason.message : '重新生成失败')
    } finally {
      setTimeout(() => {
        setCompileStatus((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }, 1500)
      await reload()
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    setBusyId(id)
    try {
      await api(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
      await reload()
      toast.success(enabled ? '配置已启用' : '配置已停用')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setBusyId('')
    }
  }

  async function remove(profile: Profile) {
    setBusyId(profile.id)
    try {
      await api(`/profiles/${profile.id}`, { method: 'DELETE' })
      setDeleting(undefined)
      await reload()
      toast.success('配置已删除')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '删除失败')
    } finally {
      setBusyId('')
    }
  }

  function copySubscription(url: string) {
    void navigator.clipboard.writeText(url).then(() => toast.success('订阅链接已复制'))
  }

  return (
    <div className="profiles-page">
      <div className="page-heading">
        <div>
          <h1>配置</h1>
          <p>
            {items.length}/20 个订阅配置 · {enabledCount} 个启用中
          </p>
        </div>
        <Button disabled={!sources.length} asChild>
          <Link to="/profiles/new">
            <Plus data-icon="inline-start" />
            新建配置
          </Link>
        </Button>
      </div>

      {error && !initialLoading && <PageState loading={false} error={error} />}

      {initialLoading ? (
        <section className="profile-grid">
          {Array.from({ length: 3 }, (_, index) => (
            <ProfileCardSkeleton key={index} />
          ))}
        </section>
      ) : (
        profiles && (
          <>
            {items.length > 0 ? (
              <section className="profile-grid">
                {items.map((profile) => {
                  const status = compileStatus[profile.id]
                  const isCompiling = status === 'loading'
                  const templateName = templateMap.get(profile.templateId) || profile.templateId

                  return (
                    <article className="profile-card" key={profile.id}>
                      <div className="profile-card-header">
                        <div className="profile-card-title-wrap">
                          <div className="profile-card-icon">
                            <FileCode2 className="size-4.5" />
                          </div>
                          <h3 className="profile-name" title={profile.name}>
                            {profile.name}
                          </h3>
                        </div>
                        <div className="profile-header-actions">
                          <Switch
                            checked={profile.enabled}
                            disabled={busyId === profile.id}
                            onCheckedChange={(checked) => void toggleEnabled(profile.id, checked)}
                            aria-label={profile.enabled ? '停用配置' : '启用配置'}
                          />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton label="更多操作">
                                <MoreHorizontal className="size-4" />
                              </IconButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem disabled={isCompiling} onClick={() => void triggerCompile(profile.id)}>
                                <RefreshCw className={cn('size-4 mr-2', isCompiling && 'spin')} />
                                {isCompiling ? '正在生成...' : '重新生成'}
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link to="/profiles/$id/edit" params={{ id: profile.id }}>
                                  <Pencil className="size-4 mr-2" /> 编辑设置
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleting(profile)}
                              >
                                <Trash2 className="size-4 mr-2" /> 删除配置
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      <div className="profile-card-body">
                        <div className="profile-info-item">
                          <span className="profile-info-label">规则模板</span>
                          <span className="profile-template-badge" title={templateName}>
                            <Zap className="size-3 text-amber-500" />
                            {templateName}
                          </span>
                        </div>

                        <div className="profile-info-item">
                          <span className="profile-info-label">节点来源</span>
                          <div className="profile-tags-wrap">
                            {(profile.nodeBinding.mode === 'source' ? profile.nodeBinding.sourceIds : []).map(
                              (sourceId) => (
                                <span key={sourceId} className="profile-pill">
                                  {sourceMap.get(sourceId) || '未知源'}
                                </span>
                              ),
                            )}
                            {profile.nodeBinding.mode === 'tag' &&
                              profile.nodeBinding.tags.map((tag) => (
                                <span key={tag} className="profile-pill">
                                  标签：{tag}
                                </span>
                              ))}
                            {profile.nodeBinding.mode === 'node' && (
                              <span className="profile-pill">指定 {profile.nodeBinding.nodeIds.length} 个节点</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="profile-card-footer">
                        <div className="profile-time-info">
                          <span>
                            {isCompiling
                              ? '配置生成中...'
                              : profile.compiledAt
                                ? formatRelativeTime(profile.compiledAt)
                                : '尚未生成'}
                          </span>
                        </div>
                        <div className="profile-action-buttons">
                          <Button variant="outline" size="sm" onClick={() => copySubscription(profile.subscriptionUrl)}>
                            <Copy className="size-3.5" />
                            复制链接
                          </Button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </section>
            ) : (
              <div className="empty-block">
                <FileCode2 className="size-10 text-muted-foreground" />
                <strong>暂无订阅配置</strong>
                <p className="text-xs text-muted-foreground">创建配置将多个节点源聚合为统一的 Clash / Mihomo 订阅</p>
              </div>
            )}
          </>
        )
      )}

      {deleting && (
        <AppConfirmDialog
          title="删除配置"
          description={`确定删除“${deleting.name}”？此操作无法撤销。`}
          confirmLabel="删除"
          busy={busyId === deleting.id}
          onClose={() => setDeleting(undefined)}
          onConfirm={() => void remove(deleting)}
        />
      )}
    </div>
  )
}
