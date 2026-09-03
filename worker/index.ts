import { app } from './app'
import type { QueueMessage } from './db'
import { processQueueMessage } from './tasks'
import { syncRuleSetPresetCatalog } from './routes/rule-set-presets'
import { ensureLegacySourceSlotsMigrated } from './migrations/source-slots-migration'

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    await ensureLegacySourceSlotsMigrated(env)
    for (const message of batch.messages) await processQueueMessage(env, message.body)
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncRuleSetPresetCatalog(env))
  },
} satisfies ExportedHandler<Env, QueueMessage>
