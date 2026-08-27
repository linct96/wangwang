import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog as DialogRoot, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function Status({ value }: { value: string }) {
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

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon" type="button" title={label} aria-label={label} {...props}>
      {children}
    </Button>
  )
}

export function AppDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
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

export function PageState({ loading, error }: { loading: boolean; error: string }) {
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
