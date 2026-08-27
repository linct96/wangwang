import { app } from './app'
import type { QueueMessage } from './db'
import { processQueueMessage } from './tasks'

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const message of batch.messages) await processQueueMessage(env, message.body)
  },
} satisfies ExportedHandler<Env, QueueMessage>
