import assert from 'node:assert/strict'
import test from 'node:test'
import { abnormalPods, capacityRows, currentValue, extractSeries, formatBytes, formatNumber, formatPercent, formatRate, loadMetricGroups, nodeName, nodeRows, podRows, pressureColor, queryPath, rangeBounds, selectedTimeRange } from './monitoring.js'
import { createDevPreview } from './dev-preview.js'

const end = 1_800_000_000
const series = (field, value, labels = {}, time = end) => ({ labels: { ...labels, dashboard_metric: field }, points: [[time, value]] })

test('custom trend ranges accept picker values and reject incomplete, reversed, future or expired selections', () => {
  const now = Date.UTC(2026, 10, 23, 12), start = now - 7200000, finish = now - 3600000
  const expected = { start: start / 1000, end: finish / 1000, duration: 3600 }
  for (const values of [[new Date(start), new Date(finish)], [start, finish], [new Date(start).toISOString(), new Date(finish).toISOString()]]) {
    assert.deepEqual(selectedTimeRange(values, now), expected)
  }
  assert.equal(selectedTimeRange([now - 86400000, now], now).duration, 86400)
  for (const values of [undefined, [], [start], [null, finish], ['', finish]]) {
    assert.throws(() => selectedTimeRange(values, now), /完整/)
  }
  for (const values of [[finish, start], [start, start], ['invalid', finish]]) {
    assert.throws(() => selectedTimeRange(values, now), /开始时间/)
  }
  assert.throws(() => selectedTimeRange([start, now + 1000], now), /当前时间/)
  assert.throws(() => selectedTimeRange([now - 86401000, finish], now), /保留 1 天/)
})

test('custom history time and sampling do not change current metric snapshots', async () => {
  const preview = createDevPreview(), now = end + 37, historyEnd = now - 7200, requested = []
  const result = await loadMetricGroups(async path => {
    requested.push(new URL(path, 'http://test.local/').searchParams)
    return (await (await preview.panelProxy(path)).json()).data
  }, { end: now, historyEnd, duration: 21600, step: 300 })
  const histories = requested.filter(params => params.get('start') !== params.get('end'))
  const snapshots = requested.filter(params => params.get('start') === params.get('end'))
  assert.equal(histories.length, 2)
  assert.equal(snapshots.length, 5)
  assert.ok(histories.every(params => Number(params.get('end')) <= historyEnd && params.get('step') === '300'))
  assert.ok(snapshots.every(params => Number(params.get('end')) === now))
  assert.equal(currentValue(result.groups.api[0], now), 86)
  assert.equal(currentValue(result.groups.nodes[0], now), 0.2)
  assert.equal(result.history.api[0].points.length, 73)
  assert.equal(result.history.api[0].points.at(-1)[0], Math.floor(historyEnd / 300) * 300)
})

test('detail panels omit node queries after node rankings move beside the resource charts', async () => {
  const preview = createDevPreview(), requested = []
  const result = await loadMetricGroups(async path => {
    requested.push(new URL(path, 'http://test.local/').searchParams.get('query'))
    return (await (await preview.panelProxy(path)).json()).data
  }, { end, include: ['pods', 'filesystems', 'volumes', 'api'] })
  assert.equal(requested.length, 5)
  assert.ok(requested.every(query => !query.includes('node_cpu_seconds_total')))
  assert.deepEqual(Object.keys(result.groups), ['pods', 'filesystems', 'volumes', 'api'])
  assert.deepEqual(Object.keys(result.history), ['api'])
  assert.equal(currentValue(result.groups.api[0], end), 86)
})

