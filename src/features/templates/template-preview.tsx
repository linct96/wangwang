import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '@/api/client'
import type { Profile, TemplateId, TemplatePreview as PreviewResult, TemplateSourceSlot } from '@/api/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function TemplatePreview({
  templateId,
  yaml,
  getYaml,
  profiles,
  sourceSlots,
  auto = false,
}: {
  templateId?: TemplateId
  yaml?: string
  getYaml?: () => string
  profiles: Profile[]
  sourceSlots?: TemplateSourceSlot[]
  auto?: boolean
}) {
  const [profileId, setProfileId] = useState('sample')
  const [preview, setPreview] = useState<PreviewResult>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function load(signal?: AbortSignal) {
    setLoading(true)
    setError('')
    try {
      const currentYaml = getYaml?.() ?? yaml
      const result = await api<PreviewResult>('/templates/preview', {
        method: 'POST',
        body: JSON.stringify({
          templateId,
          yaml: currentYaml,
          sourceSlots: currentYaml ? sourceSlots : undefined,
          profileId: profileId === 'sample' ? undefined : profileId,
        }),
        signal,
      })
      if (!signal?.aborted) setPreview(result)
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '预览生成失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!auto) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
    // auto 预览只在弹窗首次挂载时生成。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  return (
    <div className="template-preview">
      <div className="template-preview-toolbar">
        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger aria-label="预览节点来源">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="sample">示例节点</SelectItem>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw data-icon="inline-start" className={loading ? 'spin' : undefined} />
          生成预览
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <pre>{preview?.yaml || (loading ? '# 正在生成配置' : '# 点击生成预览')}</pre>
      {preview && <small>{preview.nodeCount} 个节点</small>}
    </div>
  )
}
