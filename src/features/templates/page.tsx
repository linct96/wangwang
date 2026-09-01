import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Copy, Eye, FileCode2, FilePlus2, Globe, Layers, Pencil, Plus, Trash2, Upload, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type { Profile, Source, TemplateDetail, TemplateId, TemplateSummary } from '@/api/types'
import { AppConfirmDialog, AppDialog, PageState } from '@/components/app-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ProfileDialog } from '@/features/profiles/profile-dialog'
import { formatDate } from '@/lib/format'
import { TemplatePreview } from './template-preview'
import '@/styles/templates.css'

const builtinTemplateIcons = {
  'builtin:minimal': { icon: Zap, color: 'text-amber-500 bg-amber-500/10' },
  'builtin:standard': { icon: Layers, color: 'text-blue-500 bg-blue-500/10' },
  'builtin:full': { icon: Globe, color: 'text-indigo-500 bg-indigo-500/10' },
} as const

const builtinFallback: TemplateSummary[] = [
  {
    id: 'builtin:minimal',
    name: '精简规则模板',
    description: '基础 DNS / 国内直连 / 自动选择',
    kind: 'builtin',
    readOnly: true,
    profileCount: 0,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'builtin:standard',
    name: '标准规则模板',
    description: '常用分流 / 国内直连 / AI 与流媒体',
    kind: 'builtin',
    readOnly: true,
    profileCount: 0,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'builtin:full',
    name: '完全规则模板',
    description: '标准超集 / 多服务分流 / IP 规则',
    kind: 'builtin',
    readOnly: true,
    profileCount: 0,
    createdAt: null,
    updatedAt: null,
  },
]

