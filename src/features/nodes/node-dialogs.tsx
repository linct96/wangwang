import { useState } from 'react'
import type { FormEvent } from 'react'
import { RefreshCw, WandSparkles } from 'lucide-react'
import { useForm } from '@tanstack/react-form'
import { useTheme } from 'next-themes'
import { z } from 'zod'
import { api } from '@/api/client'
import { useApi } from '@/api/use-api'
import type { ManualNodeConnection, NodeDetail, NodeImportResult, NodeItem } from '@/api/types'
import { AppDialog, PageState } from '@/components/app-primitives'
import YamlCodeEditor from '@/components/yaml-code-editor'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { formatYaml } from '@/lib/yaml-editor'
import { defaultConnection, ManualConnectionFields } from './node-form'

const tagsSchema = z.string().superRefine((value, context) => {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  if (tags.length > 10) context.addIssue({ code: 'custom', message: '标签不能超过 10 个' })
  if (tags.some((tag) => tag.length > 24)) context.addIssue({ code: 'custom', message: '单个标签不能超过 24 个字符' })
})

const connectionSchema = z
  .custom<ManualNodeConnection>((value) => Boolean(value && typeof value === 'object'), '连接参数无效')
  .superRefine((value, context) => {
    let message = ''
    if (!value.name.trim()) message = '请输入节点名称'
    else if (value.name.trim().length > 80) message = '节点名称不能超过 80 个字符'
    else if (!value.server.trim()) message = '请输入服务器地址'
    else if (value.server.trim().length > 255) message = '服务器地址不能超过 255 个字符'
    else if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
      message = '端口必须是 1 到 65535 的整数'
    else if (value.protocol === 'ss' && !value.cipher?.trim()) message = '请输入加密方式'
    else if (['vmess', 'vless', 'tuic'].includes(value.protocol) && !value.uuid && !value.hasUuid)
      message = '请输入 UUID'
    else if (['ss', 'trojan', 'hysteria2', 'tuic'].includes(value.protocol) && !value.password && !value.hasPassword)
      message = '请输入密码'
    else if (value.security === 'reality' && !value.realityPublicKey?.trim()) message = '请输入 Reality 公钥'
    if (message) context.addIssue({ code: 'custom', message })
  })

export function AddNodeDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (result?: NodeImportResult) => void
}) {
  const [mode, setMode] = useState<'import' | 'form'>('import')
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: { content: '', connection: defaultConnection(), tags: '', enabled: true },
    validators: {
      onSubmit: z.object({
        content:
          mode === 'import'
            ? z
                .string()
                .trim()
                .min(1, '请输入节点内容')
                .refine((value) => new TextEncoder().encode(value).byteLength <= 1024 * 1024, '节点内容不能超过 1 MiB')
            : z.string(),
        connection: mode === 'form' ? connectionSchema : z.any(),
        tags: tagsSchema,
        enabled: z.boolean(),
      }),
    },
    onSubmit: async ({ value }) => {
      setError('')
      try {
        const options = {
          tags: value.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          enabled: value.enabled,
        }
        if (mode === 'import') {
          const result = await api<NodeImportResult>('/nodes/import', {
            method: 'POST',
            body: JSON.stringify({ content: value.content, ...options }),
          })
          onSaved(result)
        } else {
          await api('/nodes', {
            method: 'POST',
            body: JSON.stringify({ connection: value.connection, ...options }),
          })
          onSaved()
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '添加失败')
      }
    },
  })
  async function submit(event: FormEvent) {
    event.preventDefault()
    await form.handleSubmit()
  }
  return (
    <AppDialog title="添加节点" onClose={onClose} contentClassName="overflow-hidden">
      <form className="form" onSubmit={submit} noValidate>
        <Segmented
          block
          value={mode}
          options={[
            { label: '导入', value: 'import' },
            { label: '表单', value: 'form' },
          ]}
          onChange={(value) => {
            setMode(value)
            setError('')
          }}
        />
        <FieldGroup
          className={
            mode === 'form'
              ? 'h-[calc(100dvh-20rem)] overflow-y-auto overscroll-contain p-1 pr-2 [scrollbar-gutter:stable]'
              : 'h-[calc(100dvh-20rem)] min-h-0 p-1 pr-2'
          }
        >
          {mode === 'import' ? (
            <form.Field name="content">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="min-h-0 flex-1" data-invalid={invalid}>
                    <FieldLabel htmlFor="node-import-content">节点内容</FieldLabel>
                    <Textarea
                      id="node-import-content"
                      className="min-h-0 flex-1 resize-none overflow-y-auto field-sizing-fixed"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder={`每行一个节点链接：
vless://uuid@example.com:443#香港节点
trojan://password@example.net:443#日本节点

或粘贴 YAML 节点列表：
proxies:
  - name: 新加坡节点
    type: ss
    server: sg.example.com
    port: 8388
    cipher: aes-128-gcm
    password: your-password`}
                      aria-invalid={invalid}
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
          ) : (
            <form.Field name="connection">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <ManualConnectionFields value={field.state.value} onChange={field.handleChange} />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
          )}
          <form.Field name="tags">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="manual-tags">标签</FieldLabel>
                  <Input
                    id="manual-tags"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="香港, 高速"
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          <Field orientation="horizontal">
            <form.Field name="enabled">
              {(field) => (
                <Checkbox
                  id="manual-enabled"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked === true)}
                />
              )}
            </form.Field>
            <FieldLabel htmlFor="manual-enabled">启用节点</FieldLabel>
          </Field>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>
        <footer>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <form.Subscribe selector={(state) => [state.isSubmitting]}>
            {([isSubmitting]) => (
              <Button disabled={Boolean(isSubmitting)}>
                {isSubmitting && <RefreshCw data-icon="inline-start" className="spin" />}
                {mode === 'import' ? '导入节点' : '添加节点'}
              </Button>
            )}
          </form.Subscribe>
        </footer>
      </form>
    </AppDialog>
  )
}

