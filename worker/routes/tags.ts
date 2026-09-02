import { Hono } from 'hono'
import { ok } from '../http'
import { listTags } from '../tag-store'

export const tagsRouter = new Hono<{ Bindings: Env }>()

tagsRouter.get('/', async (c) => ok(c, await listTags(c.env)))
