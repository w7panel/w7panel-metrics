const host = 'by (instance, node)'
const disks = 'device!~"loop.*|ram.*|fd.*|sr.*|dm-.*"'
const interfaces = 'device!~"lo|veth.*|lxc.*|cilium.*|docker.*|br-.*|flannel.*"'
const filesystems = 'fstype!~"tmpfs|overlay|squashfs|nsfs|rootfs",mountpoint!~"/run($|/.*)|/var/lib/(kubelet|docker)/.*"'
const containers = 'metrics_path="/metrics/cadvisor",container!="",container!="POD",pod!=""'
const apiRequests = 'sum(rate(apiserver_request_total[5m]))'
const apiLatency = 'sum by (le) (rate(apiserver_request_duration_seconds_bucket{verb!~"WATCH|CONNECT"}[5m]))'

export const METRIC_GROUPS = {
  nodes: {
    history: true,
    queries: {
      cpu: `1 - avg ${host} (rate(node_cpu_seconds_total{mode="idle"}[5m]))`,
      memory: `1 - max ${host} (node_memory_MemAvailable_bytes) / (max ${host} (node_memory_MemTotal_bytes) > 0)`,
      cpuUsed: `sum ${host} (1 - rate(node_cpu_seconds_total{mode="idle"}[5m]))`,
      memoryUsed: `max ${host} (node_memory_MemTotal_bytes) - max ${host} (node_memory_MemAvailable_bytes)`,
      diskRead: `sum ${host} (rate(node_disk_read_bytes_total{${disks}}[5m]))`,
      diskWrite: `sum ${host} (rate(node_disk_written_bytes_total{${disks}}[5m]))`,
      ioLatency: `1000 * sum ${host} (rate(node_disk_read_time_seconds_total{${disks}}[5m]) + rate(node_disk_write_time_seconds_total{${disks}}[5m])) / (sum ${host} (rate(node_disk_reads_completed_total{${disks}}[5m]) + rate(node_disk_writes_completed_total{${disks}}[5m])) > 0)`,
      networkReceive: `sum ${host} (rate(node_network_receive_bytes_total{${interfaces}}[5m]))`,
      networkTransmit: `sum ${host} (rate(node_network_transmit_bytes_total{${interfaces}}[5m]))`,
    },
  },
  pods: {
    queries: {
      cpu: `sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{${containers}}[5m]))`,
      memory: `sum by (namespace, pod) (container_memory_working_set_bytes{${containers}})`,
      throttling: `sum by (namespace, pod) (rate(container_cpu_cfs_throttled_periods_total{${containers}}[5m])) / (sum by (namespace, pod) (rate(container_cpu_cfs_periods_total{${containers}}[5m])) > 0)`,
    },
  },
  filesystems: {
    queries: {
      capacity: `max by (instance, node, device, mountpoint) (node_filesystem_size_bytes{${filesystems}} > 0)`,
      available: `max by (instance, node, device, mountpoint) (node_filesystem_avail_bytes{${filesystems}})`,
      inodes: `1 - max by (instance, node, device, mountpoint) (node_filesystem_files_free{${filesystems}}) / (max by (instance, node, device, mountpoint) (node_filesystem_files{${filesystems}}) > 0)`,
    },
  },
  api: {
    history: true,
    queries: {
      requests: apiRequests,
      errors: `(sum(rate(apiserver_request_total{code=~"5.."}[5m])) or (0 * ${apiRequests})) / (${apiRequests} > 0)`,
      p95: `1000 * histogram_quantile(0.95, ${apiLatency})`,
      p99: `1000 * histogram_quantile(0.99, ${apiLatency})`,
    },
  },
}

// Keep identities from each query while distinguishing metric families in one request.
export function groupQuery(group) {
  return Object.entries(METRIC_GROUPS[group].queries).map(([name, query]) => (
    `label_replace((${query}), "dashboard_metric", "${name}", "", "")`
  )).join(' or ')
}

export function rangeBounds(end, duration, requestedStep) {
  const step = requestedStep ?? (duration <= 3600 ? 60 : duration <= 21600 ? 300 : 600)
  const alignedEnd = Math.floor(end / step) * step
  const alignedStart = Math.floor((end - duration) / step) * step
  return { start: alignedStart, end: alignedEnd, step }
}

