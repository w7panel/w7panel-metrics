import { createDevPreview } from './dev-preview.js'

const preview = import.meta.env?.DEV ? createDevPreview() : null
const props = () => window.__POWERED_BY_WUJIE__ ? window.$wujie?.props || {} : window.microData?.cd || preview || {}

export function isDevPreview() {
  return Boolean(preview && !window.__POWERED_BY_WUJIE__ && !window.microData?.cd)
}

async function payload(response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.msg || body?.message || `请求失败 (${response.status})`)
  return body?.data ?? body
}

export async function panelGet(path) {
  const proxy = props().panelProxy
  if (typeof proxy !== 'function') throw new Error('面板未提供 panelProxy，请升级面板后重试')
  return payload(await proxy(path))
}

export async function k8sGet(path) {
  const proxy = props().k8sproxy
  if (typeof proxy !== 'function') throw new Error('面板未提供 Kubernetes 代理')
  return payload(await proxy(path))
}

export function appHandles() { return props().handles || {} }

export function pluginMenuUrl(group) { return `/appgroup/${encodeURIComponent(group)}/micro` }

export function normalizeIdentify(value) { return String(value || '').trim().toLowerCase().replaceAll('_', '-') }

export async function loadMarketPlugins() {
  if (isDevPreview()) return structuredClone(preview.marketPlugins)
  const response = await fetch('https://zm.w7.com/zpk-market/formula/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 1, limit: 500, tag: '监控插件' }),
  })
  const body = await payload(response)
  if (!Array.isArray(body?.list)) throw new Error('制品市场返回的监控插件列表格式不正确')
  return body.list.filter(item => item.application_type === 'metrics-plugin')
}

export function pluginRows(market, groups) {
  const identify = group => normalizeIdentify(group.spec?.identifie || group.metadata?.annotations?.['w7.cc/identifie'] || group.metadata?.name)
  const installed = new Map(groups.map(group => [identify(group), group]))
  const marketIds = new Set(market.map(item => normalizeIdentify(item.identify)))
  return [
    ...market.map(item => ({ ...item, appGroup: installed.get(normalizeIdentify(item.identify)) || null })),
    ...groups.filter(group => {
      const type = group?.metadata?.labels?.['w7.cc/manifest-type'] || group?.metadata?.annotations?.['w7.cc/manifest-type']
      return type === 'metrics-plugin' && !marketIds.has(identify(group))
    }).map(group => ({
      identify: identify(group),
      name: group.spec?.title || group.metadata?.name,
      description: '',
      latest_version: group.spec?.version || '',
      appGroup: group,
    })),
  ]
}

export async function pluginUpgrades(rows, check) {
  if (typeof check !== 'function') return {}
  const entries = await Promise.all(rows.filter(row => row.appGroup).map(async row => {
    const name = row.appGroup.metadata.name
    try { return [name, await check({ appIdentify: name, silent: true })] }
    catch { return [name, null] }
  }))
  return Object.fromEntries(entries.filter(([, info]) => info?.canUpgrade))
}
