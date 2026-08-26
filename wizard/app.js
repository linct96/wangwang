const API = 'https://api.cloudflare.com/client/v4'
const $ = (id) => document.getElementById(id)
const token = $('token'); const error = $('error'); const resourcePanel = $('resource-panel'); const resultPanel = $('result'); let config = ''

async function request(path, init = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token.value.trim()}`, 'Content-Type': 'application/json', ...init.headers } })
  const payload = await response.json()
  if (!response.ok || !payload.success) throw new Error(payload.errors?.[0]?.message || `Cloudflare API HTTP ${response.status}`)
  return payload.result
}

function showError(reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); error.classList.remove('hidden') }
function busy(button, value) { button.disabled = value; button.textContent = value ? '处理中...' : button.dataset.label }

$('accounts').dataset.label = '查询账户'; $('provision').dataset.label = '创建 D1 / KV / Queue'
$('accounts').onclick = async () => { const button = $('accounts'); error.classList.add('hidden'); busy(button, true); try { const accounts = await request('/accounts?per_page=50'); if (!accounts.length) throw new Error('Token 没有可用的 Cloudflare Account'); $('account').innerHTML = accounts.map((item) => `<option value="${item.id}">${item.name} · ${item.id}</option>`).join(''); resourcePanel.classList.remove('hidden') } catch (reason) { showError(reason) } finally { busy(button, false) } }
$('provision').onclick = async () => { const button = $('provision'); error.classList.add('hidden'); busy(button, true); try { const name = ($('name').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'wangwang'); const accountId = $('account').value; const db = await request(`/accounts/${accountId}/d1/database`, { method: 'POST', body: JSON.stringify({ name: `${name}-db` }) }); const kv = await request(`/accounts/${accountId}/storage/kv/namespaces`, { method: 'POST', body: JSON.stringify({ title: `${name}-config-cache` }) }); const queue = await request(`/accounts/${accountId}/queues`, { method: 'POST', body: JSON.stringify({ queue_name: `${name}-jobs` }) }); config = JSON.stringify({ d1_databases: [{ binding: 'DB', database_name: db.name, database_id: db.uuid }], kv_namespaces: [{ binding: 'CONFIG_CACHE', id: kv.id }], queues: { producers: [{ binding: 'JOBS', queue: queue.queue_name || `${name}-jobs` }], consumers: [{ queue: queue.queue_name || `${name}-jobs` }] } }, null, 2); $('output').textContent = config; resultPanel.classList.remove('hidden'); token.value = '' } catch (reason) { showError(reason) } finally { busy(button, false) } }
$('copy').onclick = async () => { await navigator.clipboard.writeText(config); $('copy').textContent = '已复制' }
$('download').onclick = () => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([config], { type: 'application/json' })); link.download = 'wrangler.resources.json'; link.click() }
