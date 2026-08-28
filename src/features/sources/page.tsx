import { useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type { Source } from '@/api/types'
import { AppDialog, IconButton } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBytes, formatDate, formatRelativeTime } from '@/lib/format'

const customUserAgent = '__custom__'
const userAgentPresets = [
  { label: 'Clash Verge Rev', value: 'clash-verge/v2.5.2' },
  { label: 'FlClash', value: 'FlClash/v0.8.96 clash-verge Platform/windows' },
  { label: 'Mihomo', value: 'mihomo' },
]

export function SourcesPage() {
  const { data = [], error, loading, reload } = useApi<Source[]>('/sources')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Source>()
  const [deleting, setDeleting] = useState<Source>()
  const [busy, setBusy] = useState('')
  const [refreshStatus, setRefreshStatus] = useState<Record<string, 'loading' | 'success' | 'error'>>({})
  const initialLoading = loading && data.length === 0
  const refreshing = loading && data.length > 0

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
    <div className="sources-page">
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
      <section className="section table-wrap relative" aria-busy={loading}>
        <Table className="table-fixed">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[22%]" />
            <col className="w-[8%]" />
            <col className="w-[17%]" />
            <col className="w-[20%]" />
            <col className="w-[13.5%]" />
            <col className="w-[172px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>订阅链接</TableHead>
              <TableHead>节点</TableHead>
              <TableHead>流量使用</TableHead>
              <TableHead>到期时间</TableHead>
              <TableHead>上次刷新</TableHead>
              <TableHead className="actions text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialLoading ? (
              Array.from({ length: 8 }, (_, index) => (
                <TableRow key={index} aria-hidden="true">
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : error && data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="empty text-destructive">
                  {error}
                </TableCell>
              </TableRow>
            ) : data.length ? (
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
                    </TableCell>
                    <TableCell>
                      <div className="cell-sub">{source.url || '-'}</div>
                    </TableCell>
                    <TableCell>{source.nodeCount}</TableCell>
                    <TableCell>
                      {usagePercent == null ? (
                        '-'
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex min-w-0 max-w-32 flex-col gap-1">
                              <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                                <span>{usagePercent.toFixed(1)}%</span>
                              </div>
                              <Progress value={usagePercent} aria-label={`流量使用 ${usagePercent.toFixed(1)}%`} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              <span>上传：{formatBytes(source.uploadBytes)}</span>
                              <span>下载：{formatBytes(source.downloadBytes)}</span>
                              <span>总量：{formatBytes(totalBytes)}</span>
                              <span>剩余：{formatBytes(Math.max((totalBytes || 0) - usedBytes, 0))}</span>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      {source.expireAt && source.expireAt <= 8_640_000_000 ? formatDate(source.expireAt * 1000) : '-'}
                    </TableCell>
                    <TableCell>{formatRelativeTime(source.lastRefreshedAt)}</TableCell>
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
                        className="ml-3.5 mr-2"
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
                <TableCell colSpan={7} className="empty">
                  暂无外部订阅
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {refreshing && (
          <RefreshCw
            className="table-refresh absolute top-4 right-4 size-4 text-muted-foreground spin"
            aria-label="刷新中"
          />
        )}
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
          onSaved={async () => {
            const source = editing
            setEditing(undefined)
            setBusy(source.id)
            toast.success('订阅设置已保存')
            setBusy('')
            await reload()
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
    </div>
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
  const initialUserAgent = source?.userAgent || 'mihomo'
  const [userAgentOption, setUserAgentOption] = useState(
    userAgentPresets.some(({ value }) => value === initialUserAgent) ? initialUserAgent : customUserAgent,
  )
  const form = useForm({
    defaultValues: {
      name: source?.name || '',
      url: source?.url || '',
      userAgent: source?.userAgent || 'mihomo',
      nodeTag: source?.nodeTag || '',
      nodeNameFilter: source?.nodeNameFilter || '',
      interval: source?.refreshIntervalHours ?? 6,
    },
    validators: {
      onSubmit: z.object({
        name: source
          ? z.string().trim().min(1, '请输入订阅名称').max(60, '订阅名称不能超过 60 个字符')
          : z.string().trim().max(60, '订阅名称不能超过 60 个字符'),
        url: z.url('请输入有效的订阅地址').max(2048, '订阅地址不能超过 2048 个字符'),
        userAgent: z
          .string()
          .trim()
          .min(1, '请输入 User-Agent')
          .max(200, 'User-Agent 不能超过 200 个字符')
          .regex(/^[\x20-\x7e]+$/, 'User-Agent 仅支持 ASCII 字符'),
        nodeTag: z.string().trim().max(24, '节点标签不能超过 24 个字符'),
        nodeNameFilter: z
          .string()
          .trim()
          .max(200, '过滤规则不能超过 200 个字符')
          .refine((value) => {
            if (!value) return true
            try {
              new RegExp(value)
              return true
            } catch {
              return false
            }
          }, '节点名称过滤正则无效'),
        interval: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12), z.literal(24)]),
      }),
    },
    onSubmit: async ({ value }) => {
      const urlChanged = value.url.trim() !== (source?.url || '')
      const nodeNameFilter = value.nodeNameFilter.trim()
      setError('')
      try {
        const result = await api<{ jobId: string | null }>(source ? `/sources/${source.id}` : '/sources', {
          method: source ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: value.name,
            url: source ? (urlChanged ? value.url.trim() : undefined) : value.url.trim(),
            refreshIntervalHours: value.interval,
            userAgent: value.userAgent.trim(),
            nodeTag: value.nodeTag.trim(),
            nodeNameFilter,
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
      <form className="form" onSubmit={submit} noValidate>
        <FieldGroup>
          <form.Field name="url">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="source-url">订阅地址</FieldLabel>
                  <Input
                    id="source-url"
                    type="url"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="https://example.com/sub"
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="userAgent">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="source-user-agent">User-Agent</FieldLabel>
                  <div className="flex gap-2">
                    <Select
                      value={userAgentOption}
                      onValueChange={(value) => {
                        setUserAgentOption(value)
                        form.setFieldValue('userAgent', value === customUserAgent ? '' : value)
                      }}
                    >
                      <SelectTrigger className="w-40 shrink-0" aria-label="User-Agent 客户端">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {userAgentPresets.map(({ label, value }) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                          <SelectItem value={customUserAgent}>手动输入</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Input
                      id="source-user-agent"
                      className="min-w-0"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="mihomo"
                      readOnly={userAgentOption !== customUserAgent}
                      aria-readonly={userAgentOption !== customUserAgent}
                      aria-invalid={invalid}
                    />
                  </div>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="name">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="source-name">订阅名称</FieldLabel>
                  <Input
                    id="source-name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={source ? '例如：机场订阅' : '默认自动获取，可留空'}
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="nodeTag">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="source-node-tag">节点标签</FieldLabel>
                  <Input
                    id="source-node-tag"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="例如：机场 A"
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="nodeNameFilter">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="source-node-name-filter">节点名称过滤</FieldLabel>
                  <Input
                    id="source-node-name-filter"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="例如：广告|测试"
                    aria-invalid={invalid}
                  />
                  <FieldDescription>使用正则表达式，排除名称匹配的节点，留空表示不过滤。</FieldDescription>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
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
          <form.Subscribe selector={(state) => [state.isSubmitting]}>
            {([isSubmitting]) => (
              <Button disabled={Boolean(isSubmitting)}>
                {isSubmitting && <RefreshCw data-icon="inline-start" className="spin" />}
                {source ? '保存' : '完成'}
              </Button>
            )}
          </form.Subscribe>
        </footer>
      </form>
    </AppDialog>
  )
}
