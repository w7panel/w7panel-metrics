<template>
  <section class="monitoring-details" aria-labelledby="cluster-monitor-title" :aria-busy="loading">
    <section class="metrics-panel pod-status-panel" aria-labelledby="pod-status-title">
      <div class="metrics-heading">
        <div id="pod-status-title">Pod 状态</div>
      </div>
      <a-alert v-if="errors.pods" type="warning">Pod 指标读取失败：{{ errors.pods }}</a-alert>
      <a-empty v-if="!podStatusRows.length" :description="podsAvailable ? '暂无 Pod 数据' : 'Pod 列表读取失败，无法判断运行状态'" />
      <a-table v-else :data="podStatusRows" :pagination="podPagination" :bordered="false" :scroll="{ x: 1100, y: 560 }" row-key="key">
        <template #columns>
          <a-table-column title="Pod" :width="220"><template #cell="{ record }"><b class="metric-name">{{ record.name }}</b><div class="metric-secondary">{{ record.namespace }}</div></template></a-table-column>
          <a-table-column title="状态" :width="150"><template #cell="{ record }"><a-tag :color="record.statusColor">{{ record.status }}</a-tag></template></a-table-column>
          <a-table-column title="重启次数" :width="100" data-index="restarts" />
          <a-table-column title="所在节点" :width="180" data-index="node" />
          <a-table-column title="CPU 用量" :width="150"><template #cell="{ record }">{{ formatNumber(record.cpu, ' 核', 3) }}</template></a-table-column>
          <a-table-column title="内存工作集" :width="150"><template #cell="{ record }">{{ formatBytes(record.memory) }}</template></a-table-column>
          <a-table-column title="CPU 限流率" :width="150"><template #cell="{ record }">{{ formatPercent(record.throttling) }}</template></a-table-column>
        </template>
      </a-table>
    </section>

    <section class="metrics-panel" aria-labelledby="filesystem-title">
      <div class="metrics-heading"><div id="filesystem-title">节点磁盘容量</div></div>
      <a-alert v-if="errors.filesystems" type="warning">节点磁盘指标读取失败：{{ errors.filesystems }}</a-alert>
      <a-empty v-if="!filesystemRows.length" description="暂无节点磁盘容量指标" />
      <a-table v-else :data="filesystemRows" :pagination="pagination" :bordered="false" :scroll="{ x: 850 }" row-key="key">
        <template #columns>
          <a-table-column title="节点 / 挂载点"><template #cell="{ record }"><b class="metric-name">{{ record.name }}</b><div class="metric-secondary">{{ record.mountpoint }} · {{ record.device }}</div></template></a-table-column>
          <a-table-column title="空间使用率" :width="160"><template #cell="{ record }"><a-tag :color="pressureColor(record.ratio)">{{ formatPercent(record.ratio) }}</a-tag></template></a-table-column>
          <a-table-column title="可用空间" :width="150"><template #cell="{ record }">{{ formatBytes(record.available) }}</template></a-table-column>
          <a-table-column title="总容量" :width="150"><template #cell="{ record }">{{ formatBytes(record.capacity) }}</template></a-table-column>
          <a-table-column title="inode 使用率" :width="150"><template #cell="{ record }"><span :class="pressureClass(record.inodes)">{{ formatPercent(record.inodes) }}</span></template></a-table-column>
        </template>
      </a-table>
    </section>

    <section class="metrics-panel" aria-labelledby="pvc-title">
      <div class="metrics-heading"><div id="pvc-title">PVC 卷内容量</div></div>
      <a-alert v-if="errors.volumes" type="warning">PVC 指标读取失败：{{ errors.volumes }}</a-alert>
      <a-empty v-if="!volumeRows.length" description="暂无 PVC 卷内容量数据" />
      <p v-if="!volumeRows.length && !errors.volumes" class="metrics-note">需开启 PVC 容量采集，且 kubelet 已上报卷统计；未采集的卷不会显示为 0。</p>
      <a-table v-if="volumeRows.length" :data="volumeRows" :pagination="pagination" :bordered="false" :scroll="{ x: 850 }" row-key="key">
        <template #columns>
          <a-table-column title="PVC"><template #cell="{ record }"><b class="metric-name">{{ record.name }}</b><div class="metric-secondary">{{ record.namespace }}</div></template></a-table-column>
          <a-table-column title="空间使用率" :width="160"><template #cell="{ record }"><a-tag :color="pressureColor(record.ratio)">{{ formatPercent(record.ratio) }}</a-tag></template></a-table-column>
          <a-table-column title="可用空间" :width="150"><template #cell="{ record }">{{ formatBytes(record.available) }}</template></a-table-column>
          <a-table-column title="总容量" :width="150"><template #cell="{ record }">{{ formatBytes(record.capacity) }}</template></a-table-column>
          <a-table-column title="inode 使用率" :width="150"><template #cell="{ record }"><span :class="pressureClass(record.inodes)">{{ formatPercent(record.inodes) }}</span></template></a-table-column>
        </template>
      </a-table>
    </section>

    <section class="metrics-panel" aria-labelledby="apiserver-title">
      <div class="metrics-heading"><div id="apiserver-title">Kubernetes API 服务</div></div>
      <a-alert v-if="errors.api" type="warning">API Server 指标读取失败：{{ errors.api }}</a-alert>
      <a-alert v-if="errors.apiHistory" type="warning">API Server 趋势读取失败：{{ errors.apiHistory }}</a-alert>
      <div class="api-grid">
        <article v-for="item in apiCards" :key="item.key" class="api-card">
          <div class="api-label">{{ item.label }}</div><strong>{{ item.formatter(item.value) }}</strong>
          <MetricTrend :points="item.points" :start="rangeStart" :end="rangeEnd" :formatter="item.formatter" :label="item.label" />
        </article>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { panelGet } from './api'
