import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Check, Clipboard, RefreshCw, RotateCcwKey, Settings2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type { Profile, Source } from '@/api/types'
import { IconButton, PageState, Status } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/format'
import { ProfileDialog } from './profile-dialog'

export function ProfileDetailPage() {
  const { id } = useParams({ from: '/app/profiles/$id' })
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