test('missing, non-finite and stale metrics stay unknown while real zeros remain visible', () => {
  const data = extractSeries({ status: 'success', data: { result: [
    { metric: {}, values: [[end - 60, 'NaN'], [end, '0']] },
    { metric: {}, values: [[end, '+Inf']] },
  ] } })
  assert.equal(currentValue(data[0], end), 0)
  assert.equal(currentValue(data[1], end), null)
  assert.equal(currentValue(series('cpu', 0.7, {}, end - 60), end), null)
  for (const value of [undefined, null, NaN, Infinity]) {
    assert.equal(formatPercent(value), '—')
    assert.equal(formatBytes(value), '—')
    assert.equal(formatNumber(value), '—')
    assert.equal(formatRate(value), '—')
  }
  assert.equal(formatPercent(0), '0.0%')
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1073741824), '1.0 GiB')
  assert.equal(pressureColor(null), 'gray')
  assert.throws(() => extractSeries({ status: 'error', error: 'permission denied' }), /permission denied/)
  assert.throws(() => extractSeries({ code: 500, msg: 'failed' }), /格式/)
})

test('capacity uses filesystem data and never substitutes backend allocation or missing samples', () => {
  const labels = { namespace: 'production', persistentvolumeclaim: 'data' }
  const values = [series('capacity', 100, labels), series('used', 85, labels), series('available', 15, labels), series('inodes', 0.96, labels)]
  assert.equal(capacityRows(values, [], end, true)[0].ratio, 0.85)
  assert.equal(pressureColor(capacityRows(values, [], end, true)[0].inodes), 'red')
  assert.equal(capacityRows([values[0], values[2]], [], end, true)[0].ratio, null)
  assert.equal(capacityRows([series('capacity', 0, labels), values[1]], [], end, true)[0].ratio, null)
  assert.equal(capacityRows([values[0], series('used', 0, labels)], [], end, true)[0].ratio, 0)
  const inodeRisk = { namespace: 'production', persistentvolumeclaim: 'inode-full' }
  const ranked = capacityRows([...values, series('capacity', 100, inodeRisk), series('used', 10, inodeRisk), series('inodes', 0.99, inodeRisk)], [], end, true)
  assert.equal(ranked[0].name, 'inode-full')
  const fs = { instance: '10.0.0.1:9100', device: '/dev/sda1', mountpoint: '/' }
  assert.equal(capacityRows([series('capacity', 100, fs), series('available', 20, fs)], [], end)[0].ratio, 0.8)
})

test('node address mapping joins metric families to inventory including IPv6', () => {
  const nodes = [{ metadata: { name: 'worker-01' }, status: { addresses: [{ address: '10.0.0.1' }, { address: 'fd00::1' }] } }]
  assert.equal(nodeName({ instance: '10.0.0.1:9100' }, nodes), 'worker-01')
  assert.equal(nodeName({ instance: '[fd00::1]:9100' }, nodes), 'worker-01')
  assert.equal(nodeName({ node: 'worker-01' }, nodes), 'worker-01')
  assert.equal(nodeName({ instance: 'worker-01:9100' }, nodes), 'worker-01')
  const rows = nodeRows([series('cpu', 0.5, { instance: '10.0.0.1:9100' }), series('memory', 0.8, { node: 'worker-01' })], nodes, end)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].memory, 0.8)
})

