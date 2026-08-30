import { app } from './app'
import type { QueueMessage } from './db'
import { processQueueMessage } from './tasks'
import { syncRuleSetPresetCatalog } from './routes/rule-set-presets'

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const message of batch.messages) await processQueueMessage(env, message.body)
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncRuleSetPresetCatalog(env))
  },
} satisfies ExportedHandler<Env, QueueMessage>