import MetricTrend from './MetricTrend.vue'
import { capacityRows, currentValue, formatBytes, formatNumber, formatPercent, loadMetricGroups, podRows, pressureColor, rangeBounds, selectedTimeRange } from './monitoring.js'

const props = defineProps({ nodes: { type: Array, default: () => [] }, pods: { type: Array, default: () => [] }, podsAvailable: Boolean, refreshId: Number })
const initialEnd = Date.now()
const recentRange = (hours, now = Date.now()) => [new Date(now - hours * 3600000), new Date(now)]
const timeRange = ref(recentRange(1, initialEnd)), historyStep = ref(60), rangeError = ref(''), relativeHours = ref(1)
const stepOptions = [{ label: '1 分钟', value: 60 }, { label: '5 分钟', value: 300 }, { label: '10 分钟', value: 600 }]
const shortcuts = [1, 6, 24].map(hours => ({ label: `最近 ${hours} 小时`, hours, value: () => recentRange(hours) }))
const disabledDate = date => { const day = new Date(date).setHours(0, 0, 0, 0), today = new Date().setHours(0, 0, 0, 0); return day > today || day < today - 86400000 }
const pagination = { pageSize: 5, hideOnSinglePage: true }
const podPagination = { defaultPageSize: 20, showTotal: true, showPageSize: true, pageSizeOptions: [10, 20, 50, 100], bufferSize: 1, size: 'small', hideOnSinglePage: true }
const groups = ref({}), histories = ref({}), errors = ref({}), loading = ref(false), snapshotEnd = ref(Math.floor(initialEnd / 1000)), updated = ref(null)
const bounds = ref(rangeBounds(snapshotEnd.value, 3600, historyStep.value))
const rangeStart = computed(() => bounds.value.start), rangeEnd = computed(() => bounds.value.end)
const updatedLabel = computed(() => updated.value ? `更新于 ${updated.value.toLocaleTimeString('zh-CN', { hour12: false })}` : '等待监控数据')
const podStatusRows = computed(() => podRows(groups.value.pods || [], props.pods, snapshotEnd.value))
const filesystemRows = computed(() => capacityRows(groups.value.filesystems || [], props.nodes, snapshotEnd.value))
const volumeRows = computed(() => capacityRows(groups.value.volumes || [], props.nodes, snapshotEnd.value, true))
const apiCards = computed(() => [
  { key: 'requests', label: '请求速率', formatter: value => formatNumber(value, ' 次/s') },
  { key: 'errors', label: '5xx 错误率', formatter: formatPercent },
  { key: 'p95', label: 'P95 延迟', formatter: value => formatNumber(value, ' ms', 1) },
  { key: 'p99', label: 'P99 延迟', formatter: value => formatNumber(value, ' ms', 1) },
].map(item => {
  const series = groups.value.api?.find(series => series.labels.dashboard_metric === item.key)
  const history = histories.value.api?.find(series => series.labels.dashboard_metric === item.key)
  return { ...item, value: series ? currentValue(series, snapshotEnd.value) : null, points: history?.points || [] }
}))
const pressureClass = value => ({ 'metric-warning': value >= 0.85, 'metric-danger': value >= 0.95 })
let requestId = 0
let selectingShortcut = false

