import { asc, eq, inArray } from 'drizzle-orm'
import { nodes, profileNodeBinding, profileNodeNodes, profileNodeSources } from './db'
import { db } from './tasks'
import type { ProfileNodeBinding, ProfileNodeBindingInput } from './profile-slot-bindings'

export async function readProfileNodeBinding(env: Env, profileId: string): Promise<ProfileNodeBinding> {
  const [binding, sourceRows, nodeRows] = await Promise.all([
    db(env).select().from(profileNodeBinding).where(eq(profileNodeBinding.profileId, profileId)).get(),
    db(env).select().from(profileNodeSources).where(eq(profileNodeSources.profileId, profileId)),
    db(env)
      .select()
      .from(profileNodeNodes)
      .where(eq(profileNodeNodes.profileId, profileId))
      .orderBy(asc(profileNodeNodes.position)),
  ])
  if (!binding) throw new Error('配置缺少节点选择')
  if (binding.mode === 'source')
    return {
      mode: 'source',
      sourceIds: sourceRows.map(({ sourceId }) => sourceId),
      includeRegex: binding.includeRegex,
      excludeRegex: binding.excludeRegex,
    }

  const nodeIds = nodeRows.map(({ nodeId }) => nodeId)
  const existing = new Set<string>()
  for (let index = 0; index < nodeIds.length; index += 90) {
    const rows = await db(env)
      .select({ id: nodes.id })
      .from(nodes)
      .where(inArray(nodes.id, nodeIds.slice(index, index + 90)))
    for (const { id } of rows) existing.add(id)
  }
  return { mode: 'node', nodeIds, missingNodeIds: nodeIds.filter((id) => !existing.has(id)) }
}

export async function replaceProfileNodeBinding(env: Env, profileId: string, binding: ProfileNodeBindingInput) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM profile_node_binding WHERE profile_id = ?').bind(profileId),
    env.DB.prepare(
      'INSERT INTO profile_node_binding (profile_id, mode, include_regex, exclude_regex) VALUES (?, ?, ?, ?)',
    ).bind(
      profileId,
      binding.mode,
      binding.mode === 'source' ? binding.includeRegex : null,
      binding.mode === 'source' ? binding.excludeRegex : null,
    ),
    ...(binding.mode === 'source'
      ? binding.sourceIds.map((sourceId) =>
          env.DB.prepare('INSERT INTO profile_node_sources (profile_id, source_id) VALUES (?, ?)').bind(
            profileId,
            sourceId,
          ),
        )
      : binding.nodeIds.map((nodeId, position) =>
          env.DB.prepare('INSERT INTO profile_node_nodes (profile_id, node_id, position) VALUES (?, ?, ?)').bind(
            profileId,
            nodeId,
            position,
          ),
        )),
  ])
}
