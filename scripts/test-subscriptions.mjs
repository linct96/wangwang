import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

// Node 24 原生执行 Worker TS；仅补齐项目使用的无扩展名相对导入。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/worker/') && !specifier.endsWith('.ts'))
      specifier += '.ts'
    return nextResolve(specifier, context)
  },
})

const { app } = await import('../worker/app.ts')
const { subscriptionToken, subscriptionTokenHash, sessionHash } = await import('../worker/security.ts')
const { compileProfile } = await import('../worker/tasks.ts')
const sqlite = new DatabaseSync(':memory:')
let queries = []
let signs = 0
let beforeQuery = () => {}
const originalSign = crypto.subtle.sign.bind(crypto.subtle)
crypto.subtle.sign = (...args) => {
  signs++
  return originalSign(...args)
}

// 离线 SQLite 适配 D1 的查询接口，记录实际执行的 SQL 和返回行数。
const DB = {
  prepare(sql) {
    let params = []
    const execute = (method, arrays = false) => {
      beforeQuery(sql, params)
      const statement = sqlite.prepare(sql)
      statement.setReturnArrays(arrays)
      const result = statement[method](...params)
      queries.push({ sql, params, rows: Array.isArray(result) ? result.length : 0 })
      return result
    }
    return {
      bind(...values) {
        params = values
        return this
      },
      async raw() {
        return execute('all', true)
      },
      async all() {
        return { success: true, results: execute('all') }
      },
      async first(column) {
        const row = execute('get')
        return (column ? row?.[column] : row) ?? null
      },
      async run() {
        return { success: true, meta: { changes: execute('run').changes }, results: [] }
      },
    }
  },
  batch(statements) {
    // 仅适配既有 batch 调用，不模拟 D1 事务和网络行为。
    return Promise.all(statements.map((statement) => statement.all()))
  },
}
const env = {
  DB,
  SUBSCRIPTION_TOKEN_SECRET: 'offline-test-secret',
  JOBS: { async send() {} },
  KV: {
    get() {
      assert.fail('订阅请求不应读取冗余 YAML 缓存')
    },
    put() {
      assert.fail('编译不应写入冗余 YAML 缓存')
    },
  },
}
const origin = 'https://subscriptions.test'
const cookie = 'ww_session=offline-admin'
async function admin(path, method = 'GET', body) {
  return app.fetch(
    new Request(`${origin}/api/profiles${path}`, {
      method,
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  )
}
async function subscription(token, status, expectedSigns, expectedQueries = 1) {
  queries = []
  signs = 0
  const response = await app.fetch(new Request(`${origin}/s/${token}/config.yaml`), env)
  assert.equal(response.status, status, await response.clone().text())
  assert.equal(signs, expectedSigns, '每次订阅最多一次 HMAC')
  assert.equal(queries.length, expectedQueries, '订阅不能扫描、回填或查询其他表')
  for (const query of queries) {
    assert.match(query.sql, /where \("profiles"\."subscription_token_hash" = \? and "profiles"\."enabled" = \?\)/)
    assert.ok(query.rows <= 1, '最多读取一份配置')
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params)
    assert.match(plan.map((row) => row.detail).join('\n'), /USING INDEX profiles_subscription_token_hash_idx/)
  }
  return response
}
function fixture(id, enabled = 1) {
  sqlite
    .prepare(
      'INSERT INTO profiles (id,name,enabled,token_version,compiled_yaml,created_at,updated_at) VALUES (?,?,?,4,?,1,1)',
    )
    .run(id, `${id} 配置`, enabled, `proxies: [] # ${id}`)
  sqlite.prepare("INSERT INTO profile_node_binding (profile_id,mode) VALUES (?,'tag')").run(id)
}
function row(id) {
  return sqlite.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
}

try {
  const migrationsDir = new URL('../drizzle/', import.meta.url)
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  for (const file of migrations) {
    if (file === '0003_subscription_token_index.sql') {
      fixture('legacy')
      fixture('disabled', 0)
    }
    sqlite.exec(readFileSync(new URL(file, migrationsDir), 'utf8'))
  }
  assert.equal(row('legacy').subscription_token_hash, null, '迁移保留已有数据')
  sqlite
    .prepare('INSERT INTO admin_sessions VALUES (?,?,?)')
    .run(await sessionHash('offline-admin'), Date.now() + 60_000, Date.now())
  const oldToken = await subscriptionToken(env.SUBSCRIPTION_TOKEN_SECRET, 'legacy', 4)

  // 无效格式零查询；未回填/不存在的 token 不回退全表扫描。
  await subscription('bad', 404, 0, 0)
  await subscription('A'.repeat(22), 404, 0)
  await subscription(oldToken, 404, 0)
  assert.equal(
    (await app.fetch(new Request(`${origin}/api/profiles/reindex-tokens`, { method: 'POST' }), env)).status,
    401,
  )
  assert.equal(
    (
      await app.fetch(
        new Request(`${origin}/api/profiles/reindex-tokens`, {
          method: 'POST',
          headers: { Cookie: cookie, Origin: 'https://other.test' },
        }),
        env,
      )
    ).status,
    403,
  )

  const reindexed = await admin('/reindex-tokens', 'POST')
  assert.equal(reindexed.status, 200)
  assert.equal((await reindexed.json()).data.count, 2)
  assert.equal(row('legacy').subscription_token_hash, await subscriptionTokenHash(oldToken))
  const response = await subscription(oldToken, 200, 1)
  assert.equal(await response.text(), row('legacy').compiled_yaml)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Content-Type'), 'text/yaml; charset=utf-8')
  assert.match(response.headers.get('Content-Disposition'), /filename\*=UTF-8''legacy%20/)
  await subscription(await subscriptionToken(env.SUBSCRIPTION_TOKEN_SECRET, 'disabled', 4), 404, 0)
  queries = []
  await admin('/reindex-tokens', 'POST')
  assert.equal(queries.filter(({ sql }) => sql.startsWith('update "profiles"')).length, 0, '回填可重复执行且不重复写入')

  // 创建即写入摘要；编译和返回均只使用 D1 中的最新 YAML。
  sqlite
    .prepare(
      'INSERT INTO physical_nodes (id,fingerprint,protocol,server,port,config,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1)',
    )
    .run(
      'physical-test',
      'fingerprint-test',
      'ss',
      'example.com',
      443,
      JSON.stringify({
        type: 'ss',
        server: 'example.com',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'offline-password',
      }),
    )
  sqlite
    .prepare(
      "INSERT INTO nodes (id,source_id,physical_node_id,original_name,position,created_at,updated_at) VALUES ('node-test','system-manual','physical-test','测试节点',0,1,1)",
    )
    .run()
  const created = await admin('', 'POST', {
    name: '新配置',
    nodeBinding: { mode: 'source', sourceIds: ['system-manual'], includeRegex: null, excludeRegex: null },
    slotBindings: [],
  })
  assert.equal(created.status, 202, await created.clone().text())
  const { profile } = (await created.json()).data
  const token = new URL(profile.subscriptionUrl).pathname.split('/')[2]
  assert.equal(profile.subscriptionTokenHash, undefined, 'API 不暴露内部索引')
  assert.equal(row(profile.id).subscription_token_hash, await subscriptionTokenHash(token))
  await subscription(token, 404, 0)
  await compileProfile(env, profile.id)
  assert.equal(await (await subscription(token, 200, 1)).text(), row(profile.id).compiled_yaml)
  assert.equal((await admin(`/${profile.id}`, 'PATCH', { enabled: false })).status, 202)
  await subscription(token, 404, 0)
  assert.equal((await admin(`/${profile.id}`, 'PATCH', { enabled: true, name: '已改名' })).status, 202)
  assert.match((await subscription(token, 200, 1)).headers.get('Content-Disposition'), /%E5%B7%B2/)
  sqlite.prepare('UPDATE profiles SET compiled_yaml = ? WHERE id = ?').run('proxies: [] # 最新配置', profile.id)
  assert.equal(await (await subscription(token, 200, 1)).text(), 'proxies: [] # 最新配置')

  const rotated = await admin(`/${profile.id}/rotate-token`, 'POST')
  assert.equal(rotated.status, 200)
  const nextToken = new URL((await rotated.json()).data.subscriptionUrl).pathname.split('/')[2]
  assert.notEqual(nextToken, token)
  assert.equal(row(profile.id).subscription_token_hash, await subscriptionTokenHash(nextToken))
  await subscription(token, 404, 0)
  await subscription(nextToken, 200, 1)

  // 密钥变更及错误的索引映射不能绕过单次 HMAC 校验。
  env.SUBSCRIPTION_TOKEN_SECRET = 'new-offline-secret'
  await subscription(nextToken, 404, 1)
  const refreshed = await admin(`/${profile.id}`)
  assert.equal(refreshed.status, 200)
  const secretToken = new URL((await refreshed.json()).data.subscriptionUrl).pathname.split('/')[2]
  await subscription(nextToken, 404, 0)
  await subscription(secretToken, 200, 1)
  sqlite
    .prepare('UPDATE profiles SET subscription_token_hash = ? WHERE id = ?')
    .run(await subscriptionTokenHash('A'.repeat(22)), profile.id)
  await subscription('A'.repeat(22), 404, 1)
  await admin('/reindex-tokens', 'POST')

  // 回填与轮换交错时不能覆盖新版本；同时轮换返回冲突而非回退版本。
  sqlite.prepare('UPDATE profiles SET subscription_token_hash = NULL WHERE id = ?').run(profile.id)
  const concurrentVersion = row(profile.id).token_version + 1
  const concurrentToken = await subscriptionToken(env.SUBSCRIPTION_TOKEN_SECRET, profile.id, concurrentVersion)
  const concurrentHash = await subscriptionTokenHash(concurrentToken)
  beforeQuery = (sql, params) => {
    if (sql.startsWith('update "profiles"') && params.includes(profile.id)) {
      beforeQuery = () => {}
      sqlite
        .prepare('UPDATE profiles SET token_version = ?, subscription_token_hash = ? WHERE id = ?')
        .run(concurrentVersion, concurrentHash, profile.id)
    }
  }
  assert.equal((await admin('/reindex-tokens', 'POST')).status, 200)
  assert.equal(row(profile.id).subscription_token_hash, concurrentHash)
  await subscription(concurrentToken, 200, 1)
  beforeQuery = (sql) => {
    if (sql.startsWith('update "profiles"')) {
      beforeQuery = () => {}
      sqlite.prepare('UPDATE profiles SET token_version = token_version + 1 WHERE id = ?').run(profile.id)
    }
  }
  assert.equal((await admin(`/${profile.id}/rotate-token`, 'POST')).status, 409)
  assert.equal(row(profile.id).subscription_token_hash, concurrentHash)
  await admin('/reindex-tokens', 'POST')

  // 更多 Profile 不增加分发查询数、返回行数或 HMAC 次数。
  for (let index = 0; index < 20; index++) fixture(`extra-${index}`)
  await admin('/reindex-tokens', 'POST')
  await subscription(oldToken, 404, 0)
  const indexedToken = await subscriptionToken(env.SUBSCRIPTION_TOKEN_SECRET, 'legacy', 4)
  await subscription(indexedToken, 200, 1)
  assert.throws(
    () =>
      sqlite
        .prepare('UPDATE profiles SET subscription_token_hash = ? WHERE id = ?')
        .run(row('legacy').subscription_token_hash, 'disabled'),
    /UNIQUE constraint failed/,
  )
  assert.equal((await admin('/legacy', 'DELETE')).status, 200)
  await subscription(indexedToken, 404, 0)
  console.log('订阅索引回归通过：迁移/回填、单行索引查询、一次 HMAC、创建/编译、禁用/删除/轮换、密钥变更及并发保护。')
} finally {
  crypto.subtle.sign = originalSign
  sqlite.close()
}
