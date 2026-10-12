import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { parseConfigFileTextToJson } from 'typescript'
import { parse } from 'yaml'

// Node 24 原生执行 Worker TS；仅补齐项目使用的无扩展名相对导入。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/worker/') && !specifier.endsWith('.ts'))
      specifier += '.ts'
    return nextResolve(specifier, context)
  },
})

const { app } = await import('../worker/app.ts')
const { default: worker } = await import('../worker/index.ts')
const { subscriptionToken, subscriptionTokenHash, sessionHash } = await import('../worker/security.ts')
const { compileProfile, selectProfileNodes, selectDraftProfileNodes, affectedProfileIdsForSource } =
  await import('../worker/tasks.ts')
const { renderMihomoConfig } = await import('../worker/templates/renderer.ts')
const { parseTemplateYaml } = await import('../worker/templates/validator.ts')
const { replaceProfileNodeBinding } = await import('../worker/profile-node-binding.ts')
const { replaceProfileSlotBindings } = await import('../worker/profile-slot-bindings.ts')
const { replaceSourceTags } = await import('../worker/tag-store.ts')
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
  // 从真实 scheduled 入口验证 Cron 分流和到期源入队，全程不访问外网。
  const { config, error } = parseConfigFileTextToJson(
    'wrangler.jsonc',
    readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  )
  assert.equal(error, undefined)
  assert.deepEqual(config.triggers.crons, ['0 * * * *', '*/5 * * * *', '17 3 * * *'])
  const scheduledTime = Date.now() - 3_600_000
  const sent = []
  const writes = []
  let catalogReads = 0
  let githubRequests = 0
  const scheduledEnv = {
    ...env,
    JOBS: {
      async send(message) {
        sent.push(message)
      },
    },
    KV: {
      async get() {
        catalogReads++
        return null
      },
      async put(key, value) {
        writes.push({ key, value })
      },
    },
  }
  async function scheduled(cron) {
    const pending = []
    worker.scheduled({ cron, scheduledTime }, scheduledEnv, {
      waitUntil(promise) {
        pending.push(promise)
      },
    })
    assert.equal(pending.length, cron === 'unknown' ? 0 : 1, '定时工作必须交给 waitUntil')
    await Promise.all(pending)
  }
  for (const [id, kind, enabled, interval, nextRefreshAt] of [
    ...[1, 6, 12, 24].map((hours) => [`due-${hours}`, 'url', 1, hours, scheduledTime]),
    ['future', 'url', 1, 1, scheduledTime + 1],
    ['disabled', 'url', 0, 1, scheduledTime],
    ['off', 'url', 1, 0, null],
    ['unscheduled', 'url', 1, 6, null],
    ['manual', 'manual', 1, 0, scheduledTime],
    ['pending', 'url', 1, 6, scheduledTime],
    ['running', 'url', 1, 6, scheduledTime],
  ]) {
    sqlite
      .prepare(
        'INSERT INTO sources (id,name,kind,enabled,refresh_interval_hours,next_refresh_at,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1)',
      )
      .run(`cron-${id}`, id, kind, enabled, interval, nextRefreshAt)
  }
  for (const status of ['pending', 'running'])
    sqlite
      .prepare("INSERT INTO jobs (id,type,entity_id,status,created_at) VALUES (?,'refresh_source',?,?,1)")
      .run(`cron-${status}`, `cron-${status}`, status)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/api\.github\.com\/repos\//)
    githubRequests++
    return Response.json({ sha: 'offline', tree: [{ type: 'blob', path: 'direct.txt' }] })
  }
  try {
    await scheduled('0 * * * *')
    assert.deepEqual(sent.map(({ entityId }) => entityId).sort(), [
      'cron-due-1',
      'cron-due-12',
      'cron-due-24',
      'cron-due-6',
    ])
    assert.ok(sent.every(({ type }) => type === 'refresh_source'))
    assert.equal(catalogReads, 0, '每小时刷新不读取规则集目录')
    assert.equal(githubRequests, 0, '每小时刷新不访问 GitHub')
    await scheduled('0 * * * *')
    assert.equal(sent.length, 4, '已有 pending/running 任务不重复入队')
    queries = []
    await scheduled('17 3 * * *')
    assert.equal(queries.length, 0, '每日规则集同步不扫描订阅')
    assert.equal(sent.length, 4)
    assert.equal(catalogReads, 1)
    assert.equal(githubRequests, 2)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].key, 'rule-set-presets:catalog')
    assert.equal(JSON.parse(writes[0].value).sources.loyalsoldier.items[0].name, 'direct')
    await scheduled('unknown')
    assert.equal(githubRequests, 2)
    console.log(
      '订阅定时刷新回归通过：真实 Cron 入口、到期边界/各刷新间隔、停用/关闭/未到期、任务去重和每日规则集隔离。',
    )
  } finally {
    globalThis.fetch = originalFetch
    sqlite.exec("DELETE FROM jobs WHERE entity_id LIKE 'cron-%'; DELETE FROM sources WHERE id LIKE 'cron-%'")
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
  // 模板声明订阅源槽位：单源绑定、不展开节点、混用 proxies/use、多组复用。
  const request = (module, path, method = 'GET', body) =>
    app.fetch(
      new Request(`${origin}/api/${module}${path}`, {
        method,
        headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    )
  const slotA = { key: '__WANGWANG_SOURCE_SLOT_AirptA__', name: '机场 A', type: 'subscription' }
  const slotB = { key: '__WANGWANG_SOURCE_SLOT_AirptB__', name: '机场 B', type: 'subscription' }
  const nodeSlot = { key: '__WANGWANG_SOURCE_SLOT_Nodes1__', name: '普通节点' }
  const providerYaml = `proxy-groups:
  - name: 全部
    type: select
    use: [${slotA.key}, ${slotB.key}]
  - name: A
    type: select
    use: [${slotA.key}]
  - name: B
    type: select
    use: [${slotB.key}]
rules:
  - MATCH,全部
`
  for (const id of ['airport-a', 'airport-b', 'airport-off', 'airport-private', 'airport-pending'])
    sqlite
      .prepare(`INSERT INTO sources (id,name,kind,url,enabled,user_agent,refresh_interval_hours,node_name_filter,created_at,updated_at)
      VALUES (?,?,'url',?,?,'provider-test-UA',6,'剩余|到期',1,1)`)
      .run(
        id,
        id,
        id === 'airport-private'
          ? 'http://127.0.0.1/sub'
          : id === 'airport-pending'
            ? null
            : `https://example.com/${id}?token=secret`,
        id === 'airport-off' ? 0 : 1,
      )
  // 已有缓存节点也不能注入订阅槽位。
  sqlite
    .prepare(`INSERT INTO nodes (id,source_id,physical_node_id,original_name,position,created_at,updated_at)
    VALUES ('airport-node','airport-a','physical-test','机场缓存节点',0,1,1)`)
    .run()
  const templateResponse = await request('templates', '', 'POST', {
    name: '订阅槽位模板',
    yaml: providerYaml,
    sourceSlots: [slotA, slotB],
  })
  assert.equal(templateResponse.status, 201, await templateResponse.clone().text())
  const providerTemplate = (await templateResponse.json()).data
  const binding = (slot, id) => ({
    slotKey: slot.key,
    mode: 'source',
    sourceIds: [id],
    includeRegex: null,
    excludeRegex: null,
  })
  const draft = {
    name: '订阅槽位配置',
    templateId: providerTemplate.id,
    nodeBinding: { mode: 'source', sourceIds: [], includeRegex: null, excludeRegex: null },
    slotBindings: [binding(slotA, 'airport-a'), binding(slotB, 'airport-b')],
  }
  for (const invalid of [
    [],
    [binding(slotA, 'airport-a')],
    [binding(slotA, 'missing'), binding(slotB, 'airport-b')],
    [binding(slotA, 'system-manual'), binding(slotB, 'airport-b')],
    [binding(slotA, 'airport-off'), binding(slotB, 'airport-b')],
    [binding(slotA, 'airport-private'), binding(slotB, 'airport-b')],
    [binding(slotA, 'airport-pending'), binding(slotB, 'airport-b')],
    [{ ...binding(slotA, 'airport-a'), sourceIds: ['airport-a', 'airport-b'] }, binding(slotB, 'airport-b')],
    [{ slotKey: slotA.key, mode: 'node', nodeIds: ['node-test'] }, binding(slotB, 'airport-b')],
    [{ slotKey: slotA.key, mode: 'tag', tags: ['test'] }, binding(slotB, 'airport-b')],
    [{ ...binding(slotA, 'airport-a'), includeRegex: 'HK' }, binding(slotB, 'airport-b')],
    [binding(slotA, 'airport-a'), binding(slotA, 'airport-a')],
  ])
    assert.equal((await admin('', 'POST', { ...draft, slotBindings: invalid })).status, 400)
  const providerCreated = await admin('', 'POST', draft)
  assert.equal(providerCreated.status, 202, await providerCreated.clone().text())
  const providerProfile = (await providerCreated.json()).data.profile
  assert.deepEqual(providerProfile.slotBindings, draft.slotBindings)
  assert.equal(Object.hasOwn(providerProfile, 'proxySourceIds'), false, '不保留配置级 provider 多选方案')
  await compileProfile(env, providerProfile.id)
  const compiled = parse(row(providerProfile.id).compiled_yaml)
  assert.deepEqual(compiled.proxies, [], '订阅节点不展开，provider-only 配置可生成')
  assert.deepEqual(Object.keys(compiled['proxy-providers']), ['wangwang-AirptA', 'wangwang-AirptB'])
  assert.deepEqual(
    compiled['proxy-groups'].map((g) => g.use),
    [['wangwang-AirptA', 'wangwang-AirptB'], ['wangwang-AirptA'], ['wangwang-AirptB']],
  )
  assert.doesNotMatch(row(providerProfile.id).compiled_yaml, /__WANGWANG_/)
  assert.deepEqual(compiled['proxy-providers']['wangwang-AirptA'], {
    type: 'http',
    url: 'https://example.com/airport-a?token=secret',
    path: './proxy_providers/wangwang-AirptA.yaml',
    interval: 21600,
    header: { 'User-Agent': ['provider-test-UA'] },
    'exclude-filter': '剩余|到期',
    'health-check': { enable: true, url: 'https://www.gstatic.com/generate_204', interval: 300 },
  })
  const previewResponse = await admin('/preview', 'POST', draft)
  assert.equal(previewResponse.status, 200)
  const previewData = (await previewResponse.json()).data
  assert.equal(previewData.error, null)
  assert.equal(previewData.nodeCount, 0, '动态节点数量未知，不伪报本地缓存数量')
  assert.deepEqual(parse(previewData.yaml), compiled)
  const sample = await request('templates', '/preview', 'POST', { templateId: providerTemplate.id })
  assert.equal(sample.status, 200, await sample.clone().text())
  assert.match(
    parse((await sample.json()).data.yaml)['proxy-providers']['wangwang-AirptA'].url,
    /^https:\/\/example.com\//,
  )
  const boundPreview = await request('templates', '/preview', 'POST', {
    templateId: providerTemplate.id,
    profileId: providerProfile.id,
  })
  assert.equal(boundPreview.status, 200)
  assert.deepEqual(parse((await boundPreview.json()).data.yaml), compiled)
  assert.equal(
    (
      await request('templates', `/${providerTemplate.id}`, 'PATCH', {
        sourceSlots: [{ ...slotA, type: 'nodes' }, slotB],
      })
    ).status,
    409,
    '已绑定槽位不能切换类型',
  )
  const boundDetail = (await (await request('templates', `/${providerTemplate.id}`)).json()).data
  assert.deepEqual(boundDetail.boundSlotKeys.sort(), [slotA.key, slotB.key].sort())
  // 模拟旧数据中模板在用但某个槽位尚未绑定；其他模板的同名 key 不应锁住它。
  sqlite
    .prepare('DELETE FROM profile_slot_sources WHERE profile_id=? AND slot_key=?')
    .run(providerProfile.id, slotB.key)
  sqlite
    .prepare('DELETE FROM profile_slot_bindings WHERE profile_id=? AND slot_key=?')
    .run(providerProfile.id, slotB.key)
  fixture('other-template-binding')
  sqlite
    .prepare("INSERT INTO profile_slot_bindings (profile_id,slot_key,mode) VALUES (?,?,'node')")
    .run('other-template-binding', slotB.key)
  const partiallyBound = (await (await request('templates', `/${providerTemplate.id}`)).json()).data
  assert.equal(partiallyBound.profileCount, 1)
  assert.deepEqual(partiallyBound.boundSlotKeys, [slotA.key], '锁定依据是当前模板的具体槽位绑定')
  const changedSlots = [slotA, { ...slotB, type: 'nodes' }]
  const changedYaml = `proxy-groups:\n  - name: 全部\n    type: select\n    use: [${slotA.key}]\n    proxies: [${slotB.key}]\nrules:\n  - MATCH,全部\n`
  const unlockedChange = await request('templates', `/${providerTemplate.id}`, 'PATCH', {
    yaml: changedYaml,
    sourceSlots: changedSlots,
  })
  assert.equal(unlockedChange.status, 202, await unlockedChange.clone().text())
  const updatedTemplate = (await unlockedChange.json()).data.template
  assert.equal(updatedTemplate.sourceSlots[1].type, 'nodes', '模板在用也允许未绑定槽位切换类型')
  assert.deepEqual(updatedTemplate.boundSlotKeys, [slotA.key])
  assert.equal(
    (
      await request('templates', `/${providerTemplate.id}`, 'PATCH', {
        yaml: providerYaml,
        sourceSlots: [slotA, slotB],
      })
    ).status,
    202,
    '未绑定槽位可双向切换类型',
  )
  const copiedResponse = await request('templates', `/${providerTemplate.id}/duplicate`, 'POST')
  assert.equal(copiedResponse.status, 201)
  const copiedId = (await copiedResponse.json()).data.id
  assert.deepEqual(
    (await (await request('templates', `/${copiedId}`)).json()).data.boundSlotKeys,
    [],
    '副本不继承原模板的绑定锁定',
  )
  assert.equal((await request('templates', `/${copiedId}`, 'DELETE')).status, 200)
  assert.equal((await admin(`/${providerProfile.id}`, 'PATCH', { slotBindings: draft.slotBindings })).status, 202)
  assert.equal(
    (await request('templates', `/${providerTemplate.id}`, 'PATCH', { yaml: changedYaml, sourceSlots: changedSlots }))
      .status,
    409,
    '加载后新绑定的槽位在保存时仍会被后端保护',
  )
  sqlite.prepare('DELETE FROM profiles WHERE id=?').run('other-template-binding')
  for (const yaml of [
    providerYaml.replace('use:', 'proxies:'),
    providerYaml.replace(slotA.key, '__WANGWANG_SOURCE_SLOT_unknwn__'),
  ])
    assert.throws(() => parseTemplateYaml(yaml, [slotA, slotB]))
  for (const flag of ['include-all-providers', 'include-all']) {
    const yaml = providerYaml.replace('type: select', `type: select\n    ${flag}: true`)
    assert.doesNotThrow(() => parseTemplateYaml(yaml, [slotA, slotB]))
    const sampleResponse = await request('templates', '/preview', 'POST', { yaml, sourceSlots: [slotA, slotB] })
    assert.equal(sampleResponse.status, 200, await sampleResponse.clone().text())
    const sampleYaml = parse((await sampleResponse.json()).data.yaml)
    assert.equal(sampleYaml['proxy-groups'][0][flag], true)
    assert.deepEqual(
      sampleYaml['proxy-groups'][0].use,
      ['wangwang-AirptA', 'wangwang-AirptB'],
      '保留显式 use 和自动包含开关，由 Mihomo 决定生效范围',
    )
    const createResponse = await request('templates', '', 'POST', {
      name: `兼容 ${flag}`,
      yaml,
      sourceSlots: [slotA, slotB],
    })
    assert.equal(createResponse.status, 201, await createResponse.clone().text())
    const created = (await createResponse.json()).data
    assert.equal(
      (await request('templates', `/${created.id}`, 'PATCH', { yaml })).status,
      202,
      '自动包含与 use 并存不阻止保存',
    )
    assert.equal((await request('templates', `/${created.id}`, 'DELETE')).status, 200)
    const automaticYaml = `proxy-groups:\n  - name: 自动包含\n    type: select\n    ${flag}: true\n    use: [ignored-provider]\nrules: ['MATCH,自动包含']\n`
    const automaticResponse = await request('templates', '/preview', 'POST', {
      yaml: automaticYaml,
      sourceSlots: [slotA, slotB],
    })
    assert.equal(automaticResponse.status, 200, await automaticResponse.clone().text())
    const automaticConfig = parse((await automaticResponse.json()).data.yaml)
    assert.deepEqual(Object.keys(automaticConfig['proxy-providers']).sort(), ['wangwang-AirptA', 'wangwang-AirptB'])
    assert.deepEqual(
      automaticConfig['proxy-groups'][0].use,
      ['ignored-provider'],
      '被自动包含覆盖的无效 use 不产生错误',
    )
  }
  assert.throws(
    () => parseTemplateYaml('proxy-groups:\n  - {name: 未引用, type: select, proxies: [DIRECT]}', [slotA]),
    /未被代理组引用/,
    '未被显式或自动引用的槽位仍保留校验',
  )
  assert.throws(
    () => parseTemplateYaml(`proxy-groups:\n  - name: wrong\n    type: select\n    use: [${nodeSlot.key}]`, [nodeSlot]),
    /proxies/,
  )
  assert.throws(
    () =>
      renderMihomoConfig({
        globalNodes: [],
        slotNodes: [],
        template: {
          yaml: providerYaml + 'proxy-providers:\n  wangwang-AirptA: {type: http, url: https://example.com/existing}\n',
          sourceSlots: [slotA, slotB],
        },
        proxyProviders: compiled['proxy-providers'],
      }),
    /冲突/,
  )
  assert.throws(
    () =>
      renderMihomoConfig({
        globalNodes: [],
        slotNodes: [],
        template: { yaml: providerYaml, sourceSlots: [slotA, slotB] },
      }),
    /未绑定/,
  )
  assert.throws(
    () =>
      renderMihomoConfig({
        globalNodes: [],
        slotNodes: [],
        template: {
          yaml: 'proxy-providers:\n  existing: {type: http, url: https://example.com/sub}\nproxy-groups:\n  - {name: bad, type: select, use: [missing]}',
          sourceSlots: [],
        },
      }),
    /不存在的 provider/,
  )
  assert.equal(
    (
      await admin(`/${providerProfile.id}`, 'PATCH', {
        slotBindings: [binding(slotA, 'airport-b'), binding(slotB, 'airport-b')],
      })
    ).status,
    202,
  )
  await compileProfile(env, providerProfile.id)
  assert.equal(
    parse(row(providerProfile.id).compiled_yaml)['proxy-providers']['wangwang-AirptA'].url,
    'https://example.com/airport-b?token=secret',
    '重新绑定保持 provider 名称稳定',
  )
  assert.ok((await affectedProfileIdsForSource(env, 'airport-b')).includes(providerProfile.id))
  sqlite.prepare('DELETE FROM jobs WHERE entity_id=?').run(providerProfile.id)
  assert.equal(
    (
      await request('sources', '/airport-b', 'PATCH', {
        userAgent: 'changed-UA',
        refreshIntervalHours: 12,
        nodeNameFilter: '到期',
      })
    ).status,
    200,
  )
  assert.ok(sqlite.prepare("SELECT 1 FROM jobs WHERE type='compile_profile' AND entity_id=?").get(providerProfile.id))
  await compileProfile(env, providerProfile.id)
  const updatedProvider = parse(row(providerProfile.id).compiled_yaml)['proxy-providers']['wangwang-AirptA']
  assert.equal(updatedProvider.interval, 43200)
  assert.deepEqual(updatedProvider.header['User-Agent'], ['changed-UA'])
  assert.equal(updatedProvider['exclude-filter'], '到期')
  assert.equal((await request('sources', '/airport-b', 'PATCH', { enabled: false })).status, 409)
  assert.equal((await request('sources', '/airport-b', 'DELETE')).status, 409)
  sqlite.prepare('UPDATE sources SET url=? WHERE id=?').run('https://example.com/new', 'airport-b')
  await compileProfile(env, providerProfile.id)
  assert.equal(
    parse(row(providerProfile.id).compiled_yaml)['proxy-providers']['wangwang-AirptA'].url,
    'https://example.com/new',
  )
  sqlite.prepare('UPDATE sources SET enabled=0 WHERE id=?').run('airport-b')
  await assert.rejects(compileProfile(env, providerProfile.id), /已停用/)
  sqlite.prepare('UPDATE sources SET enabled=1 WHERE id=?').run('airport-b')
  const mixedYaml = providerYaml.replace('    use:', `    proxies: [${nodeSlot.key}, DIRECT]\n    use:`)
  const mixedResponse = await request('templates', '', 'POST', {
    name: '混用模板',
    yaml: mixedYaml,
    sourceSlots: [nodeSlot, slotA, slotB],
  })
  assert.equal(mixedResponse.status, 201, await mixedResponse.clone().text())
  const mixedTemplate = (await mixedResponse.json()).data
  assert.equal(mixedTemplate.sourceSlots[0].type, 'nodes', '旧槽位缺省为节点槽位类型')
  const mixedDraft = {
    ...draft,
    templateId: mixedTemplate.id,
    slotBindings: [binding(nodeSlot, 'system-manual'), ...draft.slotBindings],
  }
  const mixedResponsePreview = await admin('/preview', 'POST', mixedDraft)
  const mixedData = (await mixedResponsePreview.json()).data
  assert.equal(mixedData.error, null)
  const mixed = parse(mixedData.yaml)
  assert.deepEqual(
    mixed.proxies.map(({ name }) => name),
    ['测试节点'],
  )
  assert.deepEqual(mixed['proxy-groups'][0].proxies, ['测试节点', 'DIRECT'])
  assert.deepEqual(mixed['proxy-groups'][0].use, ['wangwang-AirptA', 'wangwang-AirptB'])
  assert.equal((await admin(`/${providerProfile.id}`, 'PATCH', { enabled: false })).status, 202)
  assert.equal((await admin(`/${providerProfile.id}`, 'PATCH', { name: '仅改名称' })).status, 202)
  const renamedProvider = (await (await admin(`/${providerProfile.id}`)).json()).data
  assert.equal(renamedProvider.enabled, false, '省略 enabled 不重新启用配置')
  assert.equal(renamedProvider.templateId, providerTemplate.id, '省略 templateId 不回退内置模板')
  assert.equal(renamedProvider.slotBindings[0].sourceIds[0], 'airport-b', '仅改名称保留槽位绑定')
  assert.equal((await admin(`/${providerProfile.id}`, 'DELETE')).status, 200)
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM profile_slot_bindings WHERE profile_id=?').get(providerProfile.id).n,
    0,
  )
  console.log('订阅源槽位回归通过：绑定校验、混用与复用、纯 provider、预览、类型锁定、重绑定与更新。')

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
  // 正则复用覆盖已保存/草稿的全局源、标签以及源/标签槽位；复用仅限单个绑定和本次选择。
  fixture('regex-test')
  sqlite.prepare('UPDATE nodes SET alias = ? WHERE id = ?').run('regex-keep', 'node-test')
  for (const [id, originalName, alias] of [
    ['regex-alias', 'other-name', 'regex-keep-2'],
    ['regex-drop', 'regex-drop', null],
  ]) {
    sqlite
      .prepare(
        'INSERT INTO physical_nodes SELECT ?, ?, protocol, server, port, config, created_at, updated_at FROM physical_nodes WHERE id = ?',
      )
      .run(id, id, 'physical-test')
    sqlite
      .prepare(
        "INSERT INTO nodes (id,source_id,physical_node_id,original_name,alias,position,created_at,updated_at) VALUES (?,'system-manual',?,?,?,1,1,1)",
      )
      .run(id, id, originalName, alias)
  }
  await replaceSourceTags(env, 'system-manual', ['regex-test'])
  const OriginalRegExp = globalThis.RegExp
  const constructions = []
  globalThis.RegExp = new Proxy(OriginalRegExp, {
    construct(target, args) {
      constructions.push(args[0])
      return Reflect.construct(target, args)
    },
  })
  try {
    for (const mode of ['source', 'tag']) {
      const nodeBinding = {
        mode,
        ...(mode === 'source' ? { sourceIds: ['system-manual'] } : { tags: ['regex-test'] }),
        includeRegex: '^regex-',
        excludeRegex: 'drop$',
      }
      const slotBindings = ['slot-a', 'slot-b'].map((slotKey) => ({ ...nodeBinding, slotKey }))
      await replaceProfileNodeBinding(env, 'regex-test', nodeBinding)
      await replaceProfileSlotBindings(env, 'regex-test', slotBindings)
      for (const saved of [true, false]) {
        constructions.length = 0
        const result = saved
          ? await selectProfileNodes(env, { id: 'regex-test' })
          : await selectDraftProfileNodes(env, { nodeBinding, slotBindings })
        assert.deepEqual(
          result.globalNodes.map(({ name }) => name),
          ['regex-keep', 'regex-keep-2'],
        )
        for (const slotKey of ['slot-a', 'slot-b'])
          assert.deepEqual(
            result.slotNodes.filter((node) => node.slotKey === slotKey).map(({ name }) => name),
            ['regex-keep', 'regex-keep-2'],
          )
        assert.equal(
          constructions.filter((pattern) => pattern === '^regex-').length,
          3,
          `${mode}/${saved}: 每个绑定只构造一次包含正则`,
        )
        assert.equal(
          constructions.filter((pattern) => pattern === 'drop$').length,
          3,
          `${mode}/${saved}: 每个绑定只构造一次排除正则`,
        )
      }
    }
    const draft = {
      nodeBinding: { mode: 'source', sourceIds: ['system-manual'], includeRegex: null, excludeRegex: null },
      slotBindings: [],
    }
    constructions.length = 0
    assert.equal((await selectDraftProfileNodes(env, draft)).globalNodes.length, 3)
    assert.equal(constructions.length, 0, '未启用正则时不构造对象')
    draft.nodeBinding.includeRegex = '['
    await assert.rejects(selectDraftProfileNodes(env, draft), SyntaxError)
    draft.nodeBinding.sourceIds = ['missing-source']
    assert.equal((await selectDraftProfileNodes(env, draft)).globalNodes.length, 0, '没有节点时仍不触发无效正则')
    draft.nodeBinding.sourceIds = ['system-manual']
    draft.nodeBinding.includeRegex = '^absent$'
    draft.nodeBinding.excludeRegex = '['
    assert.equal(
      (await selectDraftProfileNodes(env, draft)).globalNodes.length,
      0,
      '包含规则拒绝全部节点时仍短路排除规则',
    )
    draft.nodeBinding.includeRegex = null
    await assert.rejects(selectDraftProfileNodes(env, draft), SyntaxError)
    console.log('节点筛选正则回归通过：7 个分支、每绑定一次构造、别名/顺序、空规则及无效正则短路。')
  } finally {
    globalThis.RegExp = OriginalRegExp
  }
  console.log('订阅索引回归通过：迁移/回填、单行索引查询、一次 HMAC、创建/编译、禁用/删除/轮换、密钥变更及并发保护。')
} finally {
  crypto.subtle.sign = originalSign
  sqlite.close()
}
