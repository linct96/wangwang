import { app } from './app'
import type { QueueMessage } from './db'
import { enqueueDueSources, processQueueMessage } from './tasks'
import { syncRuleSetPresetCatalog } from './routes/rule-set-presets'

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const message of batch.messages) await processQueueMessage(env, message.body)
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === '0 * * * *') ctx.waitUntil(enqueueDueSources(env, new Date(controller.scheduledTime)))
    if (controller.cron === '17 3 * * *') ctx.waitUntil(syncRuleSetPresetCatalog(env))
  },
} satisfies ExportedHandler<Env, QueueMessage>
