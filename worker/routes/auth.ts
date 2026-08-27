import { Hono } from 'hono'
import { z } from 'zod'
import { body, fail } from '../http'
import type { AppContext } from '../http'
import { hashPassword, newSessionToken, SESSION_TTL, sessionHash, verifyPassword } from '../security'

export async function hasAdmin(env: Env) {
  return Boolean(await env.DB.prepare('SELECT id FROM admin_account WHERE id = 1').first())
}

export async function authenticated(c: AppContext) {
  const token = c.req.header('Cookie')?.match(/(?:^|;\s*)ww_session=([^;]+)/)?.[1]
  if (!token) return false
  const hash = await sessionHash(token)
  const row = await c.env.DB.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(hash, Date.now())
    .first()
  return Boolean(row)
}

export const authRouter = new Hono<{ Bindings: Env }>()

authRouter.post('/login', async (c) => {
  const input = await body(c, z.object({ password: z.string().min(1) }))
  const account = await c.env.DB.prepare('SELECT password_hash,password_salt FROM admin_account WHERE id = 1').first<{
    password_hash: string
    password_salt: string
  }>()
  if (!account || !(await verifyPassword(input.password, account.password_salt, account.password_hash)))
    return fail(c, 401, 'LOGIN_FAILED', '密码错误')
  const token = newSessionToken()
  await c.env.DB.prepare('INSERT INTO admin_sessions (token_hash,expires_at,created_at) VALUES (?,?,?)')
    .bind(await sessionHash(token), Date.now() + SESSION_TTL, Date.now())
    .run()
  return c.json({ data: { ok: true } }, 200, {
    'Set-Cookie': `ww_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`,
  })
})

authRouter.get('/status', async (c) => c.json({ data: { initialized: await hasAdmin(c.env) } }))

authRouter.post('/init', async (c) => {
  if (await hasAdmin(c.env)) return fail(c, 409, 'ALREADY_INITIALIZED', '管理员账号已初始化')
  const input = await body(c, z.object({ password: z.string().min(12), confirmPassword: z.string() }))
  if (input.password !== input.confirmPassword) return fail(c, 422, 'PASSWORD_MISMATCH', '两次密码输入不一致')
  const { hash, salt } = await hashPassword(input.password)
  try {
    await c.env.DB.prepare(
      'INSERT INTO admin_account (id,email,password_hash,password_salt,created_at) VALUES (1,?,?,?,?)',
    )
      .bind('', hash, salt, Date.now())
      .run()
  } catch {
    return fail(c, 409, 'ALREADY_INITIALIZED', '管理员账号已初始化')
  }
  const token = newSessionToken()
  await c.env.DB.prepare('INSERT INTO admin_sessions (token_hash,expires_at,created_at) VALUES (?,?,?)')
    .bind(await sessionHash(token), Date.now() + SESSION_TTL, Date.now())
    .run()
  return c.json({ data: { ok: true } }, 200, {
    'Set-Cookie': `ww_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`,
  })
})

authRouter.post('/logout', async (c) => {
  const token = c.req.header('Cookie')?.match(/(?:^|;\s*)ww_session=([^;]+)/)?.[1]
  if (token)
    await c.env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
      .bind(await sessionHash(token))
      .run()
  return c.json({ data: { ok: true } }, 200, {
    'Set-Cookie': 'ww_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  })
})