test('absolute node usage joins with status data and distinguishes usage ranking from utilization', async () => {
  const preview = createDevPreview()
  const nodes = (await (await preview.k8sproxy('/api/v1/nodes')).json()).data.items
  const snapshot = extractSeries((await (await preview.panelProxy(queryPath('nodes', { end, history: false }))).json()).data)
  const rows = nodeRows(snapshot, nodes, end), byName = new Map(rows.map(row => [row.name, row]))
  assert.equal(byName.get('demo-worker-06').cpuUsed, 12.8)
  assert.equal(formatNumber(byName.get('demo-worker-06').cpuUsed, ' 核'), '12.80 核')
  assert.equal(formatBytes(byName.get('demo-worker-03').memoryUsed), '17.8 GiB')
  assert.equal(rows.filter(row => row.memoryUsed != null).sort((a, b) => b.memoryUsed - a.memoryUsed)[0].name, 'demo-worker-03')
  assert.equal(rows.filter(row => row.memory != null).sort((a, b) => b.memory - a.memory)[0].name, 'demo-worker-06')
  assert.equal(byName.get('demo-worker-06').diskRead, 7 * 1024 ** 2)
  assert.equal(byName.get('demo-worker-06').ioLatency, 7.2)
  assert.equal(byName.get('demo-worker-06').networkReceive, 21 * 1024 ** 2)
  assert.equal(byName.has('demo-worker-07'), false)
  const history = extractSeries((await (await preview.panelProxy(queryPath('nodes', { end, history: true }))).json()).data)
  const historyRows = nodeRows(history, nodes, end)
  assert.equal(historyRows.find(row => row.name === 'demo-worker-03').history.memoryUsed.length, 61)
  assert.equal(historyRows.find(row => row.name === 'demo-worker-07').cpuUsed, null)
  assert.equal(historyRows.find(row => row.name === 'demo-worker-07').memoryUsed, null)
})

test('Pod status includes the entire inventory, joins namespaces and preserves missing metrics', () => {
  const pods = [
    { metadata: { name: 'app', namespace: 'one' }, spec: { nodeName: 'worker-01' }, status: { phase: 'Running', containerStatuses: [{ restartCount: 2 }] } },
    { metadata: { name: 'app', namespace: 'two' }, status: { phase: 'Succeeded' } },
    { metadata: { name: 'pending', namespace: 'one' }, status: { phase: 'Pending' } },
    { metadata: { name: 'failed', namespace: 'one' }, status: { phase: 'Failed' } },
    { metadata: { name: 'init-failed', namespace: 'one' }, status: { phase: 'Pending', initContainerStatuses: [{ restartCount: 3, state: { waiting: { reason: 'CrashLoopBackOff' } } }], containerStatuses: [{ restartCount: 1 }] } },
    { metadata: { name: 'terminating', namespace: 'one', deletionTimestamp: '2026-11-23T00:00:00Z' }, status: { phase: 'Running' } },
    ...Array.from({ length: 12 }, (_, index) => ({ metadata: { name: `unmeasured-${index}`, namespace: 'one' } })),
  ]
  const rows = podRows([
    series('cpu', 1, { namespace: 'one', pod: 'app' }), series('cpu', 2, { namespace: 'two', pod: 'app' }), series('cpu', 3, { namespace: 'one', pod: 'deleted' }),
    series('memory', 100, { namespace: 'one', pod: 'app' }, end - 60), series('cpu', 0, { namespace: 'one', pod: 'failed' }),
  ], pods, end)
  assert.equal(rows.length, pods.length)
  assert.deepEqual(rows.slice(0, 2).map(row => [row.key, row.cpu]), [['one/app', 1], ['two/app', 2]])
  assert.equal(rows[0].memory, null)
  assert.equal(rows[0].restarts, 2)
  assert.equal(rows[0].node, 'worker-01')
  assert.equal(rows[1].status, '已完成')
  assert.equal(rows[2].status, '等待中')
  assert.equal(rows[2].cpu, null)
  assert.equal(rows[2].node, '尚未调度')
  assert.equal(rows[3].status, '失败')
  assert.equal(rows[3].cpu, 0)
  assert.equal(rows[4].status, 'CrashLoopBackOff')
  assert.equal(rows[4].restarts, 4)
  assert.equal(rows[5].status, '终止中')
  assert.equal(rows.at(-1).status, '未知')
  assert.equal(podRows([series('cpu', 1, { namespace: 'one', pod: 'deleted' })], [], end).length, 0)
})

