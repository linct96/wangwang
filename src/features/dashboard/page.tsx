import { Link } from '@tanstack/react-router'
import { Database, FileCode2, Server } from 'lucide-react'
import { useApi } from '@/api/use-api'
import type { Job } from '@/api/types'
import { Status, PageState } from '@/components/app-primitives'
import { formatDate } from '@/lib/format'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function DashboardPage() {
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