export function TemplatesPage() {
  const navigate = useNavigate()
  const { data: templates, error, loading, reload } = useApi<TemplateSummary[]>('/templates')
  const { data: profiles = [] } = useApi<Profile[]>('/profiles')
  const { data: sources = [] } = useApi<Source[]>('/sources?includeSystem=1')
  const [previewing, setPreviewing] = useState<TemplateSummary>()
  const [using, setUsing] = useState<TemplateId>()
  const [deleting, setDeleting] = useState<TemplateSummary>()
  const [choosingSource, setChoosingSource] = useState(false)
  const [busy, setBusy] = useState('')
  const builtin = templates?.filter((template) => template.kind === 'builtin') ?? builtinFallback
  const custom = templates?.filter((template) => template.kind === 'custom') ?? []

  async function duplicate(template: TemplateSummary) {
    setBusy(template.id)
    try {
      await api<TemplateDetail>(`/templates/${template.id}/duplicate`, { method: 'POST' })
      await reload()
      toast.success('模板已复制')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '复制失败')
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!deleting) return
    setBusy(deleting.id)
    try {
      await api(`/templates/${deleting.id}`, { method: 'DELETE' })
      setDeleting(undefined)
      await reload()
      toast.success('模板已删除')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '删除失败')
    } finally {
      setBusy('')
    }
  }

  function create(source: 'builtin:minimal' | 'builtin:standard' | 'builtin:full' | 'import' | 'blank') {
    setChoosingSource(false)
    void navigate({ to: '/templates/new', search: { source } })
  }

  return (
    <div className="templates-page">
      <div className="page-heading">
        <div>
          <h1>模板库</h1>
          <p>
            {custom.length}/20 个自定义模板 · {builtin.length} 个内置模板
          </p>
        </div>
        <Button onClick={() => setChoosingSource(true)}>
          <Plus data-icon="inline-start" />
          新建模板
        </Button>
      </div>
      {error && <PageState loading={false} error={error} />}

      <>
        <section className="template-section">
          <div className="template-section-header">
            <h2>内置模板</h2>
            <span className="template-section-count">{builtin.length}</span>
          </div>
          <div className="template-grid">
            {builtin.map((template) => {
              const iconConfig = builtinTemplateIcons[template.id as keyof typeof builtinTemplateIcons] || {
                icon: Zap,
                color: 'text-amber-500 bg-amber-500/10',
              }
              const TemplateIcon = iconConfig.icon
              return (
                <article className="template-card" key={template.id}>
                  <div className="template-card-body">
                    <header className="template-card-header">
                      <div
                        className={`template-card-icon flex size-8 items-center justify-center rounded ${iconConfig.color}`}
                      >
                        <TemplateIcon className="size-4" />
                      </div>
                      <div className="template-card-info">
                        <div className="template-card-title-row">
                          <h3 title={template.name}>{template.name}</h3>
                          <Badge variant="secondary">内置</Badge>
                        </div>
                        <p>{template.description || '开箱即用的预设规则模板'}</p>
                      </div>
                    </header>
                  </div>
                  <footer className="template-card-footer">
                    <Button type="button" variant="outline" size="sm" onClick={() => setUsing(template.id)}>
                      <Zap className="size-3.5" />
                      使用
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPreviewing(template)}>
                      <Eye className="size-3.5" />
                      预览
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy === template.id}
                      onClick={() => void duplicate(template)}
                    >
                      <Copy className="size-3.5" />
                      复制
                    </Button>
                  </footer>
                </article>
              )
            })}
          </div>
        </section>

        <section className="template-section">
          <div className="template-section-header">
            <h2>我的模板</h2>
            <span className="template-section-count">{custom.length}</span>
          </div>
          {loading && !templates ? (
            <section className="template-grid" aria-busy="true" aria-label="正在加载我的模板">
              {Array.from({ length: 3 }, (_, index) => (
                <article className="template-card" key={index} aria-hidden="true">
                  <div className="template-card-body">
                    <header className="template-card-header">
                      <Skeleton className="h-9 w-9 rounded-lg" />
                      <div className="template-card-info space-y-2">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    </header>
                  </div>
                  <footer className="template-card-footer">
                    <Skeleton className="h-4 w-20" />
                    <div className="flex gap-1.5">
                      <Skeleton className="h-7 w-16" />
                      <Skeleton className="h-7 w-16" />
                    </div>
                  </footer>
                </article>
              ))}
            </section>
          ) : custom.length ? (
            <div className="template-grid">
              {custom.map((template) => (
                <article className="template-card" key={template.id}>
                  <div className="template-card-body">
                    <header className="template-card-header">
                      <div className="template-card-icon template-icon-custom">
                        <FileCode2 className="size-4" />
                      </div>
                      <div className="template-card-info">
                        <div className="template-card-title-row">
                          <h3 title={template.name}>{template.name}</h3>
                          <Badge variant="outline">自定义</Badge>
                        </div>
                        <p>{template.description || '自定义 Mihomo YAML 规则模板'}</p>
                      </div>
                    </header>
                    <div className="template-card-meta">
                      <span className="template-meta-pill">{template.profileCount} 个配置使用</span>
                      <time className="template-meta-time">{formatDate(template.updatedAt)}</time>
                    </div>
                  </div>
                  <footer className="template-card-footer">
                    <Button type="button" variant="outline" size="sm" onClick={() => setUsing(template.id)}>
                      <Zap className="size-3.5" />
                      使用
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void navigate({ to: '/templates/$id/edit', params: { id: template.id } })}
                    >
                      <Pencil className="size-3.5" />
                      编辑
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPreviewing(template)}>
                      <Eye className="size-3.5" />
                      预览
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy === template.id}
                      onClick={() => void duplicate(template)}
                    >
                      <Copy className="size-3.5" />
                      复制
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleting(template)}
                    >
                      <Trash2 className="size-3.5" />
                      删除
                    </Button>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-block">
              <FileCode2 />
              <strong>暂无自定义模板</strong>
              <p className="text-xs text-muted-foreground mt-1">从内置模板复制或直接新建一个自定义规则模板</p>
            </div>
          )}
        </section>
      </>

      {choosingSource && (
        <AppDialog title="新建模板" onClose={() => setChoosingSource(false)} contentClassName="sm:max-w-lg">
          <div className="template-source-grid">
            <button type="button" className="template-source-card" onClick={() => create('builtin:minimal')}>
              <div className="template-source-icon text-amber-500 bg-amber-500/10">
                <Zap className="size-4.5" />
              </div>
              <div className="template-source-text">
                <strong>从精简规则模板创建</strong>
                <p>基础分流与快速节点选择，轻量高效</p>
              </div>
            </button>

            <button type="button" className="template-source-card" onClick={() => create('builtin:standard')}>
              <div className="template-source-icon text-blue-500 bg-blue-500/10">
                <Layers className="size-4.5" />
              </div>
              <div className="template-source-text">
                <strong>从标准规则模板创建</strong>
                <p>MRS 常用分流，国内直连、AI 与流媒体独立选择</p>
              </div>
            </button>

            <button type="button" className="template-source-card" onClick={() => create('builtin:full')}>
              <div className="template-source-icon text-indigo-500 bg-indigo-500/10">
                <Globe className="size-4.5" />
              </div>
              <div className="template-source-text">
                <strong>从完全规则模板创建</strong>
                <p>标准规则超集，增加 GitHub、Google、Telegram、Microsoft、Apple、游戏分流</p>
              </div>
            </button>

            <button type="button" className="template-source-card" onClick={() => create('import')}>
              <div className="template-source-icon text-emerald-500 bg-emerald-500/10">
                <Upload className="size-4.5" />
              </div>
              <div className="template-source-text">
                <strong>导入 YAML</strong>
                <p>导入现有的 Clash / Mihomo 配置文件</p>
              </div>
            </button>

            <button type="button" className="template-source-card" onClick={() => create('blank')}>
              <div className="template-source-icon text-purple-500 bg-purple-500/10">
                <FilePlus2 className="size-4.5" />
              </div>
              <div className="template-source-text">
                <strong>空白模板</strong>
                <p>从零开始完全自由配置节点组与规则</p>
              </div>
            </button>
          </div>
        </AppDialog>
      )}
      {previewing && (
        <AppDialog
          title={previewing.name}
          onClose={() => setPreviewing(undefined)}
          contentClassName="template-preview-dialog sm:max-w-4xl"
        >
          <TemplatePreview templateId={previewing.id} profiles={profiles} auto />
        </AppDialog>
      )}
      {using && (
        <ProfileDialog
          sources={sources}
          initialTemplateId={using}
          onClose={() => setUsing(undefined)}
          onSaved={async (jobId, profileId) => {
            setUsing(undefined)
            try {
              await waitForJob(jobId)
              toast.success('配置生成成功')
              await navigate({ to: '/profiles/$id', params: { id: profileId } })
            } catch (reason) {
              toast.error(reason instanceof Error ? reason.message : '生成失败')
            }
          }}
        />
      )}
      {deleting && (
        <AppConfirmDialog
          title="删除模板"
          description={`确定删除“${deleting.name}”？此操作无法撤销。`}
          confirmLabel="删除"
          busy={busy === deleting.id}
          onClose={() => setDeleting(undefined)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  )
}
