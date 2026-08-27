import { useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useForm } from '@tanstack/react-form'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type { Source } from '@/api/types'
import { AppDialog, IconButton, PageState, Status } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBytes, formatDate } from '@/lib/format'

export function SourcesPage() {
  const { data = [], error, loading, reload } = useApi<Source[]>('/sources')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Source>()
  const [deleting, setDeleting] = useState<Source>()
  const [busy, setBusy] = useState('')
  const [refreshStatus, setRefreshStatus] = useState<Record<string, 'loading' | 'success' | 'error'>>({})

  async function action(id: string, operation: 'refresh' | 'toggle' | 'delete', enabled?: boolean) {
    if (operation === 'refresh') {
      setRefreshStatus((prev) => ({ ...prev, [id]: 'loading' }))
      try {
        const result = await api<{ jobId: string }>(`/sources/${id}/refresh`, { method: 'POST' })
        await waitForJob(result.jobId)
        setRefreshStatus((prev) => ({ ...prev, [id]: 'success' }))
        toast.success('节点源刷新成功')
      } catch (reason) {
        setRefreshStatus((prev) => ({ ...prev, [id]: 'error' }))
        toast.error(reason instanceof Error ? reason.message : '刷新失败')
      } finally {
        setTimeout(() => {
          setRefreshStatus((prev) => {
            const next = { ...prev }
            delete next[id]
            return next
          })
        }, 1500)
        await reload()
      }
      return
    }

    setBusy(id)
    try {
      if (operation === 'toggle') await api(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
      else {
        const result = await api<{ detachedProfileCount: number }>(`/sources/${id}`, { method: 'DELETE' })
        toast.success(
          result.detachedProfileCount ? `已删除，并解除 ${result.detachedProfileCount} 个配置引用` : '节点源已删除',
        )
        setDeleting(undefined)
      }
      await reload()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setBusy('')
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>节点源</h1>
          <p>{data.length}/20 个外部订阅</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          添加订阅
        </Button>
      </div>
      <PageState loading={loading} error={error} />
      <section className="section table-wrap">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>节点</TableHead>
              <TableHead>流量使用</TableHead>
              <TableHead>到期</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>上次刷新</TableHead>
              <TableHead>刷新间隔</TableHead>
              <TableHead className="actions text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length ? (
              data.map((source) => {
                const status = refreshStatus[source.id]
                const isRefreshing = status === 'loading'
                const usedBytes = (source.uploadBytes || 0) + (source.downloadBytes || 0)
                const totalBytes = source.totalBytes
                const usagePercent = totalBytes ? Math.min(100, (usedBytes / totalBytes) * 100) : null
                return (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div className="cell-main">{source.name}</div>
                      <div className="cell-sub">{source.url || '-'}</div>
                    </TableCell>
                    <TableCell>{source.nodeCount}</TableCell>
                    <TableCell>
                      {usagePercent == null ? (
                        '-'
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="traffic-meter">
                              <div className="traffic-meter-label">
                                <span>{usagePercent.toFixed(1)}%</span>
                                <div
                                  className="traffic-track"
                                  role="progressbar"
                                  aria-valuenow={usagePercent}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                >
                                  <span style={{ width: `${usagePercent}%` }} />
                                </div>
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            上传：{formatBytes(source.uploadBytes)} · 下载：{formatBytes(source.downloadBytes)}
                            <br />
                            已用：{formatBytes(usedBytes)} · 总量：{formatBytes(totalBytes)}
                            <br />
                            剩余：{formatBytes(Math.max((totalBytes || 0) - usedBytes, 0))}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      {source.expireAt == null ? '-' : formatDate(new Date(source.expireAt * 1000).toISOString())}
                    </TableCell>
                    <TableCell>
                      <Status value={isRefreshing ? 'refreshing' : busy === source.id ? 'refreshing' : source.status} />
                      {(source.error || source.warning) && (
                        <div className="cell-sub source-message" title={source.error || source.warning || ''}>
                          {source.error || source.warning}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(source.lastRefreshedAt)}</TableCell>
                    <TableCell>
                      {source.refreshIntervalHours ? `${source.refreshIntervalHours} 小时` : '关闭'}
                    </TableCell>
                    <TableCell className="actions">
                      <IconButton
                        label={status === 'success' ? '刷新成功' : status === 'error' ? '刷新失败' : '刷新'}
                        disabled={isRefreshing || busy === source.id || !source.enabled}
                        onClick={() => void action(source.id, 'refresh')}
                      >
                        {isRefreshing ? (
                          <RefreshCw className="spin" />
                        ) : status === 'success' ? (
                          <Check className="text-emerald-600 dark:text-emerald-400" />
                        ) : status === 'error' ? (
                          <X className="text-destructive" />
                        ) : (
                          <RefreshCw />
                        )}
                      </IconButton>
                      <IconButton label="编辑" onClick={() => setEditing(source)}>
                        <Pencil />
                      </IconButton>
                      <IconButton label="删除" onClick={() => setDeleting(source)}>
                        <Trash2 />
                      </IconButton>
                      <Switch
                        className="ml-3.5"
                        aria-label={source.enabled ? '停用' : '启用'}
                        checked={source.enabled}
                        onCheckedChange={(checked) => void action(source.id, 'toggle', checked)}
                      />
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="empty">
                  暂无外部订阅
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
      {adding && (
        <SourceDialog
          onClose={() => setAdding(false)}
          onSaved={async (jobId) => {
            setAdding(false)
            setBusy('new')
            try {
              if (jobId) await waitForJob(jobId)
              toast.success('订阅添加成功')
            } catch (reason) {
              toast.error(reason instanceof Error ? reason.message : '订阅刷新失败')
            } finally {
              setBusy('')
              await reload()
            }
          }}
        />
      )}
      {editing && (
        <SourceDialog
          source={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async (jobId) => {
            const source = editing
            setEditing(undefined)
            setBusy(source.id)
            try {
              if (jobId) await waitForJob(jobId)
              toast.success(jobId ? '新订阅地址验证成功' : '订阅设置已保存')
            } catch (reason) {
              toast.error(reason instanceof Error ? reason.message : '新订阅地址验证失败')
            } finally {
              setBusy('')
              await reload()
            }
          }}
        />
      )}
      {deleting && (
        <AppDialog title="删除节点源" onClose={() => setDeleting(undefined)}>
          <p className="dialog-copy">
            删除“{deleting.name}”将移除 {deleting.nodeCount} 个来源节点，并从 {deleting.profileCount}{' '}
            个配置中解除引用。受影响配置会自动重新生成。
          </p>
          <Alert variant="destructive">
            <AlertDescription>配置生成失败时会继续使用上一可用版本。</AlertDescription>
          </Alert>
          <footer className="dialog-actions">
            <Button type="button" variant="outline" onClick={() => setDeleting(undefined)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy === deleting.id}
              onClick={() => void action(deleting.id, 'delete')}
            >
              删除
            </Button>
          </footer>
        </AppDialog>
      )}
    </>
  )
}

function SourceDialog({
  source,
  onClose,
  onSaved,
}: {
  source?: Source
  onClose: () => void
  onSaved: (jobId: string | null) => void
}) {
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: {
      name: source?.name || '',
      url: source?.url || '',
      interval: source?.refreshIntervalHours ?? 6,
    },
    onSubmit: async ({ value }) => {
      const urlChanged = value.url.trim() !== (source?.url || '')
      setError('')
      try {
        const result = await api<{ jobId: string | null }>(source ? `/sources/${source.id}` : '/sources', {
          method: source ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: value.name,
            url: source ? (urlChanged ? value.url.trim() : undefined) : value.url.trim(),
            refreshIntervalHours: value.interval,
          }),
        })
        onSaved(result.jobId)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '创建失败')
      }
    },
  })
  async function submit(event: FormEvent) {
    event.preventDefault()
    await form.handleSubmit()
  }
  return (
    <AppDialog title={source ? '编辑订阅' : '添加订阅'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="source-name">名称</FieldLabel>
            <form.Field name="name">
              {(field) => (
                <Input
                  id="source-name"
                  required
                  maxLength={60}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="例如：主力订阅"
                />
              )}
            </form.Field>
          </Field>
          <Field>
            <FieldLabel htmlFor="source-url">订阅地址</FieldLabel>
            <form.Field name="url">
              {(field) => (
                <Input
                  id="source-url"
                  required
                  type="url"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="https://example.com/sub"
                />
              )}
            </form.Field>
          </Field>
          <Field>
            <FieldLabel>刷新间隔</FieldLabel>
            <form.Field name="interval">
              {(field) => (
                <Select value={String(field.state.value)} onValueChange={(value) => field.handleChange(Number(value))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="0">关闭</SelectItem>
                      <SelectItem value="1">1 小时</SelectItem>
                      <SelectItem value="6">6 小时</SelectItem>
                      <SelectItem value="12">12 小时</SelectItem>
                      <SelectItem value="24">24 小时</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </form.Field>
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
          <form.Subscribe selector={(state) => [state.isSubmitting, state.values.url]}>
            {([isSubmitting, currentUrl]) => (
              <Button disabled={Boolean(isSubmitting)}>
                {isSubmitting && <RefreshCw data-icon="inline-start" className="spin" />}
                {source ? (String(currentUrl).trim() !== (source.url || '') ? '保存并验证' : '保存') : '添加并刷新'}
              </Button>
            )}
          </form.Subscribe>
        </footer>
      </form>
    </AppDialog>
  )
}
