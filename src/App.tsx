import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, InputHTMLAttributes, ReactNode } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router'
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  Clipboard,
  Database,
  FileCode2,
  Menu,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcwKey,
  Search,
  Server,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useForm, useStore } from '@tanstack/react-form'
import { ThemeProvider } from 'next-themes'
import { ThemeToggle } from '@/components/theme-toggle'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog as DialogRoot, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Segmented } from '@/components/ui/segmented'
import { Toaster } from '@/components/ui/sonner'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/data-source'
import type { Job, ManualNodeConnection, NodeDetail, NodeItem, Profile, RuleModule, Source } from '@/data-source'
import { parseVlessLink } from '@/lib/vless'

function useApi<T>(path: string) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!signal) setLoading(true)
      try {
        const response = await api<T>(path, { signal })
        if (!signal?.aborted) {
          setData(response)
          setError('')
        }
      } catch (reason) {
        if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '请求失败')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [path],
  )
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])
  return { data, error, loading, reload: () => load() }
}

async function waitForJob(jobId: string) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const job = await api<Job>(`/jobs/${jobId}`)
    if (job.status === 'succeeded') return
    if (job.status === 'failed') throw new Error(job.error || '任务失败')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('任务等待超时')
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : '-'
}

function formatBytes(value: number | null) {
  if (value == null) return '未提供'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = -1
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`
}

function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    idle: '待刷新',
    refreshing: '刷新中',
    ready: '正常',
    error: '异常',
    pending: '等待中',
    running: '执行中',
    succeeded: '已完成',
    failed: '失败',
  }
  const variant = ['error', 'failed'].includes(value)
    ? 'destructive'
    : ['ready', 'succeeded'].includes(value)
      ? 'default'
      : 'secondary'
  return <Badge variant={variant}>{labels[value] || value}</Badge>
}

function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon" type="button" title={label} aria-label={label} {...props}>
      {children}
    </Button>
  )
}

function AppDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </DialogRoot>
  )
}

function PageState({ loading, error }: { loading: boolean; error: string }) {
  if (loading)
    return (
      <div className="page-state">
        <RefreshCw className="spin" />
        加载中
      </div>
    )
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  return null
}

const navigation = [
  { to: '/dashboard', label: '概览', icon: CircleGauge },
  { to: '/sources', label: '节点源', icon: Database },
  { to: '/nodes', label: '节点', icon: Network },
  { to: '/profiles', label: '配置', icon: FileCode2 },
]

function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  return (
    <div className="shell">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <Link to="/dashboard" className="brand-link" onClick={() => setMobileMenuOpen(false)}>
              <span className="brand-icon">W</span>
              <strong className="brand-title">Wangwang</strong>
            </Link>
          </div>

          <nav className="header-nav">
            {navigation.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === '/dashboard' }}
                activeProps={{ className: 'active' }}
                className="nav-link"
              >
                <Icon />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

          <div className="header-actions">
            <div className="worker-status">
              <span className="status-dot" />
              <Activity className="status-icon" />
              <span className="status-text">Cloudflare Worker</span>
            </div>
            <ThemeToggle className="theme-toggle-btn" />
            <IconButton
              className="mobile-toggle"
              label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X /> : <Menu />}
            </IconButton>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="mobile-nav">
            <div className="mobile-nav-list">
              {navigation.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  activeOptions={{ exact: to === '/dashboard' }}
                  activeProps={{ className: 'active' }}
                  onClick={() => setMobileMenuOpen(false)}
                  className="mobile-nav-link"
                >
                  <Icon />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
            <div className="mobile-nav-foot">
              <div className="mobile-nav-foot-status">
                <span className="status-dot" />
                <Activity className="status-icon" />
                <span>Cloudflare Worker</span>
              </div>
              <ThemeToggle className="theme-toggle-btn" />
            </div>
          </div>
        )}
      </header>
      {mobileMenuOpen && (
        <button type="button" className="mobile-mask" aria-label="关闭菜单" onClick={() => setMobileMenuOpen(false)} />
      )}
      <main>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function DashboardPage() {
  const { data, error, loading } = useApi<{ sources: number; nodes: number; profiles: number; recentJobs: Job[] }>(
    '/dashboard',
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>概览</h1>
          <p>节点池与配置运行状态</p>
        </div>
      </div>
      <PageState loading={loading} error={error} />
      {data && (
        <>
          <section className="metrics">
            <Link to="/sources">
              <Database />
              <span>节点源</span>
              <strong>{data.sources}</strong>
            </Link>
            <Link to="/nodes">
              <Server />
              <span>全局节点</span>
              <strong>{data.nodes}</strong>
            </Link>
            <Link to="/profiles">
              <FileCode2 />
              <span>配置</span>
              <strong>{data.profiles}</strong>
            </Link>
          </section>
          <section className="section">
            <div className="section-title">
              <h2>最近任务</h2>
            </div>
            <div className="table-wrap">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>任务</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead>结果</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentJobs.length ? (
                    data.recentJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>{job.type === 'refresh_source' ? '刷新节点源' : '生成配置'}</TableCell>
                        <TableCell>
                          <Status value={job.status} />
                        </TableCell>
                        <TableCell>{formatDate(job.createdAt)}</TableCell>
                        <TableCell className="muted">{job.error || '-'}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="empty">
                        暂无任务
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}
    </>
  )
}

function SourcesPage() {
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

function NodesPage() {
  const [query, setQuery] = useState('')
  const [protocol, setProtocol] = useState('')
  const [enabled, setEnabled] = useState('')
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useApi<{ items: NodeItem[]; total: number; page: number; pageSize: number }>(
    `/nodes?page=${page}&pageSize=50&q=${encodeURIComponent(query)}&protocol=${protocol}&enabled=${enabled}`,
  )
  const [selected, setSelected] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<NodeItem>()
  const [deleting, setDeleting] = useState<NodeItem>()
  const pages = Math.max(1, Math.ceil((data?.total || 0) / 50))
  async function batch(value: boolean) {
    try {
      await api('/nodes/batch', { method: 'PATCH', body: JSON.stringify({ ids: selected, enabled: value }) })
      setSelected([])
      await reload()
      toast.success(value ? '节点已启用' : '节点已停用')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '操作失败')
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>节点</h1>
          <p>{data?.total || 0}/2000 个节点</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          添加节点
        </Button>
      </div>
      <div className="toolbar">
        <label className="search">
          <Search />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder="搜索名称或服务器"
          />
        </label>
        <Select
          value={protocol || 'all'}
          onValueChange={(value) => {
            setProtocol(value === 'all' ? '' : value)
            setPage(1)
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部协议</SelectItem>
              {['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic'].map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={enabled || 'all'}
          onValueChange={(value) => {
            setEnabled(value === 'all' ? '' : value)
            setPage(1)
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="true">已启用</SelectItem>
              <SelectItem value="false">已停用</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {selected.length > 0 && (
          <div className="batch-actions">
            <span>已选 {selected.length}</span>
            <Button variant="outline" size="sm" onClick={() => void batch(true)}>
              启用
            </Button>
            <Button variant="outline" size="sm" onClick={() => void batch(false)}>
              停用
            </Button>
          </div>
        )}
      </div>
      <PageState loading={loading} error={error} />
      <section className="section table-wrap">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="checkbox">
                <Checkbox
                  aria-label="全选"
                  checked={Boolean(data?.items.length) && selected.length === data?.items.length}
                  onCheckedChange={(checked) => setSelected(checked ? data?.items.map((item) => item.id) || [] : [])}
                />
              </TableHead>
              <TableHead>节点</TableHead>
              <TableHead>协议</TableHead>
              <TableHead>服务器</TableHead>
              <TableHead>标签</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="actions text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.length ? (
              data.items.map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="checkbox">
                    <Checkbox
                      aria-label={`选择 ${node.name}`}
                      checked={selected.includes(node.id)}
                      onCheckedChange={(checked) =>
                        setSelected(checked ? [...selected, node.id] : selected.filter((id) => id !== node.id))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="node-name">
                      <span className="cell-main">{node.name}</span>
                      {node.management !== 'subscription' && (
                        <Badge variant="secondary">{node.management === 'mixed' ? '混合来源' : '手动'}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="protocol">{node.protocol}</code>
                  </TableCell>
                  <TableCell>
                    {node.server}:{node.port}
                  </TableCell>
                  <TableCell>
                    <div className="tags">
                      {node.tags.length ? (
                        node.tags.map((tag) => <span key={tag}>{tag}</span>)
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Status value={node.enabled ? 'ready' : 'idle'} />
                  </TableCell>
                  <TableCell className="actions">
                    <IconButton label="编辑" onClick={() => setEditing(node)}>
                      <Pencil />
                    </IconButton>
                    {node.canDelete && (
                      <IconButton label="删除" onClick={() => setDeleting(node)}>
                        <Trash2 />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="empty">
                  暂无节点
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
      <div className="pagination">
        <Button
          variant="outline"
          size="icon"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="下一页"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
      {editing && (
        <NodeDialog
          node={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined)
            await reload()
            toast.success('节点保存成功')
          }}
        />
      )}
      {adding && (
        <AddNodeDialog
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await reload()
            toast.success('节点添加成功，相关配置正在更新')
          }}
        />
      )}
      {deleting && (
        <AppDialog title="删除手动节点" onClose={() => setDeleting(undefined)}>
          <p className="dialog-copy">
            删除“{deleting.name}”后，引用“手动节点”的配置会自动重新生成。订阅来源仍持有的相同节点不会被删除。
          </p>
          <footer className="dialog-actions">
            <Button type="button" variant="outline" onClick={() => setDeleting(undefined)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                try {
                  await api(`/nodes/${deleting.id}`, { method: 'DELETE' })
                  setDeleting(undefined)
                  await reload()
                  toast.success('手动节点已删除')
                } catch (reason) {
                  toast.error(reason instanceof Error ? reason.message : '删除失败')
                }
              }}
            >
              删除
            </Button>
          </footer>
        </AppDialog>
      )}
    </>
  )
}

function defaultConnection(protocol: ManualNodeConnection['protocol'] = 'vless'): ManualNodeConnection {
  return {
    name: '',
    protocol,
    server: '',
    port: 443,
    network: 'tcp',
    security: ['vless', 'trojan'].includes(protocol) ? 'tls' : 'none',
    wsPath: '/',
    alterId: 0,
    cipher: protocol === 'ss' ? 'aes-128-gcm' : 'auto',
    pluginOptions: {},
    congestionController: 'bbr',
    udpRelayMode: 'native',
    skipCertVerify: false,
  }
}

function ConnectionTextField({
  id,
  label,
  value,
  onChange,
  ...props
}: {
  id: string
  label: string
  value: string | number
  onChange: (value: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange'>) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} {...props} />
    </Field>
  )
}

function ManualConnectionFields({
  value,
  onChange,
}: {
  value: ManualNodeConnection
  onChange: (value: ManualNodeConnection) => void
}) {
  const update = (patch: Partial<ManualNodeConnection>) => onChange({ ...value, ...patch })
  const transportProtocol = ['vmess', 'vless', 'trojan'].includes(value.protocol)
  const tlsProtocol = ['vmess', 'vless', 'trojan'].includes(value.protocol)
  const secretPlaceholder = (set?: boolean) => (set ? '已设置，留空保持不变' : '')
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>协议</FieldLabel>
        <Select
          value={value.protocol}
          onValueChange={(protocol) => {
            const next = defaultConnection(protocol as ManualNodeConnection['protocol'])
            onChange({ ...next, name: value.name, server: value.server, port: value.port })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {protocols.map((protocol) => (
                <SelectItem key={protocol} value={protocol}>
                  {protocol}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <div className="form-grid">
        <ConnectionTextField
          id="manual-name"
          label="节点名称"
          required
          value={value.name}
          onChange={(name) => update({ name })}
        />
        <ConnectionTextField
          id="manual-server"
          label="服务器"
          required
          value={value.server}
          onChange={(server) => update({ server })}
        />
        <ConnectionTextField
          id="manual-port"
          label="端口"
          required
          type="number"
          min={1}
          max={65535}
          value={value.port}
          onChange={(port) => update({ port: Number(port) })}
        />
      </div>

      {value.protocol === 'ss' && (
        <>
          <ConnectionTextField
            id="manual-cipher"
            label="加密方式"
            required
            value={value.cipher || ''}
            onChange={(cipher) => update({ cipher })}
          />
          <ConnectionTextField
            id="manual-password"
            label="密码"
            required={!value.hasPassword}
            type="password"
            value={value.password || ''}
            placeholder={secretPlaceholder(value.hasPassword)}
            onChange={(password) => update({ password })}
          />
          <ConnectionTextField
            id="manual-plugin"
            label="插件（可选）"
            value={value.plugin || ''}
            onChange={(plugin) => update({ plugin })}
          />
          {value.plugin && (
            <ConnectionTextField
              id="manual-plugin-options"
              label="插件参数"
              value={Object.entries(value.pluginOptions || {})
                .map(([key, item]) => `${key}=${item}`)
                .join('; ')}
              placeholder="mode=websocket; host=example.com"
              onChange={(text) =>
                update({
                  pluginOptions: Object.fromEntries(
                    text
                      .split(';')
                      .map((item) => item.trim().split('=', 2))
                      .filter(([key, item]) => key && item !== undefined),
                  ),
                })
              }
            />
          )}
        </>
      )}

      {['vmess', 'vless', 'tuic'].includes(value.protocol) && (
        <ConnectionTextField
          id="manual-uuid"
          label="UUID"
          required={!value.hasUuid}
          type="password"
          value={value.uuid || ''}
          placeholder={secretPlaceholder(value.hasUuid)}
          onChange={(uuid) => update({ uuid })}
        />
      )}
      {['trojan', 'hysteria2', 'tuic'].includes(value.protocol) && (
        <ConnectionTextField
          id="manual-protocol-password"
          label="密码"
          required={!value.hasPassword}
          type="password"
          value={value.password || ''}
          placeholder={secretPlaceholder(value.hasPassword)}
          onChange={(password) => update({ password })}
        />
      )}
      {value.protocol === 'vmess' && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-alter-id"
            label="Alter ID"
            type="number"
            min={0}
            value={value.alterId || 0}
            onChange={(alterId) => update({ alterId: Number(alterId) })}
          />
          <ConnectionTextField
            id="manual-vmess-cipher"
            label="加密方式"
            value={value.cipher || 'auto'}
            onChange={(cipher) => update({ cipher })}
          />
        </div>
      )}
      {value.protocol === 'vless' && (
        <ConnectionTextField
          id="manual-flow"
          label="Flow（可选）"
          value={value.flow || ''}
          onChange={(flow) => update({ flow })}
        />
      )}

      {transportProtocol && (
        <Field>
          <FieldLabel>传输方式</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={value.network || 'tcp'}
            onValueChange={(network) => network && update({ network: network as 'tcp' | 'ws' | 'grpc' })}
          >
            <ToggleGroupItem value="tcp">TCP</ToggleGroupItem>
            <ToggleGroupItem value="ws">WebSocket</ToggleGroupItem>
            <ToggleGroupItem value="grpc">gRPC</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      )}
      {value.network === 'ws' && transportProtocol && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-ws-path"
            label="WS Path"
            value={value.wsPath || '/'}
            onChange={(wsPath) => update({ wsPath })}
          />
          <ConnectionTextField
            id="manual-ws-host"
            label="WS Host（可选）"
            value={value.wsHost || ''}
            onChange={(wsHost) => update({ wsHost })}
          />
        </div>
      )}
      {value.network === 'grpc' && transportProtocol && (
        <ConnectionTextField
          id="manual-grpc-service"
          label="gRPC Service Name"
          value={value.grpcServiceName || ''}
          onChange={(grpcServiceName) => update({ grpcServiceName })}
        />
      )}

      {tlsProtocol && (
        <Field>
          <FieldLabel>传输安全</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={value.security || 'none'}
            onValueChange={(security) => security && update({ security: security as ManualNodeConnection['security'] })}
          >
            <ToggleGroupItem value="none">无</ToggleGroupItem>
            <ToggleGroupItem value="tls">TLS</ToggleGroupItem>
            {value.protocol !== 'vmess' && <ToggleGroupItem value="reality">Reality</ToggleGroupItem>}
          </ToggleGroup>
        </Field>
      )}
      {value.security !== 'none' && tlsProtocol && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-sni"
            label="SNI（可选）"
            value={value.sni || ''}
            onChange={(sni) => update({ sni })}
          />
          <ConnectionTextField
            id="manual-fingerprint"
            label="客户端指纹（可选）"
            value={value.clientFingerprint || ''}
            onChange={(clientFingerprint) => update({ clientFingerprint })}
          />
        </div>
      )}
      {value.security === 'reality' && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-reality-key"
            label="Reality 公钥"
            required
            value={value.realityPublicKey || ''}
            onChange={(realityPublicKey) => update({ realityPublicKey })}
          />
          <ConnectionTextField
            id="manual-reality-short-id"
            label="Reality Short ID（可选）"
            value={value.realityShortId || ''}
            onChange={(realityShortId) => update({ realityShortId })}
          />
        </div>
      )}

      {value.protocol === 'hysteria2' && (
        <>
          <ConnectionTextField
            id="manual-hy2-sni"
            label="SNI（可选）"
            value={value.sni || ''}
            onChange={(sni) => update({ sni })}
          />
          <div className="form-grid">
            <ConnectionTextField
              id="manual-obfs"
              label="混淆类型（可选）"
              value={value.obfs || ''}
              onChange={(obfs) => update({ obfs })}
            />
            <ConnectionTextField
              id="manual-obfs-password"
              label="混淆密码（可选）"
              type="password"
              value={value.obfsPassword || ''}
              placeholder={secretPlaceholder(value.hasObfsPassword)}
              onChange={(obfsPassword) => update({ obfsPassword })}
            />
          </div>
        </>
      )}
      {value.protocol === 'tuic' && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-tuic-sni"
            label="SNI（可选）"
            value={value.sni || ''}
            onChange={(sni) => update({ sni })}
          />
          <ConnectionTextField
            id="manual-congestion"
            label="拥塞控制"
            value={value.congestionController || 'bbr'}
            onChange={(congestionController) => update({ congestionController })}
          />
          <ConnectionTextField
            id="manual-udp-relay"
            label="UDP Relay 模式"
            value={value.udpRelayMode || 'native'}
            onChange={(udpRelayMode) => update({ udpRelayMode })}
          />
        </div>
      )}
      {['hysteria2', 'tuic'].includes(value.protocol) && (
        <Field orientation="horizontal">
          <Checkbox
            id="manual-skip-cert"
            checked={value.skipCertVerify || false}
            onCheckedChange={(checked) => update({ skipCertVerify: checked === true })}
          />
          <FieldLabel htmlFor="manual-skip-cert">跳过证书验证</FieldLabel>
        </Field>
      )}
    </FieldGroup>
  )
}

function AddNodeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
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

function NodeDialog({ node, onClose, onSaved }: { node: NodeItem; onClose: () => void; onSaved: () => void }) {
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

function ProfilesPage() {
  const { data: profiles = [], error, loading, reload } = useApi<Profile[]>('/profiles')
  const { data: sources = [] } = useApi<Source[]>('/sources?includeSystem=1')
  const [adding, setAdding] = useState(false)
  async function remove(id: string) {
    if (!window.confirm('确定删除这个配置？')) return
    try {
      await api(`/profiles/${id}`, { method: 'DELETE' })
      await reload()
      toast.success('配置已删除')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '删除失败')
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>配置</h1>
          <p>{profiles.length}/20 个订阅配置</p>
        </div>
        <Button disabled={!sources.length} onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          新建
        </Button>
      </div>
      <PageState loading={loading} error={error} />
      <section className="profile-list">
        {profiles.length ? (
          profiles.map((profile) => (
            <article className="profile-row" key={profile.id}>
              <div className="profile-icon">
                <FileCode2 />
              </div>
              <div>
                <Link to="/profiles/$id" params={{ id: profile.id }}>
                  {profile.name}
                </Link>
                <p>
                  {profile.sourceIds.length} 个来源 · revision {profile.revision}
                </p>
              </div>
              <Status value={profile.error ? 'error' : profile.compiledAt ? 'ready' : 'idle'} />
              <time>{formatDate(profile.compiledAt)}</time>
              <IconButton label="删除" onClick={() => void remove(profile.id)}>
                <Trash2 />
              </IconButton>
            </article>
          ))
        ) : (
          <div className="empty-block">
            <FileCode2 />
            <strong>暂无配置</strong>
          </div>
        )}
      </section>
      {adding && (
        <ProfileDialog
          sources={sources}
          onClose={() => setAdding(false)}
          onSaved={async (jobId) => {
            setAdding(false)
            try {
              await waitForJob(jobId)
              toast.success('配置生成成功')
            } catch (reason) {
              toast.error(reason instanceof Error ? reason.message : '生成失败')
            }
            await reload()
          }}
        />
      )}
    </>
  )
}

const ruleLabels: Record<RuleModule, string> = { ads: '广告拦截', private: '私有网络直连', cn: '中国大陆直连' }
const protocols = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic']

function ProfileDialog({
  sources,
  profile,
  onClose,
  onSaved,
}: {
  sources: Source[]
  profile?: Profile
  onClose: () => void
  onSaved: (jobId: string) => void
}) {
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: {
      name: profile?.name || '',
      tags: profile?.tags.join(', ') || '',
      dnsMode: (profile?.dnsMode || 'fake-ip') as 'fake-ip' | 'redir-host',
      sourceIds: profile?.sourceIds || [],
      protocols: profile?.protocols || [],
      ruleModules: profile?.ruleModules || ['ads', 'private', 'cn'],
    },
    onSubmit: async ({ value }) => {
      setError('')
      try {
        const result = await api<{ jobId: string }>(profile ? `/profiles/${profile.id}` : '/profiles', {
          method: profile ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: value.name,
            sourceIds: value.sourceIds,
            protocols: value.protocols,
            tags: value.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            dnsMode: value.dnsMode,
            ruleModules: value.ruleModules,
            enabled: profile?.enabled ?? true,
          }),
        })
        onSaved(result.jobId)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '保存失败')
      }
    },
  })
  const sourceIds = useStore(form.store, (state) => state.values.sourceIds)
  const selectedProtocols = useStore(form.store, (state) => state.values.protocols)
  const rules = useStore(form.store, (state) => state.values.ruleModules)
  function toggle<T>(items: T[], item: T) {
    return items.includes(item) ? items.filter((value) => value !== item) : [...items, item]
  }
  function move(index: number, offset: number) {
    const next = [...rules]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    form.setFieldValue('ruleModules', next)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    await form.handleSubmit()
  }
  return (
    <AppDialog title={profile ? '编辑配置' : '新建配置'} onClose={onClose}>
      <form className="form profile-form" onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="profile-name">名称</FieldLabel>
            <form.Field name="name">
              {(field) => (
                <Input
                  id="profile-name"
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="例如：日常使用"
                />
              )}
            </form.Field>
          </Field>
          <FieldSet>
            <FieldLegend variant="label">节点源</FieldLegend>
            <div className="option-grid">
              {sources.map((source) => (
                <Field key={source.id} orientation="horizontal">
                  <Checkbox
                    id={`source-${source.id}`}
                    checked={sourceIds.includes(source.id)}
                    onCheckedChange={() => form.setFieldValue('sourceIds', toggle(sourceIds, source.id))}
                  />
                  <FieldLabel htmlFor={`source-${source.id}`}>{source.name}</FieldLabel>
                  <small>{source.nodeCount}</small>
                </Field>
              ))}
            </div>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">协议筛选</FieldLegend>
            <div className="option-grid protocols">
              {protocols.map((item) => (
                <Field key={item} orientation="horizontal">
                  <Checkbox
                    id={`protocol-${item}`}
                    checked={selectedProtocols.includes(item)}
                    onCheckedChange={() => form.setFieldValue('protocols', toggle(selectedProtocols, item))}
                  />
                  <FieldLabel htmlFor={`protocol-${item}`}>{item}</FieldLabel>
                </Field>
              ))}
            </div>
          </FieldSet>
          <Field>
            <FieldLabel htmlFor="profile-tags">标签筛选</FieldLabel>
            <form.Field name="tags">
              {(field) => (
                <Input
                  id="profile-tags"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="留空表示全部"
                />
              )}
            </form.Field>
          </Field>
          <FieldSet>
            <FieldLegend variant="label">DNS 模式</FieldLegend>
            <ToggleGroup
              type="single"
              variant="outline"
              value={form.getFieldValue('dnsMode')}
              onValueChange={(value) => value && form.setFieldValue('dnsMode', value as 'fake-ip' | 'redir-host')}
            >
              <ToggleGroupItem value="fake-ip">fake-ip</ToggleGroupItem>
              <ToggleGroupItem value="redir-host">redir-host</ToggleGroupItem>
            </ToggleGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">规则顺序</FieldLegend>
            <div className="rule-list">
              {rules.map((rule, index) => (
                <div key={rule}>
                  <span>{ruleLabels[rule]}</span>
                  <IconButton
                    label="上移"
                    disabled={index === 0}
                    onClick={() => {
                      move(index, -1)
                      form.setFieldValue('ruleModules', [
                        ...rules.slice(0, index - 1),
                        rule,
                        rules[index - 1],
                        ...rules.slice(index + 1),
                      ])
                    }}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label="下移"
                    disabled={index === rules.length - 1}
                    onClick={() => {
                      move(index, 1)
                      form.setFieldValue('ruleModules', [
                        ...rules.slice(0, index),
                        rules[index + 1],
                        rule,
                        ...rules.slice(index + 2),
                      ])
                    }}
                  >
                    <ArrowDown />
                  </IconButton>
                  <IconButton
                    label="移除"
                    onClick={() =>
                      form.setFieldValue(
                        'ruleModules',
                        rules.filter((item) => item !== rule),
                      )
                    }
                  >
                    <X />
                  </IconButton>
                </div>
              ))}
              {Object.keys(ruleLabels)
                .filter((rule) => !rules.includes(rule as RuleModule))
                .map((rule) => (
                  <Button
                    type="button"
                    variant="outline"
                    key={rule}
                    onClick={() => form.setFieldValue('ruleModules', [...rules, rule as RuleModule])}
                  >
                    <Plus data-icon="inline-start" />
                    {ruleLabels[rule as RuleModule]}
                  </Button>
                ))}
            </div>
          </FieldSet>
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
          <form.Subscribe selector={(state) => [state.isSubmitting, state.values.sourceIds]}>
            {([isSubmitting, currentSourceIds]) => (
              <Button disabled={Boolean(isSubmitting) || !(Array.isArray(currentSourceIds) && currentSourceIds.length)}>
                {isSubmitting && <RefreshCw data-icon="inline-start" className="spin" />}保存并生成
              </Button>
            )}
          </form.Subscribe>
        </footer>
      </form>
    </AppDialog>
  )
}

function ProfileDetailPage() {
  const { id } = profileDetailRoute.useParams()
  const navigate = useNavigate()
  const { data: profile, error, loading, reload } = useApi<Profile>(`/profiles/${id}`)
  const { data: sources = [] } = useApi<Source[]>('/sources?includeSystem=1')
  const [editing, setEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<'link' | 'preview'>('link')
  const [busy, setBusy] = useState(false)
  const [compileStatus, setCompileStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  async function run(operation: 'compile' | 'rotate') {
    if (operation === 'compile') {
      setCompileStatus('loading')
      try {
        const result = await api<{ jobId: string }>(`/profiles/${id}/compile`, { method: 'POST' })
        await waitForJob(result.jobId)
        setCompileStatus('success')
        toast.success('配置重新生成成功')
      } catch (reason) {
        setCompileStatus('error')
        toast.error(reason instanceof Error ? reason.message : '重新生成失败')
      } finally {
        setTimeout(() => setCompileStatus('idle'), 1500)
        await reload()
      }
      return
    }

    setBusy(true)
    try {
      await api(`/profiles/${id}/rotate-token`, { method: 'POST' })
      toast.success('订阅令牌已轮换')
      await reload()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="page-heading">
        <div className="title-with-back">
          <IconButton label="返回" onClick={() => navigate({ to: '/profiles' })}>
            <ArrowLeft />
          </IconButton>
          <div>
            <h1>{profile?.name || '配置详情'}</h1>
            <p>
              revision {profile?.revision || 0} · {formatDate(profile?.compiledAt || null)}
            </p>
          </div>
        </div>
        <div className="heading-actions">
          <Button variant="outline" disabled={compileStatus === 'loading' || busy} onClick={() => void run('compile')}>
            {compileStatus === 'loading' ? (
              <RefreshCw data-icon="inline-start" className="spin" />
            ) : compileStatus === 'success' ? (
              <Check data-icon="inline-start" className="text-emerald-600 dark:text-emerald-400" />
            ) : compileStatus === 'error' ? (
              <X data-icon="inline-start" className="text-destructive" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {compileStatus === 'loading'
              ? '正在生成'
              : compileStatus === 'success'
                ? '生成成功'
                : compileStatus === 'error'
                  ? '生成失败'
                  : '重新生成'}
          </Button>
          <Button onClick={() => setEditing(true)}>
            <Settings2 data-icon="inline-start" />
            编辑
          </Button>
        </div>
      </div>
      <PageState loading={loading} error={error} />
      {profile && (
        <>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'link' | 'preview')}>
            <TabsList variant="line">
              <TabsTrigger value="link">订阅链接</TabsTrigger>
              <TabsTrigger value="preview">配置预览</TabsTrigger>
            </TabsList>
            <TabsContent value="link" className="detail-section">
              <div className="field-title">
                <h2>订阅地址</h2>
                <Status value={profile.error ? 'error' : profile.compiledAt ? 'ready' : 'idle'} />
              </div>
              <div className="copy-field">
                <Input readOnly value={profile.subscriptionUrl} />
                <IconButton
                  label="复制"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(profile.subscriptionUrl)
                      .then(() => toast.success('订阅地址已复制'))
                  }
                >
                  <Clipboard />
                </IconButton>
              </div>
              {profile.error && (
                <Alert variant="destructive">
                  <AlertDescription>{profile.error}</AlertDescription>
                </Alert>
              )}
              <Button variant="destructive" disabled={busy} onClick={() => void run('rotate')}>
                <RotateCcwKey data-icon="inline-start" />
                轮换令牌
              </Button>
            </TabsContent>
            <TabsContent value="preview" className="yaml-panel">
              <pre>{profile.compiledYaml || '# 尚未生成配置'}</pre>
            </TabsContent>
          </Tabs>
          {editing && (
            <ProfileDialog
              sources={sources}
              profile={profile}
              onClose={() => setEditing(false)}
              onSaved={async (jobId) => {
                setEditing(false)
                setBusy(true)
                try {
                  await waitForJob(jobId)
                  toast.success('配置保存成功')
                } catch (reason) {
                  toast.error(reason instanceof Error ? reason.message : '生成失败')
                } finally {
                  setBusy(false)
                  await reload()
                }
              }}
            />
          )}
        </>
      )}
    </>
  )
}

function LoginPage() {
  const [initialized, setInitialized] = useState<boolean | null>(null)
  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    onSubmit: async ({ value }) => {
      const path = initialized ? '/auth/login' : '/auth/init'
      await api(path, {
        method: 'POST',
        body: JSON.stringify({
          password: value.password,
          ...(initialized ? {} : { confirmPassword: value.confirmPassword }),
        }),
      })
      window.location.href = '/admin'
    },
  })
  useEffect(() => {
    api<{ initialized: boolean }>('/auth/status')
      .then((result) => setInitialized(result.initialized))
      .catch(() => setInitialized(true))
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await form.handleSubmit()
    } catch (reason) {
      if (reason instanceof Error && reason.message === '管理员账号已初始化') setInitialized(true)
      toast.error(reason instanceof Error ? reason.message : '登录失败')
    }
  }
  return (
    <main className="auth-page">
      <form className="form auth-form" onSubmit={submit}>
        <h1>{initialized ? 'Wangwang 登录' : '设置管理员密码'}</h1>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="login-password">密码</FieldLabel>
            <form.Field name="password">
              {(field) => (
                <Input
                  id="login-password"
                  type="password"
                  required
                  minLength={initialized ? undefined : 12}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </Field>
          {!initialized && (
            <Field>
              <FieldLabel htmlFor="login-password-confirm">确认密码</FieldLabel>
              <form.Field name="confirmPassword">
                {(field) => (
                  <Input
                    id="login-password-confirm"
                    type="password"
                    required
                    minLength={12}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </form.Field>
            </Field>
          )}
        </FieldGroup>
        <form.Subscribe selector={(state) => [state.isSubmitting]}>
          {([isSubmitting]) => (
            <Button disabled={Boolean(isSubmitting) || initialized === null}>
              {initialized ? '登录' : '完成设置'}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </main>
  )
}

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: () => <Navigate to="/dashboard" replace />,
})
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: Layout })
const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: () => <Navigate to="/dashboard" replace />,
})
const dashboardRoute = createRoute({ getParentRoute: () => appRoute, path: '/dashboard', component: DashboardPage })
const sourcesRoute = createRoute({ getParentRoute: () => appRoute, path: '/sources', component: SourcesPage })
const nodesRoute = createRoute({ getParentRoute: () => appRoute, path: '/nodes', component: NodesPage })
const profilesRoute = createRoute({ getParentRoute: () => appRoute, path: '/profiles', component: ProfilesPage })
const profileDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/profiles/$id',
  component: ProfileDetailPage,
})
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage })
const routeTree = rootRoute.addChildren([
  appRoute.addChildren([indexRoute, dashboardRoute, sourcesRoute, nodesRoute, profilesRoute, profileDetailRoute]),
  loginRoute,
])
const router = createRouter({
  routeTree,
  basepath: window.location.pathname.startsWith('/admin') ? '/admin' : '/',
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <RouterProvider router={router} />
      <Toaster />
    </ThemeProvider>
  )
}
