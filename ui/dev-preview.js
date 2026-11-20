// Only used by the Vite development build when no host panel is present.
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
    metadata: { namespace: namespaces[index % namespaces.length] },
    status: {
      phase: index < 242 ? 'Running' : index < 250 ? 'Pending' : index < 260 ? 'Succeeded' : index < 265 ? 'Failed' : 'Unknown',
      containerStatuses: [{ restartCount: index < 12 ? 1 : 0 }],
    },
  }))
  const resources = new Map([
    ['/api/v1/nodes', { items: nodes }],
    ['/api/v1/pods', { items: pods }],
    ['/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups', { items: [] }],
  ])
  const response = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } })

  return {
    async k8sproxy(path) {
      if (!resources.has(path)) throw new Error(`本地预览未提供此资源：${path}`)
      return response(resources.get(path))
    },
    async panelProxy(path) {
      if (path.replace(/^\/+/, '') !== 'metrics/usage/normal') throw new Error(`本地预览未提供此接口：${path}`)
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