export function selectedTimeRange(values, now = Date.now()) {
  if (!Array.isArray(values) || values.length !== 2 || values.some(value => value == null || value === '')) throw new Error('请选择完整的时间范围')
  const [start, end] = values.map(value => {
    const date = typeof value === 'string' ? value.replace(' ', 'T') : value
    return Math.floor(new Date(date).getTime() / 1000)
  })
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('开始时间必须早于结束时间')
  const current = Math.floor(now / 1000)
  if (end > current) throw new Error('结束时间不能晚于当前时间')
  if (start < current - 86400) throw new Error('指标保留 1 天，请选择最近 24 小时内的时间范围')
  return { start, end, duration: end - start }
}

export function queryPath(group, { end = Math.floor(Date.now() / 1000), duration = 3600, historyEnd = end, step, history = METRIC_GROUPS[group].history } = {}) {
  // VictoriaMetrics rounds range queries for caching. Snapshots use a single point
  // so the selected history resolution cannot make current readings stale.
  const range = history ? rangeBounds(historyEnd, duration, step) : { start: end, end, step: 60 }
  const params = new URLSearchParams({
    query: groupQuery(group), start: String(range.start), end: String(range.end), step: String(range.step),
  })
  return `metrics/query-range?${params}`
}

export async function loadMetricGroups(get, { include = Object.keys(METRIC_GROUPS), ...options } = {}) {
  const requests = Object.entries(METRIC_GROUPS).filter(([group]) => include.includes(group)).flatMap(([group, definition]) => [
    { group, history: false }, ...(definition.history ? [{ group, history: true }] : []),
  ])
  const results = await Promise.allSettled(requests.map(async request => (
    extractSeries(await get(queryPath(request.group, { ...options, history: request.history })))
  )))
  const groups = {}, history = {}, errors = {}
  results.forEach((result, index) => {
    const request = requests[index]
    if (result.status === 'fulfilled') (request.history ? history : groups)[request.group] = result.value
    else errors[request.group + (request.history ? 'History' : '')] = result.reason?.message || '请求失败'
  })
  return { groups, history, errors }
}

export function extractSeries(body) {
  if (body?.status === 'error') throw new Error(body.error || '指标查询失败')
  const data = body?.data ?? body
  if (!Array.isArray(data?.result)) throw new Error('指标接口返回格式不正确，请检查面板版本')
  return data.result.map(series => ({
    labels: series.metric || {},
    points: (series.values || (series.value ? [series.value] : [])).map(([time, value]) => [Number(time), finite(value)]),
  }))
}

