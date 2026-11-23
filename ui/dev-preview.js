// Only used by the Vite development build when no host panel is present.
import { METRIC_GROUPS, groupQuery } from './monitoring.js'

export function createDevPreview() {
  const nodes = Array.from({ length: 8 }, (_, index) => ({
    metadata: {
      name: index ? `demo-worker-${String(index).padStart(2, '0')}` : 'demo-control-plane',
      labels: index ? {} : { 'node-role.kubernetes.io/control-plane': 'true' },
    },
    status: {
      conditions: [{ type: 'Ready', status: index === 7 ? 'False' : 'True' }],
      addresses: [{ type: 'InternalIP', address: `10.0.1.${index + 10}` }],
      nodeInfo: { kubeletVersion: 'v1.31.5+k3s1' },
    },
  }))
  const namespaces = ['production', 'kube-system', 'monitoring', 'default', 'ingress-system', 'services']
  const pods = Array.from({ length: 268 }, (_, index) => ({
    metadata: { name: `demo-app-${String(index).padStart(3, '0')}`, namespace: namespaces[index % namespaces.length] },
    spec: { nodeName: nodes[index % nodes.length].metadata.name },
    status: {
      phase: index < 242 ? 'Running' : index < 250 ? 'Pending' : index < 260 ? 'Succeeded' : index < 265 ? 'Failed' : 'Unknown',
      conditions: [{ type: 'Ready', status: index < 242 && index !== 3 ? 'True' : 'False' }],
      containerStatuses: [{
        restartCount: index < 12 ? 1 : 0,
        state: index === 3 ? { waiting: { reason: 'CrashLoopBackOff' } } : index >= 242 && index < 250 ? { waiting: { reason: 'ContainerCreating' } } : {},
        lastState: index === 2 ? { terminated: { reason: 'OOMKilled' } } : {},
      }],
    },
  }))
  const resources = new Map([
    ['/api/v1/nodes', { items: nodes }],
    ['/api/v1/pods', { items: pods }],
    ['/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups', { items: [] }],
  ])
  const response = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } })

  function metricPreview(params) {
    const group = Object.keys(METRIC_GROUPS).find(group => groupQuery(group) === params.get('query'))
    if (!group) throw new Error('本地预览未提供此指标查询')
    const start = Number(params.get('start')), end = Number(params.get('end')), step = Number(params.get('step'))
    const result = [], gib = 1073741824
    function add(field, labels, value, offset = 0, stop = end) {
      const values = []
      for (let time = start; time <= stop; time += step) {
        const factor = start === end ? 1 : 0.88 + Math.sin(time / 900 + offset) * 0.12
        values.push([time, String(value * factor)])
      }
      if (values.length) result.push({ metric: { ...labels, dashboard_metric: field }, values })
    }
    if (group === 'nodes') nodes.forEach((node, index) => {
      const cpu = 0.2 + index * 0.1, memory = 0.3 + index * 0.085
      const cpuCores = [8, 4, 8, 16, 4, 8, 16, 8][index], memoryGiB = [16, 8, 16, 32, 8, 16, 16, 16][index]
      const values = { cpu, memory, cpuUsed: cpu * cpuCores, memoryUsed: memory * memoryGiB * gib, diskRead: (index + 1) * 1024 ** 2, diskWrite: (index + 1) * 2 * 1024 ** 2, ioLatency: 1.2 + index, networkReceive: (index + 1) * 3 * 1024 ** 2, networkTransmit: (index + 1) * 1024 ** 2 }
      Object.entries(values).forEach(([field, value]) => add(field, { instance: `${node.status.addresses[0].address}:9100` }, value, index, index === 7 ? end - 1800 : end))
    })
    if (group === 'pods') pods.slice(0, 24).forEach((pod, index) => {
      const labels = { namespace: pod.metadata.namespace, pod: pod.metadata.name }
      add('cpu', labels, (24 - index) * 0.087)
      add('memory', labels, (index + 1) * 64 * 1024 ** 2)
      if (index !== 4) add('throttling', labels, index % 3 ? index / 100 : 0)
    })
    if (group === 'filesystems') nodes.slice(0, 7).forEach((node, index) => {
      const labels = { instance: `${node.status.addresses[0].address}:9100`, device: '/dev/sda1', mountpoint: '/' }
      add('capacity', labels, 200 * gib)
      add('available', labels, (index === 0 ? 9 : 130 - index * 10) * gib)
      add('inodes', labels, index === 1 ? 0.96 : 0.1 + index * 0.06)
    })
    if (group === 'volumes') ['database-data', 'registry-data', 'cache-data'].forEach((name, index) => {
      const labels = { namespace: index === 1 ? 'default' : 'production', persistentvolumeclaim: name }
      add('capacity', labels, 100 * gib)
      add('used', labels, [94, 70, 0][index] * gib)
      add('available', labels, [6, 30, 100][index] * gib)
      add('inodes', labels, [0.96, 0.12, 0][index])
    })
    if (group === 'api') Object.entries({ requests: 86, errors: 0.002, p95: 64, p99: 160 }).forEach(([field, value]) => add(field, {}, value))
    return { resultType: 'matrix', result }
  }

  return {
    async k8sproxy(path) {
      if (!resources.has(path)) throw new Error(`本地预览未提供此资源：${path}`)
      return response(resources.get(path))
    },
    async panelProxy(path) {
      const url = new URL(path.replace(/^\/+/, ''), 'http://preview.local/')
      if (url.pathname === '/metrics/query-range') return response(metricPreview(url.searchParams))
      if (url.pathname !== '/metrics/usage/normal') throw new Error(`本地预览未提供此接口：${path}`)
      return response({
        cpu: { usage: 24800, total: 72000 },
        memory: { usage: 54 * 1073741824, total: 128 * 1073741824 },
      })
    },
    marketPlugins: [
      { identify: 'metrics-traffic', name: '流量监测', description: '本地示例：查看网关请求量、访问流量与状态码分布。', latest_version: '1.2.0' },
      { identify: 'metrics-audit', name: '审计日志', description: '本地示例：检索集群操作记录与资源变更。', latest_version: '1.0.3' },
      { identify: 'metrics-alert', name: '告警通知', description: '本地示例：管理指标告警与通知渠道。', latest_version: '1.1.0' },
    ],
  }
}
