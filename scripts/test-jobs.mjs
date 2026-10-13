import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import './register-worker-test-hooks.mjs'
import { DatabaseSync } from 'node:sqlite'
import { stringify } from 'yaml'
import { parseConfigFileTextToJson } from 'typescript'

const { default: worker } = await import('../worker/index.ts')
const { createJob, compileProfile, cleanupOrphanPhysicalNodes, MAX_JOB_ATTEMPTS } = await import('../worker/tasks.ts')
const { parseProxyText } = await import('../worker/proxy/index.ts')
const { app } = await import('../worker/app.ts')
const { sessionHash } = await import('../worker/security.ts')
let dispose
let underlying
if (process.argv.includes('--d1')) {
  // 复用 Wrangler 已安装的 Miniflare，不新增测试框架或依赖。
  const require = createRequire(import.meta.url)
  const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler/package.json'))('miniflare')
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: '2026-08-26',
      script: 'export default { fetch() { return new Response("test") } }',
      d1Databases: ['DB'],
    }),
  )
  underlying = await mf.getD1Database('DB')
  dispose = () => mf.dispose()
} else {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  underlying = {
    prepare(sql) {
      let params = []
      function execute(arrays = false) {
        const statement = sqlite.prepare(sql)
        statement.setReturnArrays(arrays)
        const results = statement.all(...params)
        return { success: true, results, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }
      }
      return {
        bind(...values) {
          params = values
          return this
        },
        async all() {
          return execute()
        },
        async raw() {
          return execute(true).results
        },
        async first(column) {
          const row = execute().results[0]
          return (column ? row?.[column] : row) ?? null
        },
        async run() {
          return execute()
        },
      }
    },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.all())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  dispose = () => sqlite.close()
}
let failBatchAt = -1
let failFinish = false
let failCompileFinish = false
let beforeBatch = async () => {}
const statementSql = new WeakMap()
const underlyingStatements = new WeakMap()
const batches = []
function wrap(statement, sql) {
  const result = {
    bind(...values) {
      return wrap(statement.bind(...values), sql)
    },
    all(...args) {
      return statement.all(...args)
    },
    raw(...args) {
      return statement.raw(...args)
    },
    first(...args) {
      return statement.first(...args)
    },
    run(...args) {
      return statement.run(...args)
    },
  }
  statementSql.set(result, sql)
  underlyingStatements.set(result, statement)
  return result
}
const DB = {
  prepare(sql) {
    return wrap(underlying.prepare(sql), sql)
  },
  async batch(statements) {
    batches.push(statements.map((statement) => statementSql.get(statement)))
    await beforeBatch(statements)
    if (failBatchAt >= 0 && statementSql.get(statements[0])?.includes('SET refresh_commit_token')) {
      statements = [...statements]
      statements[failBatchAt] = underlying.prepare(
        "INSERT INTO jobs (id,type,entity_id,status,created_at) VALUES (NULL,'compile_profile','failure','pending',1)",
      )
      failBatchAt = -1
    }
    if (failFinish && statements.some((statement) => statementSql.get(statement)?.includes('SET status=?'))) {
      failFinish = false
      statements = [
        ...statements,
        underlying.prepare(
          "INSERT INTO jobs (id,type,entity_id,status,created_at) VALUES (NULL,'compile_profile','failure','pending',1)",
        ),
      ]
    }
    if (failCompileFinish && statementSql.get(statements[0])?.includes('UPDATE profiles SET revision')) {
      failCompileFinish = false
      statements = [...statements]
      statements[1] = underlying.prepare(
        "INSERT INTO jobs (id,type,entity_id,status,created_at) VALUES (NULL,'compile_profile','failure','pending',1)",
      )
    }
    return underlying.batch(statements.map((statement) => underlyingStatements.get(statement) ?? statement))
  },
}
const sent = []
let sendFailure = () => false
let beforeSend = async () => {}
const env = {
  DB,
  JOBS: {
    async send(message) {
      if (sendFailure(message)) throw new Error('queue unavailable')
      await beforeSend(message)
      sent.push(message)
    },
  },
}
const originalFetch = globalThis.fetch
let fetchResponse = () => new Response('upstream unavailable', { status: 503 })
globalThis.fetch = async (...args) => fetchResponse(...args)
async function execute(sql, ...params) {
  return DB.prepare(sql)
    .bind(...params)
    .run()
}
async function row(table, id) {
  return DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first()
}
async function consume(job, attempts = 1) {
  const acks = []
  const retries = []
  await worker.queue(
    {
      messages: [
        {
          body: { jobId: job.id, type: job.type, entityId: job.entityId },
          attempts,
          ack() {
            acks.push(true)
          },
          retry(options) {
            retries.push(options)
          },
        },
      ],
    },
    env,
  )
  return { acks, retries }
}
async function source(id) {
  await execute(
    "INSERT INTO sources (id,name,kind,url,pending_url,enabled,etag,last_modified,created_at,updated_at) VALUES (?,?,'url','https://old.example.com/sub','https://new.example.com/sub',1,'old-etag','old-date',1,1)",
    id,
    id,
  )
}
const configs = [
  { name: 'keep', type: 'ss', server: 'keep.example.com', port: 443, cipher: 'aes-128-gcm', password: 'keep-secret' },
  { name: 'old', type: 'ss', server: 'old.example.com', port: 443, cipher: 'aes-128-gcm', password: 'old-secret' },
]
const newConfigs = [
  { ...configs[0], name: 'renamed keep' },
  { ...configs[1], server: 'new.example.com', name: 'new' },
]
function response(items = newConfigs) {
  return new Response(stringify({ proxies: items }), {
    headers: {
      ETag: 'new-etag',
      'Last-Modified': 'new-date',
      'Subscription-Userinfo': 'upload=1; download=2; total=3; expire=2000000000',
    },
  })
}
async function fixture(id, withProfiles = true) {
  await source(id)
  const parsed = await parseProxyText(stringify({ proxies: configs }))
  for (const [index, node] of parsed.nodes.entries()) {
    const existing = await DB.prepare('SELECT id FROM physical_nodes WHERE fingerprint=?')
      .bind(node.fingerprint)
      .first()
    const physicalId = existing?.id || `${id}-physical-${index}`
    if (!existing)
      await execute(
        'INSERT INTO physical_nodes (id,fingerprint,protocol,server,port,config,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1)',
        physicalId,
        node.fingerprint,
        node.config.type,
        node.config.server,
        node.config.port,
        JSON.stringify(node.config),
      )
    await execute(
      'INSERT INTO nodes (id,source_id,physical_node_id,original_name,alias,enabled,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,1)',
      `${id}-node-${index}`,
      id,
      physicalId,
      node.originalName,
      index ? null : 'my alias',
      index ? 1 : 0,
      index,
    )
    await execute(
      'INSERT INTO tags (id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,1,1)',
      `${id}-tag-${index}`,
      `${id}-${index}`,
      `${id}-${index}`,
    )
    await execute('INSERT INTO node_tags (node_id,tag_id) VALUES (?,?)', `${id}-node-${index}`, `${id}-tag-${index}`)
  }
  await execute(
    'UPDATE sources SET node_count=2,upload_bytes=100,download_bytes=200,total_bytes=300,expire_at=1900000000,info_refreshed_at=1,last_refreshed_at=1,next_refresh_at=1 WHERE id=?',
    id,
  )
  if (withProfiles) {
    for (const mode of ['source', 'node']) {
      const profileId = `${id}-profile-${mode}`
      await execute('INSERT INTO profiles (id,name,created_at,updated_at) VALUES (?,?,1,1)', profileId, profileId)
      await execute('INSERT INTO profile_node_binding (profile_id,mode) VALUES (?,?)', profileId, mode)
      if (mode === 'source')
        await execute('INSERT INTO profile_node_sources (profile_id,source_id) VALUES (?,?)', profileId, id)
      else {
        await execute(
          'INSERT INTO profile_node_nodes (profile_id,node_id,position) VALUES (?,?,0)',
          profileId,
          `${id}-node-1`,
        )
        await execute(
          'INSERT INTO profile_node_nodes (profile_id,node_id,position) VALUES (?,?,1)',
          profileId,
          `${id}-node-0`,
        )
      }
    }
  }
  return createJob(env, 'refresh_source', id)
}
async function snapshot(id) {
  const src = await row('sources', id)
  if (src) {
    delete src.status
    delete src.error
    delete src.updated_at
  }
  const { results: ns } = await DB.prepare('SELECT * FROM nodes WHERE source_id=? ORDER BY id').bind(id).all()
  const { results: tags } = await DB.prepare(
    'SELECT nt.* FROM node_tags nt JOIN nodes n ON n.id=nt.node_id WHERE n.source_id=? ORDER BY nt.node_id,nt.tag_id',
  )
    .bind(id)
    .all()
  const { results: ps } = await DB.prepare(
    'SELECT p.* FROM physical_nodes p JOIN nodes n ON n.physical_node_id=p.id WHERE n.source_id=? ORDER BY p.id',
  )
    .bind(id)
    .all()
  return { source: src, nodes: ns, tags, physical: ps }
}
async function releaseRetry(job) {
  await execute("UPDATE jobs SET lease_until=0 WHERE id=? AND status='pending'", job.id)
}
async function children(job) {
  return (await DB.prepare('SELECT * FROM jobs WHERE parent_job_id=? ORDER BY entity_id').bind(job.id).all()).results
}
async function scheduledRecovery() {
  const pending = []
  worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, env, {
    waitUntil(promise) {
      pending.push(promise)
    },
  })
  assert.equal(pending.length, 1)
  await Promise.all(pending)
}
async function patchSource(id, input) {
  const res = await app.fetch(
    new Request(`https://admin.test/api/sources/${id}`, {
      method: 'PATCH',
      headers: { Cookie: 'ww_session=jobs-admin', Origin: 'https://admin.test', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    env,
  )
  assert.equal(res.status, 200, await res.clone().text())
}
async function clear() {
  for (const sql of [
    'DELETE FROM jobs',
    'DELETE FROM profiles',
    "DELETE FROM sources WHERE kind='url'",
    'DELETE FROM nodes',
    'DELETE FROM physical_nodes',
    'DELETE FROM tags',
  ])
    await execute(sql)
  sent.length = 0
  batches.length = 0
}
try {
  const { config, error } = parseConfigFileTextToJson(
    'wrangler.jsonc',
    readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  )
  assert.equal(error, undefined)
  assert.equal(config.queues.consumers[0].max_retries + 1, MAX_JOB_ATTEMPTS)
  // 不合法的队列消息不能触发数据库操作或无限重试（此时迁移尚未执行）。
  let invalidAcks = 0
  let invalidLogs = 0
  const originalError = console.error
  console.error = () => {
    invalidLogs++
  }
  try {
    await worker.queue(
      {
        messages: [null, 'raw', { jobId: 12 }, { jobId: '' }].map((body) => ({
          body,
          ack() {
            invalidAcks++
          },
          retry() {
            assert.fail('无效消息不应重试')
          },
        })),
      },
      env,
    )
  } finally {
    console.error = originalError
  }
  assert.equal(invalidAcks, 4)
  assert.equal(invalidLogs, 4)
  const dir = new URL('../drizzle/', import.meta.url)
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    for (const sql of readFileSync(new URL(file, dir), 'utf8')
      .split('--> statement-breakpoint')
      .filter((sql) => sql.trim()))
      await underlying.prepare(sql).run()
  }
  await source('retry-source')
  const job = await createJob(env, 'refresh_source', 'retry-source')
  const result = await consume(job)
  assert.equal(result.retries.length, 1, '503 必须真正通知 Queue 重试')
  assert.equal(result.acks.length, 0)
  assert.equal((await row('jobs', job.id)).status, 'pending', '临时失败不能提前变为终态')
  assert.equal((await row('sources', 'retry-source')).pending_url, 'https://new.example.com/sub')
  await execute(
    'INSERT INTO admin_sessions (token_hash,expires_at,created_at) VALUES (?,?,1)',
    await sessionHash('jobs-admin'),
    Date.now() + 3_600_000,
  )

  // 多次临时失败、平台新消息重新投递也不能重置业务次数；耗尽后保留旧数据和候选 URL。
  for (let attempt = 2; attempt <= MAX_JOB_ATTEMPTS; attempt++) {
    await releaseRetry(job)
    const result = await consume(job, 1)
    assert.equal(result.retries.length, attempt < MAX_JOB_ATTEMPTS ? 1 : 0)
    assert.equal(result.acks.length, attempt < MAX_JOB_ATTEMPTS ? 0 : 1)
  }
  assert.equal((await row('jobs', job.id)).attempts, MAX_JOB_ATTEMPTS)
  assert.equal((await row('jobs', job.id)).status, 'failed')
  assert.equal((await row('sources', 'retry-source')).pending_url, 'https://new.example.com/sub')
  assert.equal((await row('sources', 'retry-source')).etag, 'old-etag')
  assert.equal((await consume(job)).acks.length, 1, '终态重复投递只 ack')

  // 事务中多个位置的运行时约束错误：检查数据、标签、任务记录、进度标记均回滚。
  for (const index of [0, 2, 4, 7]) {
    const job = await fixture(`rollback-${index}`)
    const before = await snapshot(job.entityId)
    const physicalBefore = (await DB.prepare('SELECT * FROM physical_nodes ORDER BY id').all()).results
    fetchResponse = () => response()
    failBatchAt = index
    const result = await consume(job)
    assert.equal(
      result.retries.length,
      1,
      JSON.stringify({ index, job: await row('jobs', job.id), batches: batches.slice(-2) }),
    )
    assert.deepEqual(await snapshot(job.entityId), before, `事务第 ${index} 步失败后不能留下部分数据`)
    assert.deepEqual((await DB.prepare('SELECT * FROM physical_nodes ORDER BY id').all()).results, physicalBefore)
    assert.equal((await children(job)).length, 0)
    assert.equal((await row('jobs', job.id)).refresh_commit_token, null)
    await releaseRetry(job)
    assert.equal((await consume(job, 2)).acks.length, 1, JSON.stringify(await row('jobs', job.id)))
    const kept = await row('nodes', `${job.entityId}-node-0`)
    assert.equal(kept.alias, 'my alias')
    assert.equal(kept.enabled, 0)
    assert.equal(kept.original_name, 'renamed keep')
    assert.equal(kept.created_at, 1)
    assert.equal((await snapshot(job.entityId)).tags.length, 1)
    assert.equal(
      (
        await DB.prepare('SELECT node_id FROM profile_node_nodes WHERE profile_id=? AND position=1')
          .bind(`${job.entityId}-profile-node`)
          .first()
      ).node_id,
      kept.id,
    )
    assert.equal(await row('nodes', `${job.entityId}-node-1`), null)
    const stored = await row('sources', job.entityId)
    assert.equal(stored.url, 'https://new.example.com/sub')
    assert.equal(stored.pending_url, null)
    assert.equal(stored.etag, 'new-etag')
    assert.equal(stored.upload_bytes, 1)
    assert.equal(stored.version, 1)
    assert.equal((await children(job)).length, 2, '删除指定节点前必须保存该配置的编译任务')
  }

  // 提交成功后部分入队失败：只补发剩余固定 ID 的任务，不重新下载（即便上游之后会返回 304）。
  const dispatch = await fixture('dispatch')
  let fetches = 0
  fetchResponse = () => {
    fetches++
    return response()
  }
  let sends = 0
  sendFailure = (message) => message.type === 'compile_profile' && ++sends === 2
  assert.equal((await consume(dispatch)).retries.length, 1)
  assert.ok((await row('jobs', dispatch.id)).refresh_commit_token)
  assert.equal((await row('sources', dispatch.entityId)).status, 'ready')
  const childIds = (await children(dispatch)).map(({ id }) => id)
  sendFailure = () => false
  fetchResponse = () => {
    fetches++
    return new Response(null, { status: 304 })
  }
  await releaseRetry(dispatch)
  assert.equal((await consume(dispatch, 2)).acks.length, 1)
  assert.equal(fetches, 1)
  assert.deepEqual(
    (await children(dispatch)).map(({ id }) => id),
    childIds,
  )
  assert.ok((await children(dispatch)).every(({ dispatched_at }) => dispatched_at !== null))
  for (const child of await children(dispatch)) {
    const result = await consume({ ...child, entityId: child.entity_id })
    assert.equal(result.acks.length, 1)
    assert.equal(result.retries.length, 0, '不可用指定节点是永久错误，正常 source 绑定应编译成功')
  }

  // 标记已分发的写入失败时，允许消息重复，但不能新建不同 ID 的编译任务。
  const duplicateSend = await fixture('duplicate-send')
  fetchResponse = () => response()
  let failDispatchRecord = true
  const originalPrepare = DB.prepare
  DB.prepare = (sql) => {
    if (failDispatchRecord && sql.startsWith('update "jobs" set "dispatched_at"')) {
      failDispatchRecord = false
      throw new Error('dispatch timestamp unavailable')
    }
    return originalPrepare(sql)
  }
  const duplicateStart = sent.length
  assert.equal((await consume(duplicateSend)).retries.length, 1)
  DB.prepare = originalPrepare
  await releaseRetry(duplicateSend)
  assert.equal((await consume(duplicateSend, 2)).acks.length, 1)
  const childMessages = sent.slice(duplicateStart).filter(({ type }) => type === 'compile_profile')
  assert.equal(childMessages.length, 3)
  assert.equal(new Set(childMessages.map(({ jobId }) => jobId)).size, 2)
  const repeated = await DB.prepare('SELECT * FROM jobs WHERE id=?').bind(childMessages[0].jobId).first()
  const target = { ...repeated, entityId: repeated.entity_id }
  await consume(target)
  const revision = (await row('profiles', target.entityId)).revision
  await consume(target)
  assert.equal((await row('profiles', target.entityId)).revision, revision)

  // 成功提交后终态写入失败，恢复时仍跳过下载，并保持源 ready。
  const finish = await fixture('finish', false)
  let finishedFetches = 0
  fetchResponse = () => {
    finishedFetches++
    return response()
  }
  failFinish = true
  assert.equal((await consume(finish)).retries.length, 1)
  assert.equal((await row('sources', finish.entityId)).status, 'ready')
  await releaseRetry(finish)
  assert.equal((await consume(finish, 2)).acks.length, 1)
  assert.equal(finishedFetches, 1)

  // 别名扩展后的数据可能超过 D1 单字符串上限，即便下载内容本身小于 1 MiB。
  const expanded =
    'padding: &padding ' +
    'x'.repeat(120_000) +
    '\nproxies:\n' +
    Array.from(
      { length: 19 },
      (_, i) =>
        `  - name: node-${i}\n    type: ss\n    server: n${i}.example.com\n    port: 443\n    cipher: aes-128-gcm\n    password: secret\n    padding: *padding\n`,
    ).join('')
  // 非重试错误必须直接终止，且不能清除待验证地址或写入新节点。
  for (const [id, makeResponse] of [
    ['http404', () => new Response('not found', { status: 404 })],
    ['invalid-yaml', () => new Response('proxies: [')],
    ['empty', () => new Response('')],
    ['large', () => new Response('x'.repeat(1024 * 1024 + 1))],
    ['expanded', () => new Response(expanded)],
    ['candidate304', () => new Response(null, { status: 304 })],
  ]) {
    const job = await fixture(id, false)
    const before = await snapshot(id)
    fetchResponse = makeResponse
    const result = await consume(job)
    assert.equal(result.acks.length, 1, id)
    assert.equal(result.retries.length, 0, id)
    assert.deepEqual(await snapshot(id), before)
    assert.equal((await row('jobs', job.id)).status, 'failed')
    assert.equal((await row('jobs', job.id)).attempts, 1)
    if (id === 'expanded') assert.match((await row('jobs', job.id)).error, /2 MB/)
  }
  for (const status of [408, 429, 500]) {
    const job = await fixture(`http${status}`, false)
    fetchResponse = () => new Response('temporary', { status })
    assert.equal((await consume(job)).retries.length, 1)
  }

  // 下载期间修改地址：整个旧结果无效；后续尝试必须使用新设置。
  const changed = await fixture('changed', false)
  const changedBefore = await snapshot('changed')
  fetchResponse = async () => {
    await patchSource('changed', { url: 'https://latest.example.com/sub' })
    return response()
  }
  assert.equal((await consume(changed)).retries.length, 1)
  assert.deepEqual((await snapshot('changed')).nodes, changedBefore.nodes)
  assert.equal((await children(changed)).length, 0)
  assert.equal((await row('sources', 'changed')).pending_url, 'https://latest.example.com/sub')
  assert.equal((await row('sources', 'changed')).status, 'idle')
  await releaseRetry(changed)
  fetchResponse = (url) => {
    assert.equal(String(url), 'https://latest.example.com/sub')
    return response()
  }
  assert.equal((await consume(changed, 2)).acks.length, 1)
  assert.equal((await row('sources', 'changed')).url, 'https://latest.example.com/sub')
  for (const action of ['disable', 'delete', 'steal']) {
    const job = await fixture(action, false)
    const before = await snapshot(action)
    fetchResponse = async () => {
      if (action === 'disable') await patchSource(action, { enabled: false })
      if (action === 'delete') await execute('DELETE FROM sources WHERE id=?', action)
      if (action === 'steal') await execute("UPDATE jobs SET lease_token='new-owner' WHERE id=?", job.id)
      return response()
    }
    const result = await consume(job)
    assert.equal(result.retries.length, action === 'steal' ? 1 : 0)
    assert.equal((await children(job)).length, 0)
    if (action === 'delete') assert.equal(await row('sources', action), null)
    else assert.deepEqual((await snapshot(action)).nodes, before.nodes)
    if (action === 'steal') assert.equal((await row('jobs', job.id)).lease_token, 'new-owner')
    if (action === 'disable') assert.equal((await row('sources', action)).status, 'idle')
  }

  // 无修改的 304 也要原子记录完成；保留现有流量信息，不创建无必要的编译任务。
  const notModified = await fixture('not-modified', false)
  await execute('UPDATE sources SET pending_url=NULL WHERE id=?', notModified.entityId)
  const infoBefore = await row('sources', notModified.entityId)
  fetchResponse = (_url, options) => {
    assert.equal(options.headers.get('If-None-Match'), 'old-etag')
    return new Response(null, { status: 304 })
  }
  assert.equal((await consume(notModified)).acks.length, 1)
  assert.equal((await row('sources', notModified.entityId)).upload_bytes, infoBefore.upload_bytes)
  assert.equal((await children(notModified)).length, 0)

  // 同一任务及同一源的并发投递不能同时刷新；活跃租约不消耗业务次数。
  const concurrent = await fixture('concurrent', false)
  let entered
  let complete
  const started = new Promise((resolve) => {
    entered = resolve
  })
  fetchResponse = () => {
    entered()
    return new Promise((resolve) => {
      complete = resolve
    })
  }
  const firstRun = consume(concurrent)
  await started
  assert.equal((await consume(concurrent, 2)).retries.length, 1)
  assert.equal((await row('jobs', concurrent.id)).attempts, 1)
  const sibling = await createJob(env, 'refresh_source', concurrent.entityId)
  assert.equal((await consume(sibling)).retries.length, 1)
  assert.equal((await row('jobs', sibling.id)).attempts, 0)
  complete(response())
  assert.equal((await firstRun).acks.length, 1)
  assert.equal((await consume(concurrent)).acks.length, 1)

  // 初始入队失败可恢复；崩溃租约过期也能重新投递，但不干扰活跃任务。
  sendFailure = () => true
  const unsent = await createJob(env, 'compile_profile', 'dispatch-profile-source')
  assert.equal((await row('jobs', unsent.id)).status, 'pending')
  assert.equal((await row('jobs', unsent.id)).dispatched_at, null)
  sendFailure = () => false
  await execute(
    "UPDATE jobs SET status='running',lease_token='crashed',lease_until=0,dispatched_at=1 WHERE id=?",
    sibling.id,
  )
  await execute(
    "UPDATE jobs SET status='running',lease_token='active',lease_until=?,dispatched_at=1 WHERE id=?",
    Date.now() + 1_000_000,
    concurrent.id,
  )
  const recoveryStart = sent.length
  await scheduledRecovery()
  const recovered = sent.slice(recoveryStart).map(({ jobId }) => jobId)
  assert.ok(recovered.includes(unsent.id))
  assert.ok(recovered.includes(sibling.id))
  assert.ok(!recovered.includes(concurrent.id))
  await execute("UPDATE jobs SET status='succeeded',lease_token=NULL,lease_until=NULL WHERE id=?", concurrent.id)
  fetchResponse = () => response()
  assert.equal((await consume(sibling)).acks.length, 1)

  // 直接编译的并发保护：两个基于同一旧 revision 的结果不能都覆盖成功。
  const profileId = 'dispatch-profile-source'
  const beforeRevision = (await row('profiles', profileId)).revision
  const compiled = await Promise.allSettled([compileProfile(env, profileId), compileProfile(env, profileId)])
  assert.equal(compiled.filter(({ status }) => status === 'fulfilled').length, 1)
  assert.equal((await row('profiles', profileId)).revision, beforeRevision + 1)

  // 排队编译的 YAML 和任务终态必须一起回滚，不能因终态写入失败而重复增加 revision。
  const atomicCompile = await createJob(env, 'compile_profile', profileId)
  const compileBefore = await row('profiles', profileId)
  failCompileFinish = true
  assert.equal((await consume(atomicCompile)).retries.length, 1)
  assert.deepEqual(await row('profiles', profileId), compileBefore)
  await releaseRetry(atomicCompile)
  assert.equal((await consume(atomicCompile, 2)).acks.length, 1)
  assert.equal((await row('profiles', profileId)).revision, compileBefore.revision + 1)
  assert.equal((await consume(atomicCompile, 3)).acks.length, 1)
  assert.equal((await row('profiles', profileId)).revision, compileBefore.revision + 1)

  // 编译期间用户保存了新设置：旧结果和任务成功状态必须同时不提交。
  const staleCompile = await createJob(env, 'compile_profile', profileId)
  const staleRevision = (await row('profiles', profileId)).revision
  beforeBatch = async (statements) => {
    if (statementSql.get(statements[0])?.includes('UPDATE profiles SET revision')) {
      beforeBatch = async () => {}
      await execute("UPDATE profiles SET name='latest settings',updated_at=updated_at+1 WHERE id=?", profileId)
    }
  }
  assert.equal((await consume(staleCompile)).retries.length, 1)
  assert.equal((await row('profiles', profileId)).revision, staleRevision)
  assert.equal((await row('profiles', profileId)).name, 'latest settings')
  assert.equal((await row('jobs', staleCompile.id)).status, 'pending')
  await releaseRetry(staleCompile)
  assert.equal((await consume(staleCompile, 2)).acks.length, 1)
  assert.equal((await row('profiles', profileId)).revision, staleRevision + 1)

  // 崩溃发生在最后一次业务尝试后，恢复应结束任务而不是继续执行第五次。
  const crashedFinal = await createJob(env, 'compile_profile', profileId)
  await execute(
    "UPDATE jobs SET status='running',attempts=?,lease_token='crashed',lease_until=0 WHERE id=?",
    MAX_JOB_ATTEMPTS,
    crashedFinal.id,
  )
  const crashRevision = (await row('profiles', profileId)).revision
  assert.equal((await consume(crashedFinal)).acks.length, 1)
  assert.equal((await row('jobs', crashedFinal.id)).status, 'failed')
  assert.equal((await row('profiles', profileId)).revision, crashRevision)

  // Queue 可能先消费完成，再发生分发时间戳写入失败；生产者不能覆盖已经成功的终态信息。
  beforeSend = async (message) => {
    beforeSend = async () => {}
    assert.equal((await consume({ id: message.jobId, type: message.type, entityId: message.entityId })).acks.length, 1)
  }
  const prepareBeforeFastConsumer = DB.prepare
  let failFastDispatch = true
  DB.prepare = (sql) => {
    if (failFastDispatch && sql.startsWith('update "jobs" set "dispatched_at"')) {
      failFastDispatch = false
      throw new Error('timestamp unavailable after consumption')
    }
    return prepareBeforeFastConsumer(sql)
  }
  const fastConsumer = await createJob(env, 'compile_profile', profileId)
  DB.prepare = prepareBeforeFastConsumer
  assert.equal((await row('jobs', fastConsumer.id)).status, 'succeeded')
  assert.equal((await row('jobs', fastConsumer.id)).error, null)

  // 清理旧节点不能删除仍被配置筛选/全局标签绑定/槽位标签绑定引用的标签。
  for (const id of ['filter-only', 'binding-only', 'slot-only'])
    await execute('INSERT INTO tags (id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,1,1)', id, id, id)
  await execute("INSERT INTO profile_tag_filters (profile_id,tag_id) VALUES (?,'filter-only')", profileId)
  await execute("UPDATE profile_node_binding SET mode='tag' WHERE profile_id=?", profileId)
  await execute("INSERT INTO profile_node_tags (profile_id,tag_id) VALUES (?,'binding-only')", profileId)
  await execute("INSERT INTO profile_slot_bindings (profile_id,slot_key,mode) VALUES (?,'test-slot','tag')", profileId)
  await execute(
    "INSERT INTO profile_slot_tags (profile_id,slot_key,tag_id) VALUES (?,'test-slot','slot-only')",
    profileId,
  )
  await cleanupOrphanPhysicalNodes(env)
  const referenceJob = await fixture('references', false)
  fetchResponse = () => response()
  assert.equal((await consume(referenceJob)).acks.length, 1)
  for (const id of ['filter-only', 'binding-only', 'slot-only']) assert.ok(await row('tags', id), id)
  for (const table of ['profile_tag_filters', 'profile_node_tags', 'profile_slot_tags'])
    assert.equal(
      (await DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE profile_id=?`).bind(profileId).first()).n,
      1,
      table,
    )

  // 实际 2000 节点边界仍是一个小批次，不以逐节点 SQL 绕过原子性。
  await clear()
  await source('large-source')
  const largeJob = await createJob(env, 'refresh_source', 'large-source')
  const many = Array.from({ length: 2000 }, (_, index) => ({
    ...configs[0],
    name: `node-${index}`,
    server: `node-${index}.example.com`,
  }))
  fetchResponse = () => response(many)
  assert.equal((await consume(largeJob)).acks.length, 1)
  assert.equal((await row('jobs', largeJob.id)).status, 'succeeded')
  assert.equal((await row('sources', 'large-source')).node_count, 2000)
  assert.ok(batches.filter((sql) => sql[0]?.includes('SET refresh_commit_token')).every((sql) => sql.length === 8))
  const largeBefore = await snapshot('large-source')
  const excessJob = await createJob(env, 'refresh_source', 'large-source')
  fetchResponse = () => response([...many, { ...configs[0], server: 'extra.example.com' }])
  assert.equal((await consume(excessJob)).acks.length, 1)
  assert.equal((await row('jobs', excessJob.id)).status, 'failed')
  assert.deepEqual(await snapshot('large-source'), largeBefore)

  // 全局节点数在下载期间增加时，事务内上限检查必须让所有语句一起不执行。
  await execute('DELETE FROM nodes WHERE id IN (SELECT id FROM nodes WHERE source_id=? LIMIT 1)', 'large-source')
  await execute('UPDATE sources SET node_count=1999 WHERE id=?', 'large-source')
  const racedLimit = await createJob(env, 'refresh_source', 'large-source')
  fetchResponse = async () => {
    const p = await DB.prepare('SELECT id FROM physical_nodes LIMIT 1').first()
    await execute(
      "INSERT INTO nodes (id,source_id,physical_node_id,original_name,enabled,position,created_at,updated_at) VALUES ('extra-manual','system-manual',?,'manual',1,0,1,1)",
      p.id,
    )
    return response(many)
  }
  assert.equal((await consume(racedLimit)).acks.length, 1)
  assert.equal((await row('jobs', racedLimit.id)).status, 'failed')
  assert.equal((await row('sources', 'large-source')).node_count, 1999)
  assert.equal((await row('jobs', racedLimit.id)).refresh_commit_token, null)
  console.log(
    `刷新/重试回归通过（${process.argv.includes('--d1') ? '本地 D1' : '事务 SQLite'}）：原子回滚、身份保留、持久化分发、错误分类/耗尽、304、并发/租约恢复与 2000 节点边界。`,
  )
} finally {
  globalThis.fetch = originalFetch
  await dispose()
}
