import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// 与现有 Worker 测试一致，使用 Node 24 原生 TS 和项目的无扩展名相对导入。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/worker/') && !specifier.endsWith('.ts'))
      specifier += '.ts'
    return nextResolve(specifier, context)
  },
})
const { assertRemoteUrl } = await import('../worker/security.ts')
const { fetchSource } = await import('../worker/tasks.ts')

for (const value of [
  'https://fc-example.com/sub?token=secret',
  'https://fd-example.com/sub',
  'https://FC-EXAMPLE.COM./sub',
  'https://localhost.example.com/sub',
  'https://example.com:8443/sub',
  'http://8.8.8.8/sub',
  'http://100.63.255.255/sub',
  'http://100.128.0.1/sub',
  'http://172.15.255.255/sub',
  'http://172.32.0.1/sub',
  'http://198.17.255.255/sub',
  'http://198.20.0.1/sub',
  'https://[2606:4700:4700::1111]/sub',
  'https://[::ffff:8.8.8.8]/sub',
]) {
  assert.equal(assertRemoteUrl(value).href, new URL(value).href, value)
}

for (const address of [
  '0.0.0.0',
  '0.1.2.3',
  '10.0.0.1',
  '100.64.0.1',
  '100.127.255.255',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '198.18.0.1',
  '198.19.255.255',
  '224.0.0.1',
  '255.255.255.255',
]) {
  for (const host of [address, `[::ffff:${address}]`]) {
    const value = `http://${host}/sub`
    assert.throws(() => assertRemoteUrl(value), /本地或私有地址/, value)
  }
}

for (const host of [
  'localhost',
  'LOCALHOST.',
  'api.localhost.',
  'device.local.',
  '127.1',
  '2130706433',
  '0x7f000001',
  '0177.0.0.1',
  '[::]',
  '[0:0:0:0:0:0:0:1]',
  '[::127.0.0.1]',
  '[0:0:0:0:0:ffff:7f00:1]',
  '[fe80::1]',
  '[fe90::1]',
  '[fea0::1]',
  '[febf:ffff::1]',
  '[fc00::1]',
  '[fdff:ffff::1]',
  '[ff02::1]',
]) {
  assert.throws(() => assertRemoteUrl(`http://${host}/sub`), /本地或私有地址/, host)
}
for (const value of ['not a url', 'http://999.0.0.1', 'http://[invalid]'])
  assert.throws(() => assertRemoteUrl(value), /URL 无效/, value)
for (const value of ['file:///etc/passwd', 'ftp://example.com/sub', 'https://user:pass@example.com/sub'])
  assert.throws(() => assertRemoteUrl(value), /仅允许 HTTP\/HTTPS/, value)

// 从实际下载入口确认：初始地址和每一跳重定向都在 fetch 前校验，不访问外网。
const originalFetch = globalThis.fetch
const requests = []
let location = '/next'
globalThis.fetch = async (url, options) => {
  requests.push(String(url))
  assert.equal(options.redirect, 'manual')
  return requests.length === 1
    ? new Response(null, { status: 302, headers: { Location: location } })
    : new Response('proxies: []', { headers: { 'Content-Type': 'text/yaml' } })
}
try {
  await assert.rejects(fetchSource('http://127.1/sub', 'test', null, null), /本地或私有地址/)
  assert.equal(requests.length, 0, '无效初始地址不能发起网络请求')
  for (const target of ['/next', 'https://fd-example.com/sub', 'https://[2606:4700:4700::1111]/sub']) {
    requests.length = 0
    location = target
    const result = await fetchSource('https://fc-example.com/sub', 'test', null, null)
    assert.equal(result.text, 'proxies: []')
    assert.deepEqual(requests, ['https://fc-example.com/sub', new URL(target, requests[0]).href])
  }
  for (const target of ['http://[::ffff:127.0.0.1]/sub', 'http://[fe90::1]/sub', 'http://localhost./sub']) {
    requests.length = 0
    location = target
    await assert.rejects(fetchSource('https://fc-example.com/sub', 'test', null, null), /本地或私有地址/)
    assert.deepEqual(requests, ['https://fc-example.com/sub'], '重定向到拒绝地址时不能继续 fetch')
  }
} finally {
  globalThis.fetch = originalFetch
}
console.log('订阅 URL 安全回归通过：普通域名、IPv4/IPv6 边界与变体、协议/凭据、下载及重定向校验。')
