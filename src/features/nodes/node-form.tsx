import type { InputHTMLAttributes } from 'react'
import type { ManualNodeConnection } from '@/api/types'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Checkbox } from '@/components/ui/checkbox'
import '@/styles/nodes.css'

const protocols = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic']

export function defaultConnection(protocol: ManualNodeConnection['protocol'] = 'vless'): ManualNodeConnection {
  return {
    name: '',
    protocol,
    server: '',
    port: 443,
    network: 'tcp',
    security: ['vless', 'trojan'].includes(protocol) ? 'tls' : 'none',
    wsPath: '/',
    alterId: 0,
    cipher: protocol === 'ss' ? 'aes-128-gcm' : 'auto',
    pluginOptions: {},
    congestionController: 'bbr',
    udpRelayMode: 'native',
    skipCertVerify: false,
  }
}

export function ConnectionTextField({
  id,
  label,
  value,
  onChange,
  type,
  ...props
}: {
  id: string
  label: string
  value: string | number
  onChange: (value: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange'>) {
  const Component = type === 'password' ? PasswordInput : Input
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Component id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} {...props} />
    </Field>
  )
}

export function ManualConnectionFields({
  value,
  onChange,
}: {
  value: ManualNodeConnection
  onChange: (value: ManualNodeConnection) => void
}) {
  const update = (patch: Partial<ManualNodeConnection>) => onChange({ ...value, ...patch })
  const transportProtocol = ['vmess', 'vless', 'trojan'].includes(value.protocol)
  const tlsProtocol = ['vmess', 'vless', 'trojan'].includes(value.protocol)
  const secretPlaceholder = (set?: boolean) => (set ? '已设置，留空保持不变' : '')
  return (
    <FieldGroup className="node-form-scope">
      <Field>
        <FieldLabel>协议</FieldLabel>
        <Select
          value={value.protocol}
          onValueChange={(protocol) => {
            const next = defaultConnection(protocol as ManualNodeConnection['protocol'])
            onChange({ ...next, name: value.name, server: value.server, port: value.port })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {protocols.map((protocol) => (
                <SelectItem key={protocol} value={protocol}>
                  {protocol}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <div className="form-grid">
        <ConnectionTextField
          id="manual-name"
          label="节点名称"
          value={value.name}
          onChange={(name) => update({ name })}
        />
        <ConnectionTextField
          id="manual-server"
          label="服务器"
          value={value.server}
          onChange={(server) => update({ server })}
        />
        <ConnectionTextField
          id="manual-port"
          label="端口"
          type="number"
          value={value.port}
          onChange={(port) => update({ port: Number(port) })}
        />
      </div>

      {value.protocol === 'ss' && (
        <>
          <ConnectionTextField
            id="manual-cipher"
            label="加密方式"
            value={value.cipher || ''}
            onChange={(cipher) => update({ cipher })}
          />
          <ConnectionTextField
            id="manual-password"
            label="密码"
            type="password"
            value={value.password || ''}
            placeholder={secretPlaceholder(value.hasPassword)}
            onChange={(password) => update({ password })}
          />
          <ConnectionTextField
            id="manual-plugin"
            label="插件（可选）"
            value={value.plugin || ''}
            onChange={(plugin) => update({ plugin })}
          />
          {value.plugin && (
            <ConnectionTextField
              id="manual-plugin-options"
              label="插件参数"
              value={Object.entries(value.pluginOptions || {})
                .map(([key, item]) => `${key}=${item}`)
                .join('; ')}
              placeholder="mode=websocket; host=example.com"
              onChange={(text) =>
                update({
                  pluginOptions: Object.fromEntries(
                    text
                      .split(';')
                      .map((item) => item.trim().split('=', 2))
                      .filter(([key, item]) => key && item !== undefined),
                  ),
                })
              }
            />
          )}
        </>
      )}

      {['vmess', 'vless', 'tuic'].includes(value.protocol) && (
        <ConnectionTextField
          id="manual-uuid"
          label="UUID"
          type="password"
          value={value.uuid || ''}
          placeholder={secretPlaceholder(value.hasUuid)}
          onChange={(uuid) => update({ uuid })}
        />
      )}
      {['trojan', 'hysteria2', 'tuic'].includes(value.protocol) && (
        <ConnectionTextField
          id="manual-protocol-password"
          label="密码"
          type="password"
          value={value.password || ''}
          placeholder={secretPlaceholder(value.hasPassword)}
          onChange={(password) => update({ password })}
        />
      )}
      {value.protocol === 'vmess' && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-alter-id"
            label="Alter ID"
            type="number"
            min={0}
            value={value.alterId || 0}
            onChange={(alterId) => update({ alterId: Number(alterId) })}
          />
          <ConnectionTextField
            id="manual-vmess-cipher"
            label="加密方式"
            value={value.cipher || 'auto'}
            onChange={(cipher) => update({ cipher })}
          />
        </div>
      )}
      {value.protocol === 'vless' && (
        <ConnectionTextField
          id="manual-flow"
          label="Flow（可选）"
          value={value.flow || ''}
          onChange={(flow) => update({ flow })}
        />
      )}

      {transportProtocol && (
        <Field>
          <FieldLabel>传输方式</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={value.network || 'tcp'}
            onValueChange={(network) => network && update({ network: network as 'tcp' | 'ws' | 'grpc' })}
          >
            <ToggleGroupItem value="tcp">TCP</ToggleGroupItem>
            <ToggleGroupItem value="ws">WebSocket</ToggleGroupItem>
            <ToggleGroupItem value="grpc">gRPC</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      )}
      {value.network === 'ws' && transportProtocol && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-ws-path"
            label="WS Path"
            value={value.wsPath || '/'}
            onChange={(wsPath) => update({ wsPath })}
          />
          <ConnectionTextField
            id="manual-ws-host"
            label="WS Host（可选）"
            value={value.wsHost || ''}
            onChange={(wsHost) => update({ wsHost })}
          />
        </div>
      )}
      {value.network === 'grpc' && transportProtocol && (
        <ConnectionTextField
          id="manual-grpc-service"
          label="gRPC Service Name"
          value={value.grpcServiceName || ''}
          onChange={(grpcServiceName) => update({ grpcServiceName })}
        />
      )}

      {tlsProtocol && (
        <Field>
          <FieldLabel>传输安全</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={value.security || 'none'}
            onValueChange={(security) => security && update({ security: security as ManualNodeConnection['security'] })}
          >
            <ToggleGroupItem value="none">无</ToggleGroupItem>
            <ToggleGroupItem value="tls">TLS</ToggleGroupItem>
            {value.protocol !== 'vmess' && <ToggleGroupItem value="reality">Reality</ToggleGroupItem>}
          </ToggleGroup>
        </Field>
      )}
      {value.security !== 'none' && tlsProtocol && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-sni"
            label="SNI（可选）"
            value={value.sni || ''}
            onChange={(sni) => update({ sni })}
          />
          <ConnectionTextField
            id="manual-fingerprint"
            label="客户端指纹（可选）"
            value={value.clientFingerprint || ''}
            onChange={(clientFingerprint) => update({ clientFingerprint })}
          />
        </div>
      )}
      {value.security === 'reality' && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-reality-key"
            label="Reality 公钥"
            value={value.realityPublicKey || ''}
            onChange={(realityPublicKey) => update({ realityPublicKey })}
          />
          <ConnectionTextField
            id="manual-reality-short-id"
            label="Reality Short ID（可选）"
            value={value.realityShortId || ''}
            onChange={(realityShortId) => update({ realityShortId })}
          />
        </div>
      )}

      {value.protocol === 'hysteria2' && (
        <>
          <ConnectionTextField
            id="manual-hy2-sni"
            label="SNI（可选）"
            value={value.sni || ''}
            onChange={(sni) => update({ sni })}
          />
          <div className="form-grid">
            <ConnectionTextField
              id="manual-obfs"
              label="混淆类型（可选）"
              value={value.obfs || ''}
              onChange={(obfs) => update({ obfs })}
            />
            <ConnectionTextField
              id="manual-obfs-password"
              label="混淆密码（可选）"
              type="password"
              value={value.obfsPassword || ''}
              placeholder={secretPlaceholder(value.hasObfsPassword)}
              onChange={(obfsPassword) => update({ obfsPassword })}
            />
          </div>
        </>
      )}
      {value.protocol === 'tuic' && (
        <div className="form-grid">
          <ConnectionTextField
            id="manual-tuic-sni"
            label="SNI（可选）"
            value={value.sni || ''}
            onChange={(sni) => update({ sni })}
          />
          <ConnectionTextField
            id="manual-congestion"
            label="拥塞控制"
            value={value.congestionController || 'bbr'}
            onChange={(congestionController) => update({ congestionController })}
          />
          <ConnectionTextField
            id="manual-udp-relay"
            label="UDP Relay 模式"
            value={value.udpRelayMode || 'native'}
            onChange={(udpRelayMode) => update({ udpRelayMode })}
          />
        </div>
      )}
      {['hysteria2', 'tuic'].includes(value.protocol) && (
        <Field orientation="horizontal">
          <Checkbox
            id="manual-skip-cert"
            checked={value.skipCertVerify || false}
            onCheckedChange={(checked) => update({ skipCertVerify: checked === true })}
          />
          <FieldLabel htmlFor="manual-skip-cert">跳过证书验证</FieldLabel>
        </Field>
      )}
    </FieldGroup>
  )
}
