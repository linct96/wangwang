import { useState } from 'react'
import { Smile } from 'lucide-react'
import { toast } from 'sonner'
import { AppDialog } from '@/components/app-primitives'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { newGroup } from '../yaml-adapter'
import {
  memberLabel,
  type ProxyGroupDraft,
  type StructuredProxyGroupDraft,
  type SupportedLoadBalanceStrategy,
  type SupportedProxyGroupType,
} from '../model'
import { MemberEditor } from './member-editor'

const EMOJI_PREFIX_REGEX = /^(\p{Extended_Pictographic}|\p{Regional_Indicator}{2})\s*/u

export function ProxyGroupIconPicker({ onSelect }: { onSelect: (icon: string) => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'common' | 'region' | 'service'>('common')

  const iconGroups = {
    common: [
      { icon: '🚀', label: '节点选择' },
      { icon: '⚡', label: '自动选择' },
      { icon: '🎯', label: '全球直连' },
      { icon: '🛑', label: '全球拦截' },
      { icon: '🐟', label: '漏网之鱼' },
      { icon: '🛡️', label: '广告拦截' },
      { icon: '🪜', label: '科学上网' },
      { icon: '🌐', label: '国际流量' },
      { icon: '⚖️', label: '负载均衡' },
      { icon: '♻️', label: '故障转移' },
      { icon: '🔄', label: '自动回退' },
      { icon: '🔒', label: '隐私保护' },
      { icon: '🧭', label: '导航' },
      { icon: '⚓', label: '锚点' },
      { icon: '🚩', label: '标旗' },
      { icon: '🔮', label: '特殊' },
      { icon: '🕹️', label: '控制' },
      { icon: '⚙️', label: '设置' },
    ],
    region: [
      { icon: '🇭🇰', label: '香港' },
      { icon: '🇹🇼', label: '台湾' },
      { icon: '🇯🇵', label: '日本' },
      { icon: '🇸🇬', label: '新加坡' },
      { icon: '🇺🇸', label: '美国' },
      { icon: '🇰🇷', label: '韩国' },
      { icon: '🇬🇧', label: '英国' },
      { icon: '🇩🇪', label: '德国' },
      { icon: '🇫🇷', label: '法国' },
      { icon: '🇨🇦', label: '加拿大' },
      { icon: '🇦🇺', label: '澳大利亚' },
      { icon: '🇷🇺', label: '俄罗斯' },
      { icon: '🇮🇳', label: '印度' },
      { icon: '🇲🇾', label: '马来西亚' },
      { icon: '🇹🇭', label: '泰国' },
      { icon: '🇻🇳', label: '越南' },
      { icon: '🇵🇭', label: '菲律宾' },
      { icon: '🇧🇷', label: '巴西' },
      { icon: '🇦🇷', label: '阿根廷' },
      { icon: '🇹🇷', label: '土耳其' },
      { icon: '🇨🇳', label: '中国' },
      { icon: '🇪🇺', label: '欧洲' },
      { icon: '🌏', label: '亚太' },
      { icon: '🌎', label: '美洲' },
    ],
    service: [
      { icon: '🤖', label: 'AI/ChatGPT' },
      { icon: '🧠', label: 'OpenAI' },
      { icon: '📺', label: '奈飞/Netflix' },
      { icon: '🎬', label: '流媒体' },
      { icon: '🍿', label: '影视' },
      { icon: '🎵', label: '音乐/Spotify' },
      { icon: '✈️', label: '电报/Telegram' },
      { icon: '💬', label: '聊天' },
      { icon: '🎮', label: '游戏/Steam' },
      { icon: '🍎', label: 'Apple' },
      { icon: 'Ⓜ️', label: 'Microsoft' },
      { icon: '🔍', label: 'Google' },
      { icon: '🐱', label: 'GitHub' },
      { icon: '📦', label: 'Docker' },
      { icon: '📧', label: '邮件' },
      { icon: '📰', label: '新闻' },
      { icon: '🛒', label: '购物' },
      { icon: '💳', label: '支付' },
    ],
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="default"
          className="px-2.5 shrink-0 text-muted-foreground hover:text-foreground"
          title="选择图标"
        >
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2.5">
        <div className="flex items-center justify-between gap-1 mb-2 border-b border-border pb-1.5">
          <span className="text-xs font-medium text-foreground">常用图标</span>
          <div className="flex gap-1">
            {(
              [
                ['common', '常用'],
                ['region', '地区'],
                ['service', '服务'],
              ] as const
            ).map(([key, name]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  'px-1.5 py-0.5 text-xs rounded transition-colors',
                  tab === key ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-6 gap-1 max-h-48 overflow-y-auto p-0.5">
          {iconGroups[tab].map((item) => (
            <button
              key={item.icon + item.label}
              type="button"
              title={item.label}
              className="flex items-center justify-center size-8 rounded text-base hover:bg-accent transition-colors active:scale-95 cursor-pointer"
              onClick={() => {
                onSelect(item.icon)
                setOpen(false)
              }}
            >
              {item.icon}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function GroupDialog({
  groups,
  value,
  onSave,
  children,
}: {
  groups: ProxyGroupDraft[]
  value?: StructuredProxyGroupDraft
  onSave: (group: StructuredProxyGroupDraft) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<StructuredProxyGroupDraft>(() => value || newGroup('select', groups))

  function show() {
    setForm(value || newGroup('select', groups))
    setOpen(true)
  }

  function handleSelectIcon(icon: string) {
    if (EMOJI_PREFIX_REGEX.test(form.name)) {
      setForm({ ...form, name: form.name.replace(EMOJI_PREFIX_REGEX, `${icon} `) })
    } else if (form.name.trim()) {
      setForm({ ...form, name: `${icon} ${form.name.trim()}` })
    } else {
      setForm({ ...form, name: `${icon} ` })
    }
  }

  function save() {
    if (!form.name.trim() || groups.some((group) => group.id !== value?.id && group.name === form.name.trim())) {
      toast.error('代理组名称不能为空且不能重复')
      return
    }
    if (form.type !== 'select' && !form.url?.trim()) {
      toast.error('测试 URL 不能为空')
      return
    }
    onSave({ ...form, name: form.name.trim() })
    setOpen(false)
  }
  return (
    <>
      <span
        onClick={(e) => {
          e.stopPropagation()
          show()
        }}
      >
        {children}
      </span>
      {open && (
        <AppDialog
          title={value ? '编辑代理组' : '添加代理组'}
          contentClassName="template-dialog"
          onClose={() => setOpen(false)}
        >
          <FieldGroup className="gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel>名称 (name)</FieldLabel>
                <div className="flex gap-1.5 items-center">
                  <ProxyGroupIconPicker onSelect={handleSelectIcon} />
                  <Input
                    value={form.name}
                    placeholder="例如：🚀 节点选择"
                    className="flex-1 min-w-0"
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </div>
              </Field>
              <Field>
                <FieldLabel>类型 (type)</FieldLabel>
                <Select
                  value={form.type}
                  onValueChange={(type: SupportedProxyGroupType) =>
                    setForm({
                      ...form,
                      type,
                      ...(type === 'select'
                        ? { url: undefined, interval: undefined, tolerance: undefined, strategy: undefined }
                        : {
                            url: form.url || 'https://www.gstatic.com/generate_204',
                            interval: form.interval || 300,
                            defaultSelected: undefined,
                          }),
                      ...(type !== 'url-test' ? { tolerance: undefined } : { tolerance: form.tolerance ?? 50 }),
                      ...(type !== 'load-balance'
                        ? { strategy: undefined }
                        : { strategy: form.strategy || 'consistent-hashing' }),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="select">select (手动选择)</SelectItem>
                    <SelectItem value="url-test">url-test (自动测速)</SelectItem>
                    <SelectItem value="fallback">fallback (故障转移)</SelectItem>
                    <SelectItem value="load-balance">load-balance (负载均衡)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {form.type === 'select' && (
              <Field>
                <FieldLabel>默认节点 (default-selected)</FieldLabel>
                <Select
                  value={form.defaultSelected || '__first__'}
                  onValueChange={(defaultSelected) =>
                    setForm({
                      ...form,
                      defaultSelected: defaultSelected === '__first__' ? undefined : defaultSelected,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__first__">第一个节点（默认）</SelectItem>
                    <SelectGroup>
                      {form.members.map((member, index) => {
                        if (member.kind === 'all-proxies') return null
                        const label = memberLabel(member, groups)
                        return (
                          <SelectItem key={`${label}-${index}`} value={label}>
                            {label}
                          </SelectItem>
                        )
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel>节点筛选 (filter)</FieldLabel>
                <Input
                  value={form.filter || ''}
                  placeholder="例如：(?i)港|hk"
                  onChange={(event) => setForm({ ...form, filter: event.target.value || undefined })}
                />
              </Field>
              <Field>
                <FieldLabel>排除筛选 (exclude-filter)</FieldLabel>
                <Input
                  value={form.excludeFilter || ''}
                  placeholder="例如：美国|日本"
                  onChange={(event) => setForm({ ...form, excludeFilter: event.target.value || undefined })}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              仅对“全部节点”或来源引入的节点生效，支持用反引号分隔多个正则。
            </p>
            {form.type !== 'select' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field className={cn(form.type === 'url-test' || form.type === 'load-balance' ? 'sm:col-span-2' : '')}>
                  <FieldLabel>测试 URL (url)</FieldLabel>
                  <Input
                    value={form.url || ''}
                    placeholder="https://www.gstatic.com/generate_204"
                    onChange={(event) => setForm({ ...form, url: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel>检测间隔 (interval，秒)</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    value={form.interval ?? 300}
                    onChange={(event) => setForm({ ...form, interval: Number(event.target.value) })}
                  />
                </Field>
                {form.type === 'url-test' && (
                  <Field>
                    <FieldLabel>容差 (tolerance，毫秒)</FieldLabel>
                    <Input
                      type="number"
                      min={0}
                      value={form.tolerance ?? 50}
                      onChange={(event) => setForm({ ...form, tolerance: Number(event.target.value) })}
                    />
                  </Field>
                )}
                {form.type === 'load-balance' && (
                  <Field>
                    <FieldLabel>均衡策略 (strategy)</FieldLabel>
                    <Select
                      value={form.strategy || 'consistent-hashing'}
                      onValueChange={(strategy: SupportedLoadBalanceStrategy) => setForm({ ...form, strategy })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="consistent-hashing">consistent-hashing (一致性哈希)</SelectItem>
                        <SelectItem value="round-robin">round-robin (轮询)</SelectItem>
                        <SelectItem value="sticky-sessions">sticky-sessions (会话保持)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
            )}
            <MemberEditor form={form} groups={groups} onChange={setForm} />
          </FieldGroup>
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={save}>
              保存
            </Button>
          </div>
        </AppDialog>
      )}
    </>
  )
}
