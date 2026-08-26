const API = 'https://api.cloudflare.com/client/v4'

type Envelope<T> = { success: boolean; result: T; errors?: Array<{ message?: string }> }
export type Account = { id: string; name: string }
export type Resources = { accountId: string; database: { name: string; id: string }; kv: { title: string; id: string }; queue: { name: string; id?: string } }

async function request<T>(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } })
  const payload = await response.json() as Envelope<T>
  if (!response.ok || !payload.success) throw new Error(payload.errors?.[0]?.message || `Cloudflare API HTTP ${response.status}`)
  return payload.result
}

export function listAccounts(token: string) { return request<Account[]>(token, '/accounts?per_page=50') }

export async function createResources(token: string, accountId: string, projectName: string): Promise<Resources> {
  const safe = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'wangwang'
  const database = await request<{ uuid: string; name: string }>(token, `/accounts/${accountId}/d1/database`, { method: 'POST', body: JSON.stringify({ name: `${safe}-db` }) })
  const kv = await request<{ id: string; title: string }>(token, `/accounts/${accountId}/storage/kv/namespaces`, { method: 'POST', body: JSON.stringify({ title: `${safe}-config-cache` }) })
  const queue = await request<{ queue_id?: string; queue_name?: string }>(token, `/accounts/${accountId}/queues`, { method: 'POST', body: JSON.stringify({ queue_name: `${safe}-jobs` }) })
  return { accountId, database: { name: database.name, id: database.uuid }, kv: { title: kv.title, id: kv.id }, queue: { name: queue.queue_name || `${safe}-jobs`, id: queue.queue_id } }
}

export function wranglerConfig(resources: Resources) {
  return JSON.stringify({ d1_databases: [{ binding: 'DB', database_name: resources.database.name, database_id: resources.database.id }], kv_namespaces: [{ binding: 'CONFIG_CACHE', id: resources.kv.id }], queues: { producers: [{ binding: 'JOBS', queue: resources.queue.name }], consumers: [{ queue: resources.queue.name }] } }, null, 2)
}