test('abnormal Pod details include init failures, OOMs, not-ready and restart-only cases without successful jobs', () => {
  const pod = (name, status, metadata = {}) => ({ metadata: { name, namespace: 'test', ...metadata }, status: { phase: 'Running', ...status } })
  const rows = abnormalPods([
    pod('healthy', { containerStatuses: [{ restartCount: 0 }] }),
    pod('restarted', { containerStatuses: [{ restartCount: 3 }] }),
    pod('init-failed', { phase: 'Pending', initContainerStatuses: [{ state: { waiting: { reason: 'CrashLoopBackOff' } }, restartCount: 4 }] }),
    pod('oom', { containerStatuses: [{ lastState: { terminated: { reason: 'OOMKilled' } } }] }),
    pod('unready', { conditions: [{ type: 'Ready', status: 'False' }] }),
    pod('completed-job', { phase: 'Succeeded', containerStatuses: [{ restartCount: 2 }] }),
    pod('terminating', { phase: 'Failed' }, { deletionTimestamp: '2026-11-23T00:00:00Z' }),
  ])
  assert.equal(rows.length, 4)
  assert.equal(rows[0].name, 'init-failed')
  assert.match(rows.find(row => row.name === 'oom').reasons, /OOMKilled/)
  assert.match(rows.find(row => row.name === 'unready').reasons, /未就绪/)
  assert.match(rows.find(row => row.name === 'restarted').reasons, /曾发生重启/)
})

test('development preview exercises all query groups with realistic identities and selectable time ranges', async () => {
  const preview = createDevPreview()
  const nodes = (await (await preview.k8sproxy('/api/v1/nodes')).json()).data.items
  const pods = (await (await preview.k8sproxy('/api/v1/pods')).json()).data.items
  const query = async (group, duration = 3600) => extractSeries((await (await preview.panelProxy(queryPath(group, { end, duration }))).json()).data)
  const [nodeSeries, podSeries, filesystems, volumes, api] = await Promise.all(['nodes', 'pods', 'filesystems', 'volumes', 'api'].map(group => query(group)))
  assert.equal(nodeRows(nodeSeries, nodes, end).length, 8)
  assert.equal(nodeRows(nodeSeries, nodes, end).find(row => row.name === 'demo-worker-07').cpu, null)
  const podStatusRows = podRows(podSeries, pods, end)
  assert.equal(podStatusRows.length, 268)
  assert.equal(podStatusRows[24].cpu, null)
  assert.equal(podStatusRows[250].status, '已完成')
  assert.equal(podStatusRows[260].status, '失败')
  assert.equal(capacityRows(filesystems, nodes, end).length, 7)
  assert.equal(capacityRows(volumes, nodes, end, true).find(row => row.name === 'cache-data').ratio, 0)
  assert.equal(api.length, 4)
  assert.equal(api[0].points.length, 61)
  const longer = await query('api', 21600)
  assert.equal(longer[0].points.length, 73)
  const instant = new URL(queryPath('pods', { end }), 'http://test.local/')
  assert.equal(instant.searchParams.get('start'), instant.searchParams.get('end'))
})

test('snapshots stay current independently of aligned history and a failed group does not hide other metrics', async () => {
  const preview = createDevPreview(), requested = []
  const now = end + 37
  const result = await loadMetricGroups(async path => {
    const params = new URL(path, 'http://test.local/').searchParams
    requested.push(params)
    if (params.get('query').includes('kubelet_volume_stats')) throw new Error('volume collection denied')
    return (await (await preview.panelProxy(path)).json()).data
  }, { end: now, duration: 86400 })
  assert.equal(requested.length, 7)
  assert.equal(result.errors.volumes, 'volume collection denied')
  assert.ok(result.groups.pods.length)
  assert.equal(currentValue(result.groups.api[0], now), 86)
  assert.equal(currentValue(result.groups.nodes[0], now), 0.2)
  const bounds = rangeBounds(now, 86400)
  assert.equal(bounds.end % 600, 0)
  assert.equal(result.history.api[0].points.at(-1)[0], bounds.end)
  assert.equal(result.history.api[0].points[0][0], bounds.start)
  assert.equal(result.groups.api[0].points.length, 1)
})
