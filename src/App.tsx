import { useEffect, useState } from 'react'
import { ThemeProvider } from 'next-themes'
import { RouterProvider } from '@tanstack/react-router'
import { api } from '@/api/client'
import type { AuthStatus } from '@/api/types'
import { router } from '@/app/router'
import { LoginPage } from '@/features/auth/page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'

let authStatusRequest: Promise<AuthStatus> | undefined

function loadAuthStatus() {
  authStatusRequest ??= api<AuthStatus>('/auth/status').catch((error) => {
    authStatusRequest = undefined
    throw error
  })
  return authStatusRequest
}

function AuthLoading({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <main className="auth-page">
      <div className="form auth-form" aria-busy={!error}>
        {error ? (
          <>
            <h1>Wangwang</h1>
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button type="button" onClick={onRetry}>
              重试
            </Button>
          </>
        ) : (
          <>
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </>
        )}
      </div>
    </main>
  )
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus>()
  const [authError, setAuthError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setAuthError('')
    void loadAuthStatus()
      .then((status) => active && setAuth(status))
      .catch((reason) => active && setAuthError(reason instanceof Error ? reason.message : '认证状态检查失败'))
    return () => {
      active = false
    }
  }, [attempt])

  function authenticated() {
    const status = { initialized: true, authenticated: true }
    authStatusRequest = Promise.resolve(status)
    setAuth(status)
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {!auth ? (
        <AuthLoading error={authError} onRetry={() => setAttempt((value) => value + 1)} />
      ) : auth.authenticated ? (
        <RouterProvider router={router} />
      ) : (
        <LoginPage initialized={auth.initialized} onAuthenticated={authenticated} />
      )}
      <Toaster />
    </ThemeProvider>
  )
}
