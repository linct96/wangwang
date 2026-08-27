import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export function LoginPage() {
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
