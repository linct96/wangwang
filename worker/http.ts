import type { Context } from 'hono'
import type { z } from 'zod'

export type AppContext = Context<{ Bindings: Env }>

export function ok<T>(c: AppContext, data: T, status = 200) {
  return c.json({ data }, status as 200)
}

export function fail(
  c: AppContext,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status)
}

export async function body<T>(c: AppContext, schema: z.ZodType<T>) {
  let value: unknown
  try {
    value = await c.req.json()
  } catch {
    throw new Error('请求体必须是 JSON')
  }
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(result.error.issues[0]?.message || '请求参数无效')
  return result.data
}
