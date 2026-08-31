import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Check, Save, Upload, WandSparkles } from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useApi } from '@/api/use-api'
import type { Profile, TemplateDetail } from '@/api/types'
import { IconButton, PageState } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatYaml } from '@/lib/yaml-editor'
import { TemplatePreview } from './template-preview'
import { Segmented } from '@/components/ui/segmented'
import { parseVisualTemplate, applyVisualTemplate } from './visual/yaml-adapter'
import { validateVisualDraft } from './visual/validation'
import { VisualTemplateEditor } from './visual/visual-editor'
import type { VisualChangeMeta, VisualTemplateDraft } from './visual/model'
import { inferGeoSource } from './visual/rules/geo-catalog'
import '@/styles/templates.css'

const YamlCodeEditor = lazy(() => import('@/components/yaml-code-editor'))

type NewTemplateSource = 'builtin:minimal' | 'builtin:standard' | 'builtin:full' | 'import' | 'blank'
const blankTemplate = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
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
  const initialMode = source === 'import' ? 'yaml' : 'visual'
  const [mode, setMode] = useState<'visual' | 'yaml'>(initialMode)
  const [visualDraft, setVisualDraft] = useState<VisualTemplateDraft | null>(() => {
    if (source === 'blank') {
      try {
        return parseVisualTemplate(blankTemplate).draft
      } catch {
        return null
      }
    }
    return null
  })
  const [visualIssues, setVisualIssues] = useState<ReturnType<typeof validateVisualDraft>>(() => {
    if (source === 'blank') {
      try {
        const result = parseVisualTemplate(blankTemplate)
        return validateVisualDraft(result.draft, result.warnings)
      } catch {
        return []
      }
    }
    return []
  })
  const yamlRef = useRef(yaml)
  const visualDraftRef = useRef(visualDraft)
  const materializedDraftRef = useRef(visualDraft)
  const pendingValidationRef = useRef<{ type: 'idle' | 'timeout'; id: number } | null>(null)
  const validationVersionRef = useRef(0)

  function cancelScheduledValidation() {
    validationVersionRef.current += 1
    const pending = pendingValidationRef.current
    if (!pending) return
    if (pending.type === 'idle') window.cancelIdleCallback(pending.id)
    else window.clearTimeout(pending.id)
    pendingValidationRef.current = null
  }

  function scheduleVisualValidation(nextDraft: VisualTemplateDraft) {
    cancelScheduledValidation()
    const version = validationVersionRef.current
    const run = () => {
      if (version !== validationVersionRef.current) return
      pendingValidationRef.current = null
      if (visualDraftRef.current !== nextDraft) return
      setVisualIssues(validateVisualDraft(nextDraft))
    }
    pendingValidationRef.current =
      typeof window.requestIdleCallback === 'function'
        ? { type: 'idle', id: window.requestIdleCallback(run, { timeout: 500 }) }
        : { type: 'timeout', id: window.setTimeout(run, 50) }
  }

  function materializeVisualYaml() {
    const draft = visualDraftRef.current
    if (!draft || draft === materializedDraftRef.current) return yamlRef.current
    const nextYaml = applyVisualTemplate(yamlRef.current, draft, materializedDraftRef.current || undefined)
    yamlRef.current = nextYaml
    materializedDraftRef.current = draft
    setYaml(nextYaml)
    return nextYaml
  }

  useEffect(
    () => () => {
      const pending = pendingValidationRef.current
      if (!pending) return
      if (pending.type === 'idle') window.cancelIdleCallback(pending.id)
      else window.clearTimeout(pending.id)
    },
    [],
  )

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
        yamlRef.current = template.yaml
        setYaml(template.yaml)
        try {
          const result = parseVisualTemplate(template.yaml)
          visualDraftRef.current = result.draft
          materializedDraftRef.current = result.draft
          setVisualDraft(result.draft)
          setVisualIssues(validateVisualDraft(result.draft, result.warnings))
          setMode('visual')
        } catch {
          visualDraftRef.current = null
          materializedDraftRef.current = null
          setVisualDraft(null)
          setMode('yaml')
        }
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

  useEffect(() => {
    if (source === 'blank' && yaml && !visualDraft) {
      try {
        const result = parseVisualTemplate(yaml)
        visualDraftRef.current = result.draft
        materializedDraftRef.current = result.draft
        setVisualDraft(result.draft)
        setVisualIssues(validateVisualDraft(result.draft, result.warnings))
        setMode('visual')
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '无法进入可视化编辑')
      }
    }
  }, [source, yaml, visualDraft])

  function enterVisualMode() {
    try {
      const result = parseVisualTemplate(yamlRef.current)
      visualDraftRef.current = result.draft
      materializedDraftRef.current = result.draft
      setVisualDraft(result.draft)
      setVisualIssues(validateVisualDraft(result.draft, result.warnings))
      setMode('visual')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法进入可视化编辑')
    }
  }

  function enterYamlMode() {
    try {
      materializeVisualYaml()
      setMode('yaml')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '可视化更新失败')
    }
  }

  function updateVisualDraft(nextDraft: VisualTemplateDraft, meta?: VisualChangeMeta) {
    if (meta?.type === 'reorder') {
      visualDraftRef.current = nextDraft
      setVisualDraft(nextDraft)
      scheduleVisualValidation(nextDraft)
      setError('')
      return
    }

    cancelScheduledValidation()
    try {
      const nextYaml = applyVisualTemplate(yamlRef.current, nextDraft, materializedDraftRef.current || undefined)
      yamlRef.current = nextYaml
      visualDraftRef.current = nextDraft
      materializedDraftRef.current = nextDraft
      setVisualDraft(nextDraft)
      setVisualIssues(validateVisualDraft(nextDraft))
      setYaml(nextYaml)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '可视化更新失败')
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 1024 * 1024) {
      setError('模板 YAML 超过 1 MiB')
      return
    }
    const nextYaml = await file.text()
    yamlRef.current = nextYaml
    visualDraftRef.current = null
    materializedDraftRef.current = null
    setYaml(nextYaml)
    setVisualDraft(null)
    setMode('yaml')
    if (!name) setName(file.name.replace(/\.ya?ml$/i, ''))
    setError('')
  }

  async function validate() {
    setBusy('validate')
    setError('')
    try {
      const yamlToValidate = mode === 'visual' ? materializeVisualYaml() : yamlRef.current
      await api('/templates/validate', { method: 'POST', body: JSON.stringify({ yaml: yamlToValidate }) })
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
      const yamlToSave = mode === 'visual' ? materializeVisualYaml() : yamlRef.current
      const result = await api<TemplateDetail | { template: TemplateDetail; jobIds: string[] }>(
        id ? `/templates/${id}` : '/templates',
        {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify({ name, description: description.trim() || null, yaml: yamlToSave }),
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
            <div className="template-info-card">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="template-name">名称</FieldLabel>
                  <Input
                    id="template-name"
                    value={name}
                    maxLength={60}
                    placeholder="例如：我的分流规则模板"
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="template-description">描述（可选）</FieldLabel>
                  <Input
                    id="template-description"
                    value={description}
                    maxLength={200}
                    placeholder="简述该模板适用的场景或节点策略"
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
              </div>
            </div>

            <div className="template-yaml-heading">
              <div className="template-content-heading">
                <FieldLabel id="template-yaml-label">模板内容</FieldLabel>
                <Segmented
                  className="template-mode-switch"
                  value={mode}
                  options={[
                    { value: 'visual', label: '可视化编辑' },
                    { value: 'yaml', label: 'YAML 编辑' },
                  ]}
                  onChange={(next) => (next === 'visual' ? enterVisualMode() : enterYamlMode())}
                />
              </div>
              <div className="flex items-center gap-1.5">
                {source === 'import' && (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      <Upload data-icon="inline-start" />
                      导入文件
                      <input className="sr-only" type="file" accept=".yaml,.yml,text/yaml" onChange={importFile} />
                    </label>
                  </Button>
                )}
                {mode === 'yaml' && (
                  <IconButton
                    label="格式化 YAML"
                    onClick={() => {
                      const formatted = formatYaml(yaml)
                      if (formatted) {
                        yamlRef.current = formatted
                        setYaml(formatted)
                      }
                    }}
                  >
                    <WandSparkles />
                  </IconButton>
                )}
              </div>
            </div>

            {mode === 'yaml' ? (
              <Suspense fallback={<div className="template-code-editor" />}>
                <YamlCodeEditor
                  className="template-code-editor"
                  value={yaml}
                  height="100%"
                  theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                  onChange={(next) => {
                    yamlRef.current = next
                    visualDraftRef.current = null
                    materializedDraftRef.current = null
                    setYaml(next)
                    setVisualDraft(null)
                  }}
                  aria-labelledby="template-yaml-label"
                />
              </Suspense>
            ) : (
              visualDraft && (
                <VisualTemplateEditor
                  draft={visualDraft}
                  issues={visualIssues}
                  onChange={updateVisualDraft}
                  geoProvider={(type) => inferGeoSource(visualDraft.geo, type).provider}
                  customGeo={
                    inferGeoSource(visualDraft.geo, 'GEOSITE').provider === 'custom' ||
                    inferGeoSource(visualDraft.geo, 'GEOIP').provider === 'custom'
                  }
                />
              )
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <footer className="template-editor-actions">
              <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void validate()}>
                <Check data-icon="inline-start" />
                校验语法
              </Button>
              <Button
                disabled={
                  Boolean(busy) ||
                  !name.trim() ||
                  !yaml.trim() ||
                  (mode === 'visual' && visualIssues.some((issue) => issue.level === 'error'))
                }
              >
                <Save data-icon="inline-start" />
                保存模板
              </Button>
            </footer>
          </section>
          <aside className="template-editor-preview">
            <h2>配置预览</h2>
            <TemplatePreview
              yaml={yaml}
              getYaml={mode === 'visual' ? materializeVisualYaml : undefined}
              profiles={profiles}
            />
          </aside>
        </form>
      )}
    </div>
  )
}
