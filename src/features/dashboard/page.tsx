import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Database, FileCode2, Server } from 'lucide-react'
import { useApi } from '@/api/use-api'
import type { Job } from '@/api/types'
import { Status, PageState } from '@/components/app-primitives'
import { formatDate } from '@/lib/format'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import '@/styles/dashboard.css'

export function DashboardPage() {
  const { data, error, loading } = useApi<{ sources: number; nodes: number; profiles: number; recentJobs: Job[] }>(
    '/dashboard',
  )
  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <div>
          <h1>概览</h1>
          <p>资源与任务运行情况</p>
        </div>
      </div>
      <PageState loading={loading} error={error} />
      {data && (
        <div className="dashboard-grid">
          <section className="section metrics-panel" aria-labelledby="metrics-heading">
            <div className="section-title">
              <h2 id="metrics-heading">资源概览</h2>
              <span>点击进入管理</span>
            </div>
            <div className="metrics">
              <Link to="/sources">
                <span className="metric-icon">
                  <Database aria-hidden="true" />
                </span>
                <span className="metric-copy">
                  <span>节点源</span>
                  <strong>{data.sources.toLocaleString()}</strong>
                </span>
                <ArrowUpRight className="metric-arrow" aria-hidden="true" />
              </Link>
              <Link to="/nodes">
                <span className="metric-icon">
                  <Server aria-hidden="true" />
                </span>
                <span className="metric-copy">
                  <span>全局节点</span>
                  <strong>{data.nodes.toLocaleString()}</strong>
                </span>
                <ArrowUpRight className="metric-arrow" aria-hidden="true" />
              </Link>
              <Link to="/profiles">
                <span className="metric-icon">
                  <FileCode2 aria-hidden="true" />
                </span>
                <span className="metric-copy">
                  <span>配置</span>
                  <strong>{data.profiles.toLocaleString()}</strong>
                </span>
                <ArrowUpRight className="metric-arrow" aria-hidden="true" />
              </Link>
            </div>
          </section>
          <section className="section dashboard-jobs" aria-labelledby="jobs-heading">
            <div className="section-title">
              <h2 id="jobs-heading">最近任务</h2>
              <span>{data.recentJobs.length} 条记录</span>
            </div>
            <Table className="dashboard-table">
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
                      <TableCell className="muted result-cell" title={job.error || undefined}>
                        {job.error || '—'}
                      </TableCell>
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
          </section>
        </div>
      )}
    </div>
  )
}
