import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Copy, FileCode2, FilePlus2, Pencil, Plus, Trash2, Upload, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type { Profile, Source, TemplateDetail, TemplateId, TemplateSummary } from '@/api/types'
import { AppDialog, PageState } from '@/components/app-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProfileDialog } from '@/features/profiles/profile-dialog'
import { formatDate } from '@/lib/format'
import { TemplatePreview } from './template-preview'
import '@/styles/templates.css'

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
  const items = templates || []
  const builtin = items.filter((template) => template.kind === 'builtin')
  const custom = items.filter((template) => template.kind === 'custom')

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

  function create(source: 'builtin:minimal' | 'builtin:full' | 'import' | 'blank') {
    setChoosingSource(false)
    void navigate({ to: '/templates/new', search: { source } })
  }

  return (
    <div className="templates-page">
      <div className="page-heading">
        <div>
          <h1>模板库</h1>
          <p>{custom.length}/20 个自定义模板</p>
        </div>
        <Button onClick={() => setChoosingSource(true)}>
          <Plus data-icon="inline-start" />
          新建模板
        </Button>
      </div>
      <PageState loading={loading && !templates} error={error} />
      {templates && (
        <>
          <section className="template-section">
            <h2>内置模板</h2>
            <div className="template-grid">
              {builtin.map((template) => (
                <article className="template-card" key={template.id}>
                  <header>
                    <div>
                      <h3>{template.name}</h3>
                      <p>{template.description}</p>
                    </div>
                    <Badge variant="secondary">内置</Badge>
                  </header>
                  <footer>
                    <Button type="button" variant="ghost" onClick={() => setPreviewing(template)}>
                      预览
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setUsing(template.id)}>
                      <Zap data-icon="inline-start" />
                      使用
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy === template.id}
                      onClick={() => void duplicate(template)}
                    >
                      <Copy data-icon="inline-start" />
                      复制
                    </Button>
                  </footer>
                </article>
              ))}
            </div>
          </section>
          <section className="template-section">
            <h2>我的模板</h2>
            {custom.length ? (
              <div className="template-grid">
                {custom.map((template) => (
                  <article className="template-card" key={template.id}>
                    <header>
                      <div>
                        <h3>{template.name}</h3>
                        <p>{template.description || '自定义 Mihomo YAML'}</p>
                      </div>
                      <Badge variant="outline">自定义</Badge>
                    </header>
                    <div className="template-meta">
                      <span>revision {template.revision}</span>
                      <span>{template.profileCount} 个配置使用</span>
                      <time>{formatDate(template.updatedAt)}</time>
                    </div>
                    <footer>
                      <Button type="button" variant="ghost" onClick={() => setPreviewing(template)}>
                        预览
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void navigate({ to: '/templates/$id/edit', params: { id: template.id } })}
                      >
                        <Pencil data-icon="inline-start" />
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy === template.id}
                        onClick={() => void duplicate(template)}
                      >
                        <Copy data-icon="inline-start" />
                        复制
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setDeleting(template)}>
                        <Trash2 data-icon="inline-start" />
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
              </div>
            )}
          </section>
        </>
      )}

      {choosingSource && (
        <AppDialog title="新建模板" onClose={() => setChoosingSource(false)}>
          <div className="template-source-list">
            <Button variant="outline" onClick={() => create('builtin:minimal')}>
              <Zap data-icon="inline-start" />
              从精简模板创建
            </Button>
            <Button variant="outline" onClick={() => create('builtin:full')}>
              <FileCode2 data-icon="inline-start" />
              从全规则模板创建
            </Button>
            <Button variant="outline" onClick={() => create('import')}>
              <Upload data-icon="inline-start" />
              导入 YAML
            </Button>
            <Button variant="outline" onClick={() => create('blank')}>
              <FilePlus2 data-icon="inline-start" />
              空白模板
            </Button>
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
        <AppDialog title="删除模板" onClose={() => setDeleting(undefined)}>
          <p className="dialog-copy">确定删除“{deleting.name}”？此操作无法撤销。</p>
          <footer className="dialog-actions">
            <Button variant="outline" onClick={() => setDeleting(undefined)}>
              取消
            </Button>
            <Button variant="destructive" disabled={busy === deleting.id} onClick={() => void remove()}>
              删除
            </Button>
          </footer>
        </AppDialog>
      )}
    </div>
  )
}