function onShortcut(shortcut) {
  relativeHours.value = shortcut.hours
  selectingShortcut = true
  nextTick(() => { selectingShortcut = false })
}

function onTimeRangeChange() {
  if (!selectingShortcut) relativeHours.value = null
  refresh()
}

async function refresh() {
  if (!props.refreshId) return
  const now = Date.now()
  if (relativeHours.value != null) timeRange.value = recentRange(relativeHours.value, now)
  let selection
  try { selection = selectedTimeRange(timeRange.value, now) }
  catch (error) { rangeError.value = error.message; requestId++; loading.value = false; return }
  rangeError.value = ''
  const id = ++requestId, end = Math.floor(Date.now() / 1000), step = historyStep.value
  loading.value = true
  const result = await loadMetricGroups(panelGet, { end, historyEnd: selection.end, duration: selection.duration, step, include: ['pods', 'filesystems', 'volumes', 'api'] })
  if (id !== requestId) return
  groups.value = result.groups
  histories.value = result.history
  errors.value = result.errors
  snapshotEnd.value = end
  bounds.value = rangeBounds(selection.end, selection.duration, step)
  updated.value = new Date()
  loading.value = false
}

watch(() => props.refreshId, refresh, { immediate: true })
onBeforeUnmount(() => { requestId++ })
</script>

<style scoped>
.monitoring-details{display:grid;gap:20px;min-width:0}
.metrics-toolbar,.metrics-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.metrics-toolbar{flex-wrap:wrap;gap:16px}
.metrics-toolbar>.metrics-heading{margin:0}
.metrics-controls{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:12px;min-width:0;max-width:100%;margin-left:auto}
.metrics-controls :deep(.arco-picker){width:380px;max-width:100%}
.metrics-controls :deep(.arco-select){width:120px}
.metrics-update{margin:0;color:var(--color-text-3);font-size:12px;line-height:1.7}
.metrics-panel{min-width:0;padding:20px;background:var(--color-bg-2)}
.metrics-heading{margin-bottom:20px;flex-wrap:wrap}
.metrics-heading div{margin:0;border-left:3px solid rgb(var(--arcoblue-5));padding-left:10px;font-size:16px;font-weight:400;line-height:1.5715}
.metrics-note{margin:12px 0 0;color:var(--color-text-3);font-size:12px;line-height:1.7}
.metrics-heading>.metrics-note{margin:0}
.metrics-panel>.arco-alert{margin-bottom:16px}
.metrics-panel :deep(.arco-table-th){background:var(--color-fill-1)}
.pod-status-panel :deep(.arco-scrollbar-track-direction-horizontal){overflow:hidden}
.pod-status-panel :deep(.arco-pagination){flex-wrap:wrap;justify-content:flex-end;row-gap:8px}
.metric-name{font-weight:500;overflow-wrap:anywhere}
.metric-secondary{margin-top:4px;color:var(--color-text-3);font-size:12px;overflow-wrap:anywhere}
.metric-warning{color:rgb(var(--orange-6))}
.metric-danger{color:rgb(var(--red-6))}
.api-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}
.api-card{min-width:0;padding:16px;background:var(--color-fill-1);border-radius:4px}
.api-label{color:var(--color-text-2);font-size:13px}
.api-card strong{display:block;margin:12px 0 16px;font-size:24px;font-weight:500;font-variant-numeric:tabular-nums}
@media(max-width:1000px){.api-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:1000px){.metrics-controls{width:100%}}
@media(max-width:550px){.metrics-panel{padding:16px}.api-grid{grid-template-columns:1fr}.metrics-toolbar{align-items:flex-start}.metrics-controls{justify-content:flex-end}.metrics-controls :deep(.arco-picker){width:100%}}
</style>
