import { app } from './app'
import type { QueueMessage } from './db'
import { enqueueDueSources, processQueueMessage, recoverJobs } from './tasks'
import { syncRuleSetPresetCatalog } from './routes/rule-set-presets'

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const message of batch.messages) {
      if (!message.body || typeof message.body.jobId !== 'string' || !message.body.jobId) {
        console.error('丢弃无效任务消息')
        message.ack()
        continue
      }
      try {
        const delay = await processQueueMessage(env, message.body)
        if (delay === undefined) message.ack()
        else message.retry({ delaySeconds: delay })
      } catch (error) {
        // 状态持久化/认领失败不能 ack；即使平台投递耗尽，定时恢复仍可从数据库继续。
        console.error('任务消费失败', message.body.jobId, error)
        message.retry({ delaySeconds: 30 })
      }
    }
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === '0 * * * *') ctx.waitUntil(enqueueDueSources(env, new Date(controller.scheduledTime)))
    if (controller.cron === '*/5 * * * *') ctx.waitUntil(recoverJobs(env, new Date(controller.scheduledTime)))
    if (controller.cron === '17 3 * * *') ctx.waitUntil(syncRuleSetPresetCatalog(env))
  },
} satisfies ExportedHandler<Env, QueueMessage>
