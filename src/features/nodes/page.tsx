import { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useApi } from '@/api/use-api'
import type { NodeItem, TagOption } from '@/api/types'
import { AppConfirmDialog, IconButton, PageState, Status } from '@/components/app-primitives'
import { AddNodeDialog, NodeDialog } from './node-dialogs'
import '@/styles/nodes.css'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function NodesPage() {
  const [protocol, setProtocol] = useState('')
  const [enabled, setEnabled] = useState('')
  const [tagId, setTagId] = useState('')
  const [page, setPage] = useState(1)
  const { data: tagOptions = [], reload: reloadTags } = useApi<TagOption[]>('/tags')
  const { data, error, loading, reload } = useApi<{ items: NodeItem[]; total: number; page: number; pageSize: number }>(
    `/nodes?page=${page}&pageSize=50&protocol=${protocol}&enabled=${enabled}&tagId=${tagId}`,
  )
  const [selected, setSelected] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<NodeItem>()
  const [deleting, setDeleting] = useState<NodeItem>()
  const [deletingBusy, setDeletingBusy] = useState(false)
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
  async function remove() {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await api(`/nodes/${deleting.id}`, { method: 'DELETE' })
      setDeleting(undefined)
      await Promise.all([reload(), reloadTags()])
      toast.success('手动节点已删除')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '删除失败')
    } finally {
      setDeletingBusy(false)
    }
  }
  function copyUrl(node: NodeItem) {
    if (!node.url) return
    void navigator.clipboard.writeText(node.url).then(
      () => toast.success('节点链接已复制'),
      () => toast.error('复制失败'),
    )
  }
  return (
    <div className="nodes-page">
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
        <Select
          value={tagId || 'all'}
          onValueChange={(value) => {
            setTagId(value === 'all' ? '' : value)
            setPage(1)
            setSelected([])
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部标签</SelectItem>
              {tagOptions.map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={protocol || 'all'}
          onValueChange={(value) => {
            setProtocol(value === 'all' ? '' : value)
            setPage(1)
            setSelected([])
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
            setSelected([])
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
      {error && <PageState loading={false} error={error} />}
      <section className="section table-wrap" aria-busy={loading}>
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
            {loading && !data ? (
              Array.from({ length: 8 }, (_, index) => (
                <TableRow key={index} aria-hidden="true">
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : data?.items.length ? (
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
                    {node.url && (
                      <IconButton label="复制链接" onClick={() => copyUrl(node)}>
                        <Copy />
                      </IconButton>
                    )}
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
            await Promise.all([reload(), reloadTags()])
            toast.success('节点保存成功')
          }}
        />
      )}
      {adding && (
        <AddNodeDialog
          onClose={() => setAdding(false)}
          onSaved={async (result) => {
            setAdding(false)
            await Promise.all([reload(), reloadTags()])
            if (!result) {
              toast.success('节点添加成功，相关配置正在更新')
              return
            }
            const summary = result.created
              ? `已导入 ${result.created} 个节点${result.skipped ? `，跳过 ${result.skipped} 个节点` : ''}`
              : `未导入新节点，跳过 ${result.skipped} 个节点`
            toast.success(summary)
            if (result.warnings.length)
              toast.warning(`有 ${result.warnings.length} 行未导入`, {
                description: result.warnings.slice(0, 3).join('；'),
              })
          }}
        />
      )}
      {deleting && (
        <AppConfirmDialog
          title="删除手动节点"
          description={`删除“${deleting.name}”后，引用“手动节点”的配置会自动重新生成。订阅来源仍持有的相同节点不会被删除。`}
          confirmLabel="删除"
          busy={deletingBusy}
          onClose={() => setDeleting(undefined)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  )
}
