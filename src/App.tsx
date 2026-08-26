import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Activity, ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, CircleGauge, Clipboard, Database, FileCode2, Menu, Network, Pencil, Plus, RefreshCw, RotateCcwKey, Search, Server, Settings2, Trash2, X } from 'lucide-react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import './App.css'

type Job = { id: string; type: 'refresh_source' | 'compile_profile'; entityId: string; status: 'pending' | 'running' | 'succeeded' | 'failed'; error: string | null; createdAt: string }
type Source = { id: string; name: string; kind: 'url' | 'manual'; url: string | null; refreshIntervalHours: number; enabled: boolean; status: 'idle' | 'refreshing' | 'ready' | 'error'; warning: string | null; error: string | null; nodeCount: number; lastRefreshedAt: string | null }
type NodeItem = { id: string; name: string; alias: string | null; protocol: string; server: string; port: number; tags: string[]; enabled: boolean; updatedAt: string }
type RuleModule = 'ads' | 'private' | 'cn'
type Profile = { id: string; name: string; enabled: boolean; protocols: string[]; tags: string[]; ruleModules: RuleModule[]; dnsMode: 'fake-ip' | 'redir-host'; revision: number; compiledYaml?: string | null; compiledAt: string | null; error: string | null; sourceIds: string[]; excludedNodeIds: string[]; subscriptionUrl: string }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/admin/api${path}`, { ...init, headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers })
  const payload = (await response.json()) as { data?: T; error?: { message: string } }
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || '请求失败')
  return payload.data
}

function useApi<T>(path: string) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!signal) setLoading(true)
    try {
      const response = await api<T>(path, { signal })
      if (!signal?.aborted) { setData(response); setError('') }
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '请求失败')
    } finally { if (!signal?.aborted) setLoading(false) }
  }, [path])
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])
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

function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-' }

function Status({ value }: { value: string }) {
  const labels: Record<string, string> = { idle: '待刷新', refreshing: '刷新中', ready: '正常', error: '异常', pending: '等待中', running: '执行中', succeeded: '已完成', failed: '失败' }
  return <span className={`status status-${value}`}>{labels[value] || value}</span>
}

function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button className="icon-button" type="button" title={label} aria-label={label} {...props}>{children}</button>
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><IconButton label="关闭" onClick={onClose}><X /></IconButton></header>{children}</section></div>
}

function PageState({ loading, error }: { loading: boolean; error: string }) {
  if (loading) return <div className="page-state"><RefreshCw className="spin" />加载中</div>
  if (error) return <div className="alert error">{error}</div>
  return null
}

const navigation = [{ to: '/', label: '概览', icon: CircleGauge }, { to: '/sources', label: '节点源', icon: Database }, { to: '/nodes', label: '节点', icon: Network }, { to: '/profiles', label: '配置', icon: FileCode2 }]

function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  return <div className="shell"><aside className={menuOpen ? 'sidebar open' : 'sidebar'}><div className="brand"><span>W</span><strong>Wangwang</strong></div><nav>{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenuOpen(false)}><Icon />{label}</NavLink>)}</nav><div className="sidebar-foot"><Activity />Cloudflare Worker</div></aside>{menuOpen && <button type="button" className="menu-mask" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><IconButton label="菜单" onClick={() => setMenuOpen(true)}><Menu /></IconButton><span>个人订阅管理</span></header><div className="content"><Routes><Route path="/" element={<DashboardPage />} /><Route path="/sources" element={<SourcesPage />} /><Route path="/nodes" element={<NodesPage />} /><Route path="/profiles" element={<ProfilesPage />} /><Route path="/profiles/:id" element={<ProfileDetailPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></div></main></div>
}

function DashboardPage() {
  const { data, error, loading } = useApi<{ sources: number; nodes: number; profiles: number; recentJobs: Job[] }>('/dashboard')
  return <><div className="page-heading"><div><h1>概览</h1><p>节点池与配置运行状态</p></div></div><PageState loading={loading} error={error} />{data && <><section className="metrics"><Link to="/sources"><Database /><span>节点源</span><strong>{data.sources}</strong></Link><Link to="/nodes"><Server /><span>全局节点</span><strong>{data.nodes}</strong></Link><Link to="/profiles"><FileCode2 /><span>配置</span><strong>{data.profiles}</strong></Link></section><section className="section"><div className="section-title"><h2>最近任务</h2></div><div className="table-wrap"><table><thead><tr><th>任务</th><th>状态</th><th>时间</th><th>结果</th></tr></thead><tbody>{data.recentJobs.length ? data.recentJobs.map((job) => <tr key={job.id}><td>{job.type === 'refresh_source' ? '刷新节点源' : '生成配置'}</td><td><Status value={job.status} /></td><td>{formatDate(job.createdAt)}</td><td className="muted">{job.error || '-'}</td></tr>) : <tr><td colSpan={4} className="empty">暂无任务</td></tr>}</tbody></table></div></section></>}</>
}

function SourcesPage() {
  const { data = [], error, loading, reload } = useApi<Source[]>('/sources')
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState('')
  async function action(id: string, operation: 'refresh' | 'toggle' | 'delete', enabled?: boolean) {
    if (operation === 'delete' && !window.confirm('确定删除这个节点源？')) return
    setBusy(id); setActionError('')
    try {
      if (operation === 'refresh') { const result = await api<{ jobId: string }>(`/sources/${id}/refresh`, { method: 'POST' }); await waitForJob(result.jobId) }
      else if (operation === 'toggle') await api(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
      else await api(`/sources/${id}`, { method: 'DELETE' })
      await reload()
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : '操作失败') } finally { setBusy('') }
  }
  return <><div className="page-heading"><div><h1>节点源</h1><p>{data.length}/20 个来源</p></div><button className="primary" onClick={() => setAdding(true)}><Plus />添加</button></div><PageState loading={loading} error={error} />{actionError && <div className="alert error">{actionError}</div>}<section className="section table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>节点</th><th>状态</th><th>上次刷新</th><th>周期</th><th className="actions">操作</th></tr></thead><tbody>{data.length ? data.map((source) => <tr key={source.id}><td><div className="cell-main">{source.name}</div><div className="cell-sub">{source.url || (source.kind === 'manual' ? '手动导入' : '-')}</div></td><td>{source.kind === 'url' ? 'URL' : '手动'}</td><td>{source.nodeCount}</td><td><Status value={busy === source.id ? 'refreshing' : source.status} /></td><td>{formatDate(source.lastRefreshedAt)}</td><td>{source.refreshIntervalHours ? `${source.refreshIntervalHours} 小时` : '关闭'}</td><td className="actions"><label className="switch" title={source.enabled ? '停用' : '启用'}><input type="checkbox" checked={source.enabled} onChange={(event) => void action(source.id, 'toggle', event.target.checked)} /><span /></label><IconButton label="刷新" disabled={busy === source.id} onClick={() => void action(source.id, 'refresh')}><RefreshCw className={busy === source.id ? 'spin' : ''} /></IconButton><IconButton label="删除" onClick={() => void action(source.id, 'delete')}><Trash2 /></IconButton></td></tr>) : <tr><td colSpan={7} className="empty">暂无节点源</td></tr>}</tbody></table></section>{adding && <SourceDialog onClose={() => setAdding(false)} onCreated={async (jobId) => { setAdding(false); setBusy('new'); try { await waitForJob(jobId) } catch (reason) { setActionError(reason instanceof Error ? reason.message : '导入失败') } finally { setBusy(''); await reload() } }} />}</>
}

function SourceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (jobId: string) => void }) {
  const [kind, setKind] = useState<'url' | 'manual'>('url'); const [name, setName] = useState(''); const [value, setValue] = useState(''); const [interval, setInterval] = useState(6); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { const result = await api<{ jobId: string }>('/sources', { method: 'POST', body: JSON.stringify({ name, kind, url: kind === 'url' ? value : undefined, content: kind === 'manual' ? value : undefined, refreshIntervalHours: interval }) }); onCreated(result.jobId) } catch (reason) { setError(reason instanceof Error ? reason.message : '创建失败'); setSaving(false) } }
  return <Dialog title="添加节点源" onClose={onClose}><form className="form" onSubmit={submit}><div className="segmented"><button type="button" className={kind === 'url' ? 'active' : ''} onClick={() => setKind('url')}>订阅 URL</button><button type="button" className={kind === 'manual' ? 'active' : ''} onClick={() => setKind('manual')}>文本 / 文件</button></div><label>名称<input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：主力订阅" /></label>{kind === 'url' ? <label>订阅地址<input required type="url" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://example.com/sub" /></label> : <label>节点内容<textarea required rows={9} value={value} onChange={(event) => setValue(event.target.value)} placeholder="粘贴 Mihomo YAML 或节点 URI" /><input className="file-input" type="file" accept=".yaml,.yml,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setValue) }} /></label>}{kind === 'url' && <label>刷新周期<select value={interval} onChange={(event) => setInterval(Number(event.target.value))}><option value={0}>关闭</option><option value={1}>1 小时</option><option value={6}>6 小时</option><option value={12}>12 小时</option><option value={24}>24 小时</option></select></label>}{error && <div className="alert error">{error}</div>}<footer><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving && <RefreshCw className="spin" />}导入</button></footer></form></Dialog>
}

function NodesPage() {
  const [query, setQuery] = useState(''); const [protocol, setProtocol] = useState(''); const [enabled, setEnabled] = useState(''); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useApi<{ items: NodeItem[]; total: number; page: number; pageSize: number }>(`/nodes?page=${page}&pageSize=50&q=${encodeURIComponent(query)}&protocol=${protocol}&enabled=${enabled}`)
  const [selected, setSelected] = useState<string[]>([]); const [editing, setEditing] = useState<NodeItem>(); const [actionError, setActionError] = useState(''); const pages = Math.max(1, Math.ceil((data?.total || 0) / 50))
  async function batch(value: boolean) { try { await api('/nodes/batch', { method: 'PATCH', body: JSON.stringify({ ids: selected, enabled: value }) }); setSelected([]); await reload() } catch (reason) { setActionError(reason instanceof Error ? reason.message : '操作失败') } }
  return <><div className="page-heading"><div><h1>节点</h1><p>{data?.total || 0}/2000 个节点</p></div></div><div className="toolbar"><label className="search"><Search /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="搜索名称或服务器" /></label><select value={protocol} onChange={(event) => { setProtocol(event.target.value); setPage(1) }}><option value="">全部协议</option>{['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic'].map((item) => <option key={item}>{item}</option>)}</select><select value={enabled} onChange={(event) => { setEnabled(event.target.value); setPage(1) }}><option value="">全部状态</option><option value="true">已启用</option><option value="false">已停用</option></select>{selected.length > 0 && <div className="batch-actions"><span>已选 {selected.length}</span><button className="secondary small" onClick={() => void batch(true)}>启用</button><button className="secondary small" onClick={() => void batch(false)}>停用</button></div>}</div><PageState loading={loading} error={error} />{actionError && <div className="alert error">{actionError}</div>}<section className="section table-wrap"><table><thead><tr><th className="checkbox"><input type="checkbox" aria-label="全选" checked={Boolean(data?.items.length) && selected.length === data?.items.length} onChange={(event) => setSelected(event.target.checked ? data?.items.map((item) => item.id) || [] : [])} /></th><th>节点</th><th>协议</th><th>服务器</th><th>标签</th><th>状态</th><th className="actions">操作</th></tr></thead><tbody>{data?.items.length ? data.items.map((node) => <tr key={node.id}><td className="checkbox"><input type="checkbox" aria-label={`选择 ${node.name}`} checked={selected.includes(node.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, node.id] : selected.filter((id) => id !== node.id))} /></td><td className="cell-main">{node.name}</td><td><code className="protocol">{node.protocol}</code></td><td>{node.server}:{node.port}</td><td><div className="tags">{node.tags.length ? node.tags.map((tag) => <span key={tag}>{tag}</span>) : <span className="muted">-</span>}</div></td><td><Status value={node.enabled ? 'ready' : 'idle'} /></td><td className="actions"><IconButton label="编辑" onClick={() => setEditing(node)}><Pencil /></IconButton></td></tr>) : <tr><td colSpan={7} className="empty">暂无节点</td></tr>}</tbody></table></section><div className="pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></button><span>{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight /></button></div>{editing && <NodeDialog node={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await reload() }} />}</>
}

function NodeDialog({ node, onClose, onSaved }: { node: NodeItem; onClose: () => void; onSaved: () => void }) {
  const [alias, setAlias] = useState(node.alias || ''); const [tags, setTags] = useState(node.tags.join(', ')); const [enabled, setEnabled] = useState(node.enabled); const [error, setError] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); try { await api(`/nodes/${node.id}`, { method: 'PATCH', body: JSON.stringify({ alias: alias || null, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), enabled }) }); onSaved() } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') } }
  return <Dialog title="编辑节点" onClose={onClose}><form className="form" onSubmit={submit}><label>显示名称<input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder={node.name} /></label><label>标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="香港, 高速" /></label><label className="check-row"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用节点</label>{error && <div className="alert error">{error}</div>}<footer><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary">保存</button></footer></form></Dialog>
}

function ProfilesPage() {
  const { data: profiles = [], error, loading, reload } = useApi<Profile[]>('/profiles'); const { data: sources = [] } = useApi<Source[]>('/sources'); const [adding, setAdding] = useState(false); const [actionError, setActionError] = useState('')
  async function remove(id: string) { if (!window.confirm('确定删除这个配置？')) return; try { await api(`/profiles/${id}`, { method: 'DELETE' }); await reload() } catch (reason) { setActionError(reason instanceof Error ? reason.message : '删除失败') } }
  return <><div className="page-heading"><div><h1>配置</h1><p>{profiles.length}/20 个订阅配置</p></div><button className="primary" disabled={!sources.length} onClick={() => setAdding(true)}><Plus />新建</button></div><PageState loading={loading} error={error} />{actionError && <div className="alert error">{actionError}</div>}<section className="profile-list">{profiles.length ? profiles.map((profile) => <article className="profile-row" key={profile.id}><div className="profile-icon"><FileCode2 /></div><div><Link to={`/profiles/${profile.id}`}>{profile.name}</Link><p>{profile.sourceIds.length} 个来源 · revision {profile.revision}</p></div><Status value={profile.error ? 'error' : profile.compiledAt ? 'ready' : 'idle'} /><time>{formatDate(profile.compiledAt)}</time><IconButton label="删除" onClick={() => void remove(profile.id)}><Trash2 /></IconButton></article>) : <div className="empty-block"><FileCode2 /><strong>暂无配置</strong></div>}</section>{adding && <ProfileDialog sources={sources} onClose={() => setAdding(false)} onSaved={async (jobId) => { setAdding(false); try { await waitForJob(jobId) } catch (reason) { setActionError(reason instanceof Error ? reason.message : '生成失败') } await reload() }} />}</>
}

const ruleLabels: Record<RuleModule, string> = { ads: '广告拦截', private: '私有网络直连', cn: '中国大陆直连' }
const protocols = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic']

function ProfileDialog({ sources, profile, onClose, onSaved }: { sources: Source[]; profile?: Profile; onClose: () => void; onSaved: (jobId: string) => void }) {
  const [name, setName] = useState(profile?.name || ''); const [sourceIds, setSourceIds] = useState(profile?.sourceIds || []); const [selectedProtocols, setSelectedProtocols] = useState(profile?.protocols || []); const [tags, setTags] = useState(profile?.tags.join(', ') || ''); const [dnsMode, setDnsMode] = useState<'fake-ip' | 'redir-host'>(profile?.dnsMode || 'fake-ip'); const [rules, setRules] = useState<RuleModule[]>(profile?.ruleModules || ['ads', 'private', 'cn']); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  function toggle<T>(items: T[], item: T) { return items.includes(item) ? items.filter((value) => value !== item) : [...items, item] }
  function move(index: number, offset: number) { const next = [...rules]; const target = index + offset; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setRules(next) }
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { const result = await api<{ jobId: string }>(profile ? `/profiles/${profile.id}` : '/profiles', { method: profile ? 'PATCH' : 'POST', body: JSON.stringify({ name, sourceIds, protocols: selectedProtocols, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), dnsMode, ruleModules: rules, enabled: profile?.enabled ?? true }) }); onSaved(result.jobId) } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); setSaving(false) } }
  return <Dialog title={profile ? '编辑配置' : '新建配置'} onClose={onClose}><form className="form profile-form" onSubmit={submit}><label>名称<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：日常使用" /></label><fieldset><legend>节点源</legend><div className="option-grid">{sources.map((source) => <label key={source.id} className="check-row"><input type="checkbox" checked={sourceIds.includes(source.id)} onChange={() => setSourceIds(toggle(sourceIds, source.id))} />{source.name}<small>{source.nodeCount}</small></label>)}</div></fieldset><fieldset><legend>协议筛选</legend><div className="option-grid protocols">{protocols.map((item) => <label key={item} className="check-row"><input type="checkbox" checked={selectedProtocols.includes(item)} onChange={() => setSelectedProtocols(toggle(selectedProtocols, item))} />{item}</label>)}</div></fieldset><label>标签筛选<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="留空表示全部" /></label><fieldset><legend>DNS 模式</legend><div className="segmented"><button type="button" className={dnsMode === 'fake-ip' ? 'active' : ''} onClick={() => setDnsMode('fake-ip')}>fake-ip</button><button type="button" className={dnsMode === 'redir-host' ? 'active' : ''} onClick={() => setDnsMode('redir-host')}>redir-host</button></div></fieldset><fieldset><legend>规则顺序</legend><div className="rule-list">{rules.map((rule, index) => <div key={rule}><span>{ruleLabels[rule]}</span><IconButton label="上移" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></IconButton><IconButton label="下移" disabled={index === rules.length - 1} onClick={() => move(index, 1)}><ArrowDown /></IconButton><IconButton label="移除" onClick={() => setRules(rules.filter((item) => item !== rule))}><X /></IconButton></div>)}{Object.keys(ruleLabels).filter((rule) => !rules.includes(rule as RuleModule)).map((rule) => <button type="button" className="add-rule" key={rule} onClick={() => setRules([...rules, rule as RuleModule])}><Plus />{ruleLabels[rule as RuleModule]}</button>)}</div></fieldset>{error && <div className="alert error">{error}</div>}<footer><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={saving || !sourceIds.length}>{saving && <RefreshCw className="spin" />}保存并生成</button></footer></form></Dialog>
}

function ProfileDetailPage() {
  const { id = '' } = useParams(); const navigate = useNavigate(); const { data: profile, error, loading, reload } = useApi<Profile>(`/profiles/${id}`); const { data: sources = [] } = useApi<Source[]>('/sources'); const [editing, setEditing] = useState(false); const [activeTab, setActiveTab] = useState<'link' | 'preview'>('link'); const [actionError, setActionError] = useState(''); const [busy, setBusy] = useState(false)
  async function run(operation: 'compile' | 'rotate') { setBusy(true); setActionError(''); try { if (operation === 'compile') { const result = await api<{ jobId: string }>(`/profiles/${id}/compile`, { method: 'POST' }); await waitForJob(result.jobId) } else await api(`/profiles/${id}/rotate-token`, { method: 'POST' }); await reload() } catch (reason) { setActionError(reason instanceof Error ? reason.message : '操作失败') } finally { setBusy(false) } }
  return <><div className="page-heading"><div className="title-with-back"><IconButton label="返回" onClick={() => navigate('/profiles')}><ArrowLeft /></IconButton><div><h1>{profile?.name || '配置详情'}</h1><p>revision {profile?.revision || 0} · {formatDate(profile?.compiledAt || null)}</p></div></div><div className="heading-actions"><button className="secondary" disabled={busy} onClick={() => void run('compile')}><RefreshCw className={busy ? 'spin' : ''} />重新生成</button><button className="primary" onClick={() => setEditing(true)}><Settings2 />编辑</button></div></div><PageState loading={loading} error={error} />{actionError && <div className="alert error">{actionError}</div>}{profile && <><div className="tabs"><button className={activeTab === 'link' ? 'active' : ''} onClick={() => setActiveTab('link')}>订阅链接</button><button className={activeTab === 'preview' ? 'active' : ''} onClick={() => setActiveTab('preview')}>配置预览</button></div>{activeTab === 'link' ? <section className="detail-section"><div className="field-title"><h2>订阅地址</h2><Status value={profile.error ? 'error' : profile.compiledAt ? 'ready' : 'idle'} /></div><div className="copy-field"><input readOnly value={profile.subscriptionUrl} /><IconButton label="复制" onClick={() => void navigator.clipboard.writeText(profile.subscriptionUrl)}><Clipboard /></IconButton></div>{profile.error && <div className="alert error">{profile.error}</div>}<button className="danger-link" disabled={busy} onClick={() => void run('rotate')}><RotateCcwKey />轮换令牌</button></section> : <section className="yaml-panel"><pre>{profile.compiledYaml || '# 尚未生成配置'}</pre></section>}{editing && <ProfileDialog sources={sources} profile={profile} onClose={() => setEditing(false)} onSaved={async (jobId) => { setEditing(false); setBusy(true); try { await waitForJob(jobId) } catch (reason) { setActionError(reason instanceof Error ? reason.message : '生成失败') } finally { setBusy(false); await reload() } }} />}</>}</>
}

export default function App() { return <BrowserRouter basename="/admin"><Layout /></BrowserRouter> }