export function NodeDialog({ node, onClose, onSaved }: { node: NodeItem; onClose: () => void; onSaved: () => void }) {
  const { data, error, loading } = useApi<NodeDetail>(`/nodes/${node.id}`)
  return (
    <AppDialog title="编辑节点" onClose={onClose} contentClassName="overflow-hidden">
      <PageState loading={loading} error={error} />
      {data && <NodeEditor key={data.updatedAt} node={data} onClose={onClose} onSaved={onSaved} />}
    </AppDialog>
  )
}

function NodeEditor({ node, onClose, onSaved }: { node: NodeDetail; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'form' | 'yaml'>('yaml')
  const { resolvedTheme } = useTheme()
  const form = useForm({
    defaultValues: {
      alias: node.alias || '',
      tags: node.tags.join(', '),
      enabled: node.enabled,
      connection: node.connection,
      yaml: node.yaml || '',
    },
    validators: {
      onSubmit: z.object({
        alias: z.string().trim().max(80, '显示名称不能超过 80 个字符'),
        tags: tagsSchema,
        enabled: z.boolean(),
        connection: node.canEditConnection && mode === 'form' ? connectionSchema : z.any(),
        yaml:
          node.canEditConnection && mode === 'yaml'
            ? z
                .string()
                .trim()
                .min(1, '请输入 YAML 内容')
                .refine((value) => new TextEncoder().encode(value).byteLength <= 1024 * 1024, 'YAML 内容不能超过 1 MiB')
            : z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      setError('')
      try {
        await api(`/nodes/${node.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            alias: value.alias || null,
            tags: value.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            enabled: value.enabled,
            connection: node.canEditConnection && mode === 'form' ? value.connection : undefined,
            yaml: node.canEditConnection && mode === 'yaml' ? value.yaml : undefined,
          }),
        })
        onSaved()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '保存失败')
      }
    },
  })
  async function submit(event: FormEvent) {
    event.preventDefault()
    await form.handleSubmit()
  }
  return (
    <form className="form" onSubmit={submit} noValidate>
      {node.canEditConnection && node.connection && (
        <Segmented
          block
          value={mode}
          options={[
            { label: 'YAML', value: 'yaml' },
            { label: '表单', value: 'form' },
          ]}
          onChange={(value) => {
            setMode(value)
            setError('')
          }}
        />
      )}
      <FieldGroup
        className={
          node.canEditConnection && mode === 'form'
            ? 'h-[calc(100dvh-20rem)] overflow-y-auto overscroll-contain p-1 pr-2 [scrollbar-gutter:stable]'
            : node.canEditConnection
              ? 'h-[calc(100dvh-20rem)] min-h-0 p-1 pr-2'
              : 'p-1 pr-2'
        }
      >
        {node.canEditConnection && mode === 'form' && form.getFieldValue('connection') ? (
          <form.Field name="connection">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <ManualConnectionFields value={field.state.value!} onChange={field.handleChange} />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
        ) : node.canEditConnection ? (
          <form.Field name="yaml">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field className="min-h-0 flex-1" data-invalid={invalid}>
                  <div className="flex items-center justify-between">
                    <FieldLabel id="node-yaml-label">YAML 内容</FieldLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="格式化 YAML"
                      aria-label="格式化 YAML"
                      onClick={() => {
                        const formatted = formatYaml(field.state.value)
                        if (formatted) field.handleChange(formatted)
                      }}
                    >
                      <WandSparkles />
                    </Button>
                  </div>
                  <YamlCodeEditor
                    id="node-yaml"
                    className="min-h-0 flex-1 overflow-hidden rounded-md border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
                    value={field.state.value}
                    height="100%"
                    theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
                    aria-labelledby="node-yaml-label"
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
        ) : (
          <Alert>
            <AlertDescription>连接参数由外部订阅维护，此处只保存显示名称、标签和启停状态。</AlertDescription>
          </Alert>
        )}
        {(!node.canEditConnection || mode === 'form') && (
          <form.Field name="alias">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="node-alias">显示名称</FieldLabel>
                  <Input
                    id="node-alias"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={node.name}
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
        )}
        <form.Field name="tags">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="node-tags">标签</FieldLabel>
                <Input
                  id="node-tags"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="香港, 高速"
                  aria-invalid={invalid}
                />
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>
        <Field orientation="horizontal">
          <form.Field name="enabled">
            {(field) => (
              <Checkbox
                id="node-enabled"
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
              />
            )}
          </form.Field>
          <FieldLabel htmlFor="node-enabled">启用节点</FieldLabel>
        </Field>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </FieldGroup>
      <footer>
        <Button type="button" variant="outline" onClick={onClose}>
          取消
        </Button>
        <form.Subscribe selector={(state) => [state.isSubmitting]}>
          {([isSubmitting]) => (
            <Button disabled={Boolean(isSubmitting)}>
              {isSubmitting && <RefreshCw data-icon="inline-start" className="spin" />}保存
            </Button>
          )}
        </form.Subscribe>
      </footer>
    </form>
  )
}
