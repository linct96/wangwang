import { useState } from 'react'
import type { FormEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { useForm } from '@tanstack/react-form'
import { api } from '@/api/client'
import { useApi } from '@/api/use-api'
import type { NodeDetail, NodeItem } from '@/api/types'
import { AppDialog, PageState } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { defaultConnection, ManualConnectionFields } from './node-form'
import { parseVlessLink } from '@/lib/vless'

export function AddNodeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'link' | 'form'>('link')
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: { link: '', connection: defaultConnection(), tags: '', enabled: true },
    onSubmit: async ({ value }) => {
      setError('')
      try {
        const nextConnection = mode === 'link' ? parseVlessLink(value.link) : value.connection
        await api('/nodes', {
          method: 'POST',
          body: JSON.stringify({
            connection: nextConnection,
            tags: value.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            enabled: value.enabled,
          }),
        })
        onSaved()
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
    <AppDialog title="添加节点" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <FieldGroup>
          <Segmented
            block
            value={mode}
            options={[
              { label: '链接导入', value: 'link' },
              { label: '手动填写', value: 'form' },
            ]}
            onChange={(value) => {
              setMode(value)
              setError('')
            }}
          />
          {mode === 'link' ? (
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="manual-link">VLESS 链接</FieldLabel>
              <form.Field name="link">
                {(field) => (
                  <Textarea
                    id="manual-link"
                    required
                    aria-invalid={Boolean(error)}
                    rows={5}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="vless://uuid@example.com:443?..."
                  />
                )}
              </form.Field>
            </Field>
          ) : (
            <form.Field name="connection">
              {(field) => <ManualConnectionFields value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
          )}
          <Field>
            <FieldLabel htmlFor="manual-tags">标签</FieldLabel>
            <form.Field name="tags">
              {(field) => (
                <Input
                  id="manual-tags"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="香港, 高速"
                />
              )}
            </form.Field>
          </Field>
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
                {mode === 'link' ? '解析并添加' : '添加节点'}
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
    <AppDialog title="编辑节点" onClose={onClose}>
      <PageState loading={loading} error={error} />
      {data && <NodeEditor key={data.updatedAt} node={data} onClose={onClose} onSaved={onSaved} />}
    </AppDialog>
  )
}

function NodeEditor({ node, onClose, onSaved }: { node: NodeDetail; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: {
      alias: node.alias || '',
      tags: node.tags.join(', '),
      enabled: node.enabled,
      connection: node.connection,
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
            connection: node.canEditConnection ? value.connection : undefined,
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
    <form className="form" onSubmit={submit}>
      <FieldGroup>
        {node.canEditConnection && form.getFieldValue('connection') ? (
          <form.Field name="connection">
            {(field) => <ManualConnectionFields value={field.state.value!} onChange={field.handleChange} />}
          </form.Field>
        ) : (
          <Alert>
            <AlertDescription>连接参数由外部订阅维护，此处只保存显示名称、标签和启停状态。</AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="node-alias">显示名称</FieldLabel>
          <Input
            id="node-alias"
            value={form.getFieldValue('alias')}
            onChange={(event) => form.setFieldValue('alias', event.target.value)}
            placeholder={node.name}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="node-tags">标签</FieldLabel>
          <Input
            id="node-tags"
            value={form.getFieldValue('tags')}
            onChange={(event) => form.setFieldValue('tags', event.target.value)}
            placeholder="香港, 高速"
          />
        </Field>
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
