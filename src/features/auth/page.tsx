import { useState } from 'react'
import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { PasswordInput } from '@/components/ui/password-input'

export function LoginPage({ initialized, onAuthenticated }: { initialized: boolean; onAuthenticated: () => void }) {
  const [loginMode, setLoginMode] = useState(initialized)
  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    validators: {
      onSubmit: z
        .object({
          password: loginMode ? z.string().min(1, '请输入密码') : z.string().min(12, '密码至少需要 12 个字符'),
          confirmPassword: z.string(),
        })
        .refine(({ password, confirmPassword }) => loginMode || password === confirmPassword, {
          message: '两次密码输入不一致',
          path: ['confirmPassword'],
        }),
    },
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
      <form className="form auth-form" onSubmit={submit} noValidate>
        <h1>{loginMode ? 'Wangwang 登录' : '设置管理员密码'}</h1>
        <FieldGroup>
          <form.Field name="password">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="login-password">密码</FieldLabel>
                  <PasswordInput
                    id="login-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          {!loginMode && (
            <form.Field name="confirmPassword">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="login-password-confirm">确认密码</FieldLabel>
                    <PasswordInput
                      id="login-password-confirm"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
          )}
        </FieldGroup>
        <form.Subscribe selector={(state) => [state.isSubmitting]}>
          {([isSubmitting]) => <Button disabled={Boolean(isSubmitting)}>{loginMode ? '登录' : '设置并登录'}</Button>}
        </form.Subscribe>
      </form>
    </main>
  )
}
