import type { ProxyConfig } from '../../db'
export function parseHysteria2(input: string): ProxyConfig {
  const match = input.match(/^(?:hysteria2|hy2):\/\/(?:([^@/?#]*)@)?(\[[^\]]+\]|[^:/?#]+)(?::([^/?#]+))?(.*)$/i)
  if (!match) throw new Error('Hysteria2 链接格式无效')
  const [, auth, host, portText, suffix] = match
  if (portText && !/^(?:\d+|\d+-\d+|\d+(?:,\d+|,\d+-\d+)+)$/.test(portText)) throw new Error('端口无效')
  const valid =
    !portText ||
    portText.split(',').every((part) => {
      const [a, b = a] = part.split('-').map(Number)
      return Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b <= 65535 && a <= b
    })
  if (!valid) throw new Error('端口无效')
  const port = portText ? Number(portText.split(/[,-]/, 1)[0]) : 443
  const url = new URL(`hysteria2://${auth ? `${auth}@` : ''}${host}${suffix}`)
  const config: ProxyConfig = {
    name: decodeURIComponent(url.hash.slice(1)).trim() || `${url.hostname}:${port}`,
    type: 'hysteria2',
    server: url.hostname,
    port,
    udp: true,
    password: auth ? decodeURIComponent(auth) : url.searchParams.get('auth') || '',
    sni: url.searchParams.get('sni') || url.hostname,
    'skip-cert-verify': url.searchParams.get('insecure') === '1' || url.searchParams.get('insecure') === 'true',
  }
  if (portText && !/^\d+$/.test(portText)) config.ports = portText
  if (url.searchParams.get('obfs')) config.obfs = url.searchParams.get('obfs')
  if (url.searchParams.get('obfs-password')) config['obfs-password'] = url.searchParams.get('obfs-password')
  const pinSHA256 = url.searchParams.get('pinSHA256')
  if (pinSHA256) config.fingerprint = pinSHA256
  const ech = url.searchParams.get('ech')
  if (ech) config['ech-opts'] = { enable: true, config: ech }
  return config
}
