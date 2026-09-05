import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  Check,
  Clipboard,
  Download,
  FileCode2,
  RefreshCw,
  RotateCcwKey,
  Settings2,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type { Profile, Source, TemplateSummary } from '@/api/types'
import { AppConfirmDialog, IconButton, PageState } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/format'
import '@/styles/profiles.css'

export function ProfileDetailPage() {
  const { id } = useParams({ from: '/app/profiles/$id' })
  const navigate = useNavigate()
  const { data: profile, error, loading, reload } = useApi<Profile>(`/profiles/${id}`)
  const { data: sources = [] } = useApi<Source[]>('/sources?includeSystem=1')
  const { data: templates = [] } = useApi<TemplateSummary[]>('/templates')

  const [rotatingToken, setRotatingToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [compileStatus, setCompileStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const templateMap = new Map(templates.map((template) => [template.id, template]))
  const currentTemplate = profile ? templateMap.get(profile.templateId) : undefined
  const sourceMap = new Map(sources.map((s) => [s.id, s.name]))

  async function runCompile() {
    setCompileStatus('loading')
    try {
      const result = await api<{ jobId: string }>(`/profiles/${id}/compile`, { method: 'POST' })
      await waitForJob(result.jobId)
      setCompileStatus('success')
      toast.success('配置生成成功')
    } catch (reason) {
      setCompileStatus('error')
      toast.error(reason instanceof Error ? reason.message : '重新生成失败')
    } finally {
      setTimeout(() => setCompileStatus('idle'), 1500)
      await reload()
    }
  }

  async function runRotateToken() {
    setBusy(true)
    try {
      await api(`/profiles/${id}/rotate-token`, { method: 'POST' })
      setRotatingToken(false)
      toast.success('订阅令牌已轮换')
      await reload()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(() => toast.success(`${label}已复制`))
  }

  function downloadYaml() {
    if (!profile?.compiledYaml) return
    const blob = new Blob([profile.compiledYaml], { type: 'text/yaml;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${profile.name || 'config'}.yaml`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('配置文件已下载')
  }

  const yamlLines = profile?.compiledYaml ? profile.compiledYaml.split('\n').length : 0
  const yamlSizeKb = profile?.compiledYaml ? (new Blob([profile.compiledYaml]).size / 1024).toFixed(1) : 0

  return (
    <div className="profile-detail-page">
      <div className="page-heading">
        <div className="title-with-back">
          <IconButton label="返回配置列表" onClick={() => navigate({ to: '/profiles' })}>
            <ArrowLeft />
          </IconButton>
          <div>
            <div className="flex items-center gap-2.5">
              <h1>{profile?.name || '配置详情'}</h1>
            </div>
            <p>最后生成于 {formatDate(profile?.compiledAt || null)}</p>
          </div>
        </div>

        <div className="heading-actions">
          <Button variant="outline" disabled={compileStatus === 'loading' || busy} onClick={() => void runCompile()}>
            {compileStatus === 'loading' ? (
              <RefreshCw data-icon="inline-start" className="spin" />
            ) : compileStatus === 'success' ? (
              <Check data-icon="inline-start" className="text-emerald-500" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {compileStatus === 'loading' ? '正在生成' : '重新生成'}
          </Button>
          <Button onClick={() => void navigate({ to: '/profiles/$id/edit', params: { id } })}>
            <Settings2 data-icon="inline-start" />
            编辑配置
          </Button>
        </div>
      </div>

      <PageState loading={loading} error={error} />

      {profile && (
        <div className="profile-detail-grid">
          {/* 左侧：分发与属性看板 */}
          <div className="profile-detail-sidebar">
            {/* 订阅中心 */}
            <div className="section profile-hub-card">
              <div className="section-title flex items-center justify-between">
                <h2>订阅分发中心</h2>
                <span className="text-xs text-muted-foreground font-mono">Clash / Mihomo</span>
              </div>
              <div className="profile-hub-content">
                <div className="copy-field">
                  <Input readOnly value={profile.subscriptionUrl} className="font-mono text-xs" />
                  <Button type="button" variant="outline" onClick={() => copyText(profile.subscriptionUrl, '订阅地址')}>
                    <Clipboard className="size-3.5 mr-1" />
                    复制
                  </Button>
                </div>

                <div className="client-import-group">
                  <span className="client-import-label">一键导入客户端</span>
                  <div className="client-import-grid">
                    <a
                      href={`clash://install-config?url=${encodeURIComponent(profile.subscriptionUrl)}&name=${encodeURIComponent(profile.name)}`}
                      className="client-btn"
                    >
                      <Sparkles className="size-3.5" />
                      Clash / Verge
                    </a>
                    <a
                      href={`surge:///install-config?url=${encodeURIComponent(profile.subscriptionUrl)}&name=${encodeURIComponent(profile.name)}`}
                      className="client-btn"
                    >
                      Surge
                    </a>
                    <a
                      href={`shadowrocket://add/sub://${btoa(profile.subscriptionUrl)}?title=${encodeURIComponent(profile.name)}`}
                      className="client-btn"
                    >
                      Shadowrocket
                    </a>
                  </div>
                </div>

                {profile.error && (
                  <Alert variant="destructive">
                    <ShieldAlert className="size-4" />
                    <AlertDescription>{profile.error}</AlertDescription>
                  </Alert>
                )}

                <div className="hub-footer">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    disabled={busy}
                    onClick={() => setRotatingToken(true)}
                  >
                    <RotateCcwKey className="size-3.5 mr-1.5" />
                    轮换订阅令牌
                  </Button>
                </div>
              </div>
            </div>

            {/* 规则与过滤元数据 */}
            <div className="section profile-meta-card">
              <div className="section-title">
                <h2>配置结构</h2>
              </div>
              <div className="profile-meta-content">
                <div className="meta-row">
                  <span className="meta-label">关联模板</span>
                  <span className="meta-value font-semibold flex items-center gap-1.5">
                    <Zap className="size-3.5 text-amber-500" />
                    {templateMap.get(profile.templateId)?.name || profile.templateId}
                  </span>
                </div>

                <div className="meta-row">
                  <span className="meta-label">全部节点</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {profile.nodeBinding.mode === 'source' ? (
                      profile.nodeBinding.sourceIds.map((sourceId) => (
                        <span key={sourceId} className="profile-pill">
                          {sourceMap.get(sourceId) || sourceId}
                        </span>
                      ))
                    ) : profile.nodeBinding.mode === 'tag' ? (
                      profile.nodeBinding.tags.map((tag) => (
                        <span key={tag} className="profile-pill">
                          标签：{tag}
                        </span>
                      ))
                    ) : (
                      <span className="profile-pill">
                        指定 {profile.nodeBinding.nodeIds.length} 个节点
                        {profile.nodeBinding.missingNodeIds.length
                          ? ` · ${profile.nodeBinding.missingNodeIds.length} 个失效`
                          : ''}
                      </span>
                    )}
                  </div>
                </div>

                {Boolean(
                  (currentTemplate ? currentTemplate.sourceSlots.length > 0 : true) && profile.slotBindings.length > 0,
                ) && (
                  <div className="meta-row">
                    <span className="meta-label">动态节点槽</span>
                    <div className="flex flex-col gap-2">
                      {profile.slotBindings.map((binding) => (
                        <div key={binding.slotKey} className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            {currentTemplate?.sourceSlots.find(({ key }) => key === binding.slotKey)?.name ||
                              binding.slotKey}
                          </span>
                          {binding.mode === 'source' ? (
                            binding.sourceIds.map((sourceId) => (
                              <span key={sourceId} className="profile-pill">
                                {sourceMap.get(sourceId) || sourceId}
                              </span>
                            ))
                          ) : binding.mode === 'tag' ? (
                            binding.tags.map((tag) => (
                              <span key={tag} className="profile-pill">
                                标签：{tag}
                              </span>
                            ))
                          ) : (
                            <span className="profile-pill">
                              指定 {binding.nodeIds.length} 个节点
                              {binding.missingNodeIds.length ? ` · ${binding.missingNodeIds.length} 个失效` : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="meta-row">
                  <span className="meta-label">标签筛选</span>
                  <div className="meta-tags">
                    {profile.tags.length > 0 ? (
                      profile.tags.map((tag) => (
                        <span key={tag} className="profile-pill text-[11px]">
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">不过滤</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 右侧：YAML 视图 */}
          <div className="profile-detail-main">
            <div className="section yaml-view-section">
              <div className="yaml-view-toolbar">
                <div className="flex items-center gap-2">
                  <FileCode2 className="size-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Compiled YAML</span>
                  <span className="yaml-stat-pill">{yamlLines} 行</span>
                  <span className="yaml-stat-pill">{yamlSizeKb} KB</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!profile.compiledYaml}
                    onClick={() => copyText(profile.compiledYaml || '', 'YAML 内容')}
                  >
                    <Clipboard className="size-3.5 mr-1" />
                    复制全文
                  </Button>
                  <Button variant="outline" size="sm" disabled={!profile.compiledYaml} onClick={downloadYaml}>
                    <Download className="size-3.5 mr-1" />
                    下载
                  </Button>
                </div>
              </div>
              <div className="yaml-code-scroll">
                <pre>
                  <code>{profile.compiledYaml || '# 尚未生成配置内容，点击右上角「重新生成」'}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {rotatingToken && (
        <AppConfirmDialog
          title="轮换订阅令牌"
          description="轮换后，旧的订阅链接将立即失效，所有客户端都需要重新导入。"
          confirmLabel="确认轮换"
          busy={busy}
          onClose={() => setRotatingToken(false)}
          onConfirm={() => void runRotateToken()}
        />
      )}
    </div>
  )
}
