import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import CodeMirror from '@uiw/react-codemirror'
import { ArrowLeft, Check, Save, Upload, WandSparkles } from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useApi } from '@/api/use-api'
import type { Profile, TemplateDetail } from '@/api/types'
import { IconButton, PageState } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatYaml, yamlEditorExtensions } from '@/lib/yaml-editor'
import { TemplatePreview } from './template-preview'
import '@/styles/templates.css'

type NewTemplateSource = 'builtin:minimal' | 'builtin:full' | 'import' | 'blank'
const blankTemplate = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_ALL_PROXIES__
      - DIRECT
rules:
  - MATCH,节点选择
`

export function NewTemplatePage() {
  const { source } = useSearch({ from: '/app/templates/new' })
  return <TemplateEditor source={source} />
}

export function EditTemplatePage() {
  const { id } = useParams({ from: '/app/templates/$id/edit' })
  return <TemplateEditor id={id} />
}

function TemplateEditor({ id, source }: { id?: string; source?: NewTemplateSource }) {
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const { data: profiles = [] } = useApi<Profile[]>('/profiles')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [yaml, setYaml] = useState(source === 'blank' ? blankTemplate : '')
  const [loading, setLoading] = useState(Boolean(id || source?.startsWith('builtin:')))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const templateId = id || (source?.startsWith('builtin:') ? source : '')
    if (!templateId) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void api<TemplateDetail>(`/templates/${templateId}`, { signal: controller.signal })
      .then((template) => {
        if (controller.signal.aborted) return
        setName(id ? template.name : `${template.name} 副本`)
        setDescription(template.description || '')
        setYaml(template.yaml)
        setError('')
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '模板加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [id, source])

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 1024 * 1024) {
      setError('模板 YAML 超过 1 MiB')
      return
    }
    setYaml(await file.text())
    if (!name) setName(file.name.replace(/\.ya?ml$/i, ''))
    setError('')
  }

  async function validate() {
    setBusy('validate')
    setError('')
    try {
      await api('/templates/validate', { method: 'POST', body: JSON.stringify({ yaml }) })
      toast.success('模板校验通过')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模板校验失败')
    } finally {
      setBusy('')
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy('save')
    setError('')
    try {
      const result = await api<TemplateDetail | { template: TemplateDetail; jobIds: string[] }>(
        id ? `/templates/${id}` : '/templates',
        {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify({ name, description: description.trim() || null, yaml }),
        },
      )
      const jobs = 'jobIds' in result ? result.jobIds.length : 0
      toast.success(jobs ? `模板已保存，正在更新 ${jobs} 个配置` : '模板已保存')
      await navigate({ to: '/templates' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模板保存失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="template-editor-page">
      <div className="page-heading">
        <div className="title-with-back">
          <IconButton label="返回" onClick={() => void navigate({ to: '/templates' })}>
            <ArrowLeft />
          </IconButton>
          <div>
            <h1>{id ? '编辑模板' : '新建模板'}</h1>
            <p>{id ? '保存后自动重新生成关联配置' : '使用 Mihomo YAML 定义订阅输出'}</p>
          </div>
        </div>
      </div>
      <PageState loading={loading} error={error && loading ? error : ''} />
      {!loading && (
        <form className="template-editor-layout" onSubmit={save}>
          <section className="template-editor-main">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="template-name">名称</FieldLabel>
                <Input
                  id="template-name"
                  value={name}
                  maxLength={60}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="template-description">描述</FieldLabel>
                <Input
                  id="template-description"
                  value={description}
                  maxLength={200}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
            </FieldGroup>
            <div className="template-yaml-heading">
              <FieldLabel id="template-yaml-label">YAML 内容</FieldLabel>
              <div>
                {source === 'import' && (
                  <Button type="button" variant="ghost" size="sm" asChild>
                    <label>
                      <Upload data-icon="inline-start" />
                      导入文件
                      <input className="sr-only" type="file" accept=".yaml,.yml,text/yaml" onChange={importFile} />
                    </label>
                  </Button>
                )}
                <IconButton
                  label="格式化 YAML"
                  onClick={() => {
                    const formatted = formatYaml(yaml)
                    if (formatted) setYaml(formatted)
                  }}
                >
                  <WandSparkles />
                </IconButton>
              </div>
            </div>
            <CodeMirror
              className="template-code-editor"
              value={yaml}
              height="100%"
              theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
              extensions={yamlEditorExtensions}
              onChange={setYaml}
              aria-labelledby="template-yaml-label"
            />
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <footer className="template-editor-actions">
              <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void validate()}>
                <Check data-icon="inline-start" />
                校验
              </Button>
              <Button disabled={Boolean(busy) || !name.trim() || !yaml.trim()}>
                <Save data-icon="inline-start" />
                保存模板
              </Button>
            </footer>
          </section>
          <aside className="template-editor-preview">
            <h2>配置预览</h2>
            <TemplatePreview yaml={yaml} profiles={profiles} />
          </aside>
        </form>
      )}
    </div>
  )
}