export function finite(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function currentValue(series, end) {
  const last = series.points.at(-1)
  // Historical samples must not be presented as the current value of a disappeared target.
  return last && Math.abs(last[0] - end) <= 1 ? last[1] : null
}

export function nodeName(labels, nodes = []) {
  const instance = labels.instance || ''
  const address = instance.replace(/^https?:\/\//, '').replace(/^\[([^\]]+)\](?::\d+)?$/, '$1').replace(/^([^:]+):\d+$/, '$1')
  const match = nodes.find(node => node.metadata?.name === labels.node || node.metadata?.name === instance || node.metadata?.name === address
    || node.status?.addresses?.some(item => item.address === address))
  return match?.metadata?.name || labels.node || instance || '未知节点'
}

export function metricRows(series, identity, end) {
  const rows = new Map()
  series.forEach(item => {
    const info = identity(item.labels)
    const row = rows.get(info.key) || { ...info, history: {} }
    const field = item.labels.dashboard_metric
    row[field] = currentValue(item, end)
    row.history[field] = item.points
    rows.set(info.key, row)
  })
  return [...rows.values()]
}

export function nodeRows(series, nodes, end) {
  return metricRows(series, labels => {
    const name = nodeName(labels, nodes)
    return { key: name, name }
  }, end)
}

export function podRows(series, pods, end) {
  const metrics = new Map(metricRows(series, labels => ({
    key: `${labels.namespace}/${labels.pod}`, namespace: labels.namespace, name: labels.pod,
  }), end).map(row => [row.key, row]))
  const phases = { Running: '运行中', Pending: '等待中', Succeeded: '已完成', Failed: '失败', Unknown: '未知' }
  return pods.map(pod => {
    const namespace = pod.metadata?.namespace || 'default', name = pod.metadata?.name, key = `${namespace}/${name}`
    const status = pod.status || {}, phase = status.phase || 'Unknown'
    const containers = [...(status.initContainerStatuses || []), ...(status.containerStatuses || [])]
    const waiting = containers.find(container => container.state?.waiting?.reason)?.state.waiting.reason
    const failed = containers.find(container => container.state?.terminated?.reason && container.state.terminated.reason !== 'Completed')?.state.terminated.reason
    const label = pod.metadata?.deletionTimestamp ? '终止中' : waiting || failed || status.reason
      || (phase === 'Running' && status.conditions?.some(item => item.type === 'Ready' && item.status === 'False') ? '未就绪' : phases[phase] || phase)
    return {
      cpu: null, memory: null, throttling: null, ...metrics.get(key), key, namespace, name,
      status: label, statusColor: phase === 'Failed' || failed ? 'red' : label === '运行中' ? 'green' : label === '已完成' || label === '未知' ? 'gray' : 'orange',
      restarts: containers.reduce((total, container) => total + (container.restartCount || 0), 0), node: pod.spec?.nodeName || '尚未调度',
    }
  })
}

export function capacityRows(series, nodes, end) {
  return metricRows(series, labels => ({
    key: `${nodeName(labels, nodes)}/${labels.device}/${labels.mountpoint}`,
    name: nodeName(labels, nodes), mountpoint: labels.mountpoint, device: labels.device,
  }), end).map(row => ({
    ...row,
    ratio: row.capacity > 0 && row.available != null ? (row.capacity - row.available) / row.capacity : null,
  })).sort((a, b) => Math.max(b.ratio ?? -1, b.inodes ?? -1) - Math.max(a.ratio ?? -1, a.inodes ?? -1))
}

export function abnormalPods(pods) {
  return pods.flatMap(pod => {
    const status = pod.status || {}
    const statuses = [...(status.initContainerStatuses || []), ...(status.containerStatuses || [])]
    const restarts = statuses.reduce((count, container) => count + (container.restartCount || 0), 0)
    const reasons = new Set()
    statuses.forEach(container => {
      if (container.state?.waiting?.reason) reasons.add(container.state.waiting.reason)
      if (container.state?.terminated?.reason && container.state.terminated.reason !== 'Completed') reasons.add(container.state.terminated.reason)
      if (container.lastState?.terminated?.reason === 'OOMKilled') reasons.add('OOMKilled')
    })
    if (status.phase !== 'Succeeded') {
      if (status.reason) reasons.add(status.reason)
      if (status.phase && status.phase !== 'Running') reasons.add(status.phase)
      if (status.conditions?.some(item => item.type === 'Ready' && item.status === 'False')) reasons.add('未就绪')
    }
    if (pod.metadata?.deletionTimestamp || status.phase === 'Succeeded') return []
    if (!reasons.size && !restarts) return []
    if (!reasons.size) reasons.add('曾发生重启')
    return [{ key: `${pod.metadata?.namespace}/${pod.metadata?.name}`, name: pod.metadata?.name, namespace: pod.metadata?.namespace,
      node: pod.spec?.nodeName || '尚未调度', reasons: [...reasons].join(' / '), restarts,
      severity: reasons.has('OOMKilled') || reasons.has('CrashLoopBackOff') || status.phase === 'Failed' ? 2 : 1 }]
  }).sort((a, b) => b.severity - a.severity || b.restarts - a.restarts)
}

export function formatPercent(value) { return finite(value) == null ? '—' : `${(value * 100).toFixed(1)}%` }
export function formatNumber(value, unit = '', digits = 2) { return finite(value) == null ? '—' : `${Number(value).toFixed(digits)}${unit}` }
export function formatBytes(value) {
  if (finite(value) == null) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const index = value > 0 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0
  const safeIndex = Math.max(0, index)
  return `${(value / 1024 ** safeIndex).toFixed(safeIndex ? 1 : 0)} ${units[safeIndex]}`
}
export function formatRate(value) { return finite(value) == null ? '—' : `${formatBytes(value)}/s` }
export function pressureColor(value) { return value == null ? 'gray' : value >= 0.95 ? 'red' : value >= 0.85 ? 'orange' : 'green' }
