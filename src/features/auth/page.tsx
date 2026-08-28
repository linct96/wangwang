import { useState } from 'react'
import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { PasswordInput } from '@/components/ui/password-input'

export function LoginPage({ initialized, onAuthenticated }: { initialized: boolean; onAuthenticated: () => void }) {
  const [loginMode, setLoginMode] = useState(initialized)
  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    onSubmit: async ({ value }) => {
      const path = loginMode ? '/auth/login' : '/auth/init'
      await api(path, {
        method: 'POST',
        body: JSON.stringify({
          password: value.password,
          ...(loginMode ? {} : { confirmPassword: value.confirmPassword }),
        }),
      })
      onAuthenticated()
    },
  })
  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await form.handleSubmit()
    } catch (reason) {
      if (reason instanceof Error && reason.message === '管理员账号已初始化') setLoginMode(true)
      toast.error(reason instanceof Error ? reason.message : '登录失败')
    }
  }
  return (
    <main className="auth-page auth-login-page">
      <form className="form auth-form" onSubmit={submit}>
        <h1>{loginMode ? 'Wangwang 登录' : '设置管理员密码'}</h1>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="login-password">密码</FieldLabel>
            <form.Field name="password">
              {(field) => (
                <PasswordInput
                  id="login-password"
                  required
                  minLength={loginMode ? undefined : 12}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </Field>
          {!loginMode && (
            <Field>
              <FieldLabel htmlFor="login-password-confirm">确认密码</FieldLabel>
              <form.Field name="confirmPassword">
                {(field) => (
                  <PasswordInput
                    id="login-password-confirm"
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
          {([isSubmitting]) => <Button disabled={Boolean(isSubmitting)}>{loginMode ? '登录' : '设置并登录'}</Button>}
        </form.Subscribe>
      </form>
    </main>
  )
}
