import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog as DialogRoot, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

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

export function AppDialog({
  title,
  children,
  onClose,
  contentClassName,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  contentClassName?: string
}) {
  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn('max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl', contentClassName)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </DialogRoot>
  )
}

export function AppConfirmDialog({
  title,
  description,
  children,
  confirmLabel = '确认',
  busy = false,
  onClose,
  onConfirm,
}: {
  title: string
  description: ReactNode
  children?: ReactNode
  confirmLabel?: string
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
