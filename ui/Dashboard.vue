<template>
  <section class="page dashboard-page" aria-label="监控大屏" :aria-busy="loading">
    <a-alert v-if="error" type="error" show-icon>{{ error }}</a-alert>
    <a-spin :loading="loading" class="dashboard-loading">
      <div class="dashboard-content">
        <div class="overview-layout">
          <section class="dashboard-panel" aria-labelledby="overview-title">
            <div class="panel-heading">
              <h1 id="overview-title" class="panel-title">概览</h1>
              <a-button size="small" :loading="loading" @click="refresh">
                <template #icon><icon-refresh /></template>
                刷新
              </a-button>
            </div>
            <div class="overview-stats">
              <article v-for="item in overviewItems" :key="item.label" class="overview-item">
                <div class="overview-icon" aria-hidden="true"><component :is="item.icon" /></div>
                <div class="overview-value">
                  <span>{{ item.label }}</span>
                  <div><strong>{{ item.value }}</strong><span class="overview-unit">{{ item.unit }}</span></div>
                </div>
              </article>
            </div>
          </section>
          <section class="dashboard-panel" aria-labelledby="cluster-title">
            <div class="panel-heading"><h2 id="cluster-title" class="panel-title">集群信息</h2></div>
            <dl class="cluster-info">
              <div><dt>就绪节点</dt><dd><span class="status-dot status-ready" />{{ readyNodes }} / {{ nodes.length }} 个</dd></div>
              <div><dt>未就绪节点</dt><dd :class="{ 'status-warning': nodes.length > readyNodes }">{{ nodes.length - readyNodes }} 个</dd></div>
              <div><dt>运行中 Pod</dt><dd>{{ runningPods }} / {{ pods.length }} 个</dd></div>
              <div><dt>等待中 Pod</dt><dd>{{ pendingPods }} 个</dd></div>
            </dl>
          </section>
        </div>

        <section class="dashboard-panel" aria-labelledby="resources-title">
          <div class="panel-heading"><h2 id="resources-title" class="panel-title">资源状态</h2></div>
          <div class="resource-grid">
            <article v-for="item in resourceItems" :key="item.label" class="resource-item">
              <div class="resource-chart">
                <div class="resource-ring" role="img" :aria-label="`${item.label} ${percent(item.ratio)}`">
                  <svg viewBox="0 0 160 160" aria-hidden="true">
                    <circle class="ring-track" cx="80" cy="80" r="70" />
                    <circle class="ring-value" cx="80" cy="80" r="70" pathLength="100" :stroke-dasharray="`${progressValue(item.ratio)} 100`" transform="rotate(-90 80 80)" />
                  </svg>
                  <span class="ring-percent">{{ percent(item.ratio) }}</span>
                </div>
                <h3>{{ item.label }}</h3>
              </div>
              <dl class="resource-details">
                <div><dt>已使用</dt><dd>{{ item.used }}</dd></div>
                <div><dt>总量</dt><dd>{{ item.total }}</dd></div>
              </dl>
            </article>
          </div>
        </section>

        <div class="workload-grid">
          <section class="dashboard-panel" aria-labelledby="pods-title">
            <div class="panel-heading"><h2 id="pods-title" class="panel-title">Pod 状态</h2><span class="panel-note">共 {{ pods.length }} 个</span></div>
            <div v-if="pods.length" class="phase-list">
              <div v-for="phase in podPhases" :key="phase.name" class="phase-row">
                <span class="phase-label"><i class="status-dot" :style="{ background: phase.color }" />{{ phase.name }}</span>
                <div class="phase-track"><span :style="{ width: barWidth(phase.count / pods.length), background: phase.color }" /></div>
                <b>{{ phase.count }}</b>
              </div>
            </div>
            <a-empty v-else description="暂无 Pod 数据" />
          </section>
          <section class="dashboard-panel" aria-labelledby="namespaces-title">
            <div class="panel-heading"><h2 id="namespaces-title" class="panel-title">Pod 数最多的命名空间</h2><span class="panel-note">前 5 名</span></div>
            <a-empty v-if="!namespaceRows.length" description="暂无 Pod 数据" />
            <div v-else class="namespace-list">
              <div v-for="(item, index) in namespaceRows" :key="item.name" class="namespace-row">
                <span class="namespace-rank">{{ index + 1 }}</span>
                <span class="namespace-name" :title="item.name">{{ item.name }}</span>
                <span class="namespace-count">{{ item.count }} 个 Pod</span>
              </div>
            </div>
          </section>
        </div>

        <section class="dashboard-panel node-panel" aria-labelledby="nodes-title">
          <div class="panel-heading"><h2 id="nodes-title" class="panel-title">节点状态</h2><span class="panel-note">共 {{ nodes.length }} 个</span></div>
          <a-empty v-if="!nodes.length" description="暂无节点数据" />
          <a-table v-else :data="nodes" :pagination="false" :bordered="false" :scroll="{ x: 680 }" row-key="metadata.name">
            <template #columns>
              <a-table-column title="节点"><template #cell="{ record }"><b class="node-name">{{ record.metadata.name }}</b><div class="muted node-detail">{{ nodeAddress(record) }}</div></template></a-table-column>
              <a-table-column title="状态" :width="110"><template #cell="{ record }"><a-tag :color="isReady(record) ? 'green' : 'red'">{{ isReady(record) ? '就绪' : '未就绪' }}</a-tag></template></a-table-column>
              <a-table-column title="角色" :width="120"><template #cell="{ record }">{{ nodeRole(record) }}</template></a-table-column>
              <a-table-column title="Kubelet 版本" :width="150"><template #cell="{ record }">{{ record.status?.nodeInfo?.kubeletVersion || '—' }}</template></a-table-column>
            </template>
          </a-table>
        </section>
      </div>
    </a-spin>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { k8sGet, panelGet } from './api'

const nodes = ref([]), pods = ref([]), usage = ref(null), loading = ref(false), error = ref('')
const isReady = node => node.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True')
const readyNodes = computed(() => nodes.value.filter(isReady).length)
const runningPods = computed(() => pods.value.filter(item => item.status?.phase === 'Running').length)
const pendingPods = computed(() => pods.value.filter(item => item.status?.phase === 'Pending').length)
const restartCount = computed(() => pods.value.reduce((total, pod) => total + (pod.status?.containerStatuses || []).reduce((count, container) => count + (container.restartCount || 0), 0), 0))
const podPhases = computed(() => [
  { name: '运行中', phase: 'Running', color: '#00b42a' },
  { name: '等待中', phase: 'Pending', color: '#ff7d00' },
  { name: '已完成', phase: 'Succeeded', color: '#165dff' },
  { name: '失败', phase: 'Failed', color: '#f53f3f' },
  { name: '未知', phase: 'Unknown', color: '#86909c' },
].map(item => ({ ...item, count: pods.value.filter(pod => (pod.status?.phase || 'Unknown') === item.phase).length })))
const namespaceCounts = computed(() => {
  const counts = new Map()
  pods.value.forEach(pod => {
    const namespace = pod.metadata?.namespace || 'default'
    counts.set(namespace, (counts.get(namespace) || 0) + 1)
  })
  return counts
})
const namespaceRows = computed(() => [...namespaceCounts.value].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5))
const overviewItems = computed(() => [
  { label: '节点', value: nodes.value.length, unit: '个', icon: 'icon-common' },
  { label: 'Pod', value: pods.value.length, unit: '个', icon: 'icon-apps' },
  { label: '活跃命名空间', value: namespaceCounts.value.size, unit: '个', icon: 'icon-folder' },
  { label: '容器重启', value: restartCount.value, unit: '次', icon: 'icon-sync' },
])
const cpu = computed(() => Number(usage.value?.cpu?.usage || 0) / Number(usage.value?.cpu?.total || 0))
const memory = computed(() => Number(usage.value?.memory?.usage || 0) / Number(usage.value?.memory?.total || 0))
const resourceItems = computed(() => [
  { label: 'CPU 使用率', ratio: cpu.value, used: `${cores(usage.value?.cpu?.usage)} 核`, total: `${cores(usage.value?.cpu?.total)} 核` },
  { label: '内存使用率', ratio: memory.value, used: bytes(usage.value?.memory?.usage), total: bytes(usage.value?.memory?.total) },
])
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
const progressValue = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value * 100)) : 0
const barWidth = value => `${progressValue(value)}%`
const cores = milli => milli == null ? '—' : (Number(milli) / 1000).toFixed(1)
const bytes = value => value == null ? '—' : `${(Number(value) / 1073741824).toFixed(1)} GiB`
const nodeRole = node => Object.keys(node.metadata?.labels || {}).some(key => key.includes('control-plane')) ? '控制节点' : '工作节点'
const nodeAddress = node => node.status?.addresses?.find(item => item.type === 'InternalIP')?.address || '—'

async function refresh() {
  loading.value = true
  error.value = ''
  const results = await Promise.allSettled([
    k8sGet('/api/v1/nodes'),
    k8sGet('/api/v1/pods'),
    panelGet('metrics/usage/normal'),
  ])
  nodes.value = results[0].status === 'fulfilled' ? results[0].value?.items || [] : []
  pods.value = results[1].status === 'fulfilled' ? results[1].value?.items || [] : []
  usage.value = results[2].status === 'fulfilled' ? results[2].value : null
  const failures = results.filter(item => item.status === 'rejected')
  if (failures.length) error.value = failures.map(item => item.reason?.message || '数据读取失败').join('；')
  loading.value = false
}
onMounted(refresh)
</script>

<style scoped>
.dashboard-page{color:var(--color-text-1)}
.dashboard-loading{display:block;width:100%}
.dashboard-content{display:flex;flex-direction:column;gap:20px;min-width:0}
.overview-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px}
.dashboard-panel{min-width:0;padding:20px;background:var(--color-bg-2)}
.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px;margin-bottom:20px}
.panel-title{margin:0;border-left:3px solid rgb(var(--arcoblue-5));padding-left:10px;font-size:16px;font-weight:500;line-height:20px}
.panel-note{flex-shrink:0;color:var(--color-text-3);font-size:12px}
.overview-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,224px),1fr));gap:16px;padding:10px 0}
.overview-item{display:flex;align-items:center;justify-content:flex-start;gap:50px;min-width:0;padding:20px;border-radius:6px;background:var(--color-fill-2)}
.overview-icon{display:flex;flex-shrink:0;align-items:center;justify-content:center;width:50px;height:50px;border:2px solid var(--color-neutral-4);border-radius:50%;outline:2px solid var(--color-neutral-1);color:var(--color-text-2);font-size:24px}
.overview-value{display:flex;flex:none;flex-direction:column;align-items:center;gap:16px;width:max-content;font-size:14px;text-align:center;white-space:nowrap}
.overview-value strong{color:rgb(var(--arcoblue-7));font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
.overview-unit{margin-left:4px;font-size:13px}
.cluster-info,.resource-details{margin:0;font-size:14px}
.cluster-info{display:grid;gap:14px;padding-top:6px}
.cluster-info>div,.resource-details>div{display:flex;align-items:center;gap:20px}
.cluster-info dt,.resource-details dt{color:var(--color-text-3);white-space:nowrap}
.cluster-info dt{width:80px}
.cluster-info dd,.resource-details dd{margin:0;color:var(--color-text-2);font-variant-numeric:tabular-nums}
.status-dot{display:inline-block;flex-shrink:0;width:6px;height:6px;margin-right:8px;border-radius:50%;vertical-align:middle}
.status-ready{background:rgb(var(--green-6))}
.cluster-info .status-warning{color:rgb(var(--orange-6))}
.resource-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));padding:0 20px}
.resource-item{display:flex;align-items:center;justify-content:center;gap:36px;min-width:0;padding:10px 20px}
.resource-item+.resource-item{border-left:1px solid var(--color-border-1)}
.resource-chart{flex-shrink:0;text-align:center}
.resource-chart h3{margin:16px 0 0;font-size:14px;font-weight:400}
.resource-ring{position:relative;width:150px;height:150px}
.resource-ring svg{display:block;width:100%;height:100%;fill:none;stroke-width:6}
.ring-track{stroke:var(--color-fill-2)}
.ring-value{stroke:rgb(var(--primary-6))}
.ring-percent{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--color-text-3);font-size:20px;font-variant-numeric:tabular-nums}
.resource-details{display:grid;gap:16px;padding-bottom:30px}
.resource-details dd{white-space:nowrap}
.workload-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.phase-list{display:grid;gap:21px;padding:8px 0}
.phase-row{display:grid;grid-template-columns:76px minmax(0,1fr) 36px;align-items:center;gap:16px;font-size:13px}
.phase-label{display:flex;align-items:center}
.phase-track{height:7px;overflow:hidden;border-radius:4px;background:var(--color-fill-2)}
.phase-track span{display:block;height:100%;border-radius:4px}
.phase-row b{text-align:right;font-weight:500;font-variant-numeric:tabular-nums}
.namespace-row{display:flex;align-items:center;gap:12px;min-height:36px;font-size:13px}
.namespace-row+.namespace-row{margin-top:4px}
.namespace-rank{display:flex;flex-shrink:0;align-items:center;justify-content:center;width:20px;height:20px;border-radius:3px;background:var(--color-fill-2);color:var(--color-text-3);font-size:12px}
.namespace-row:first-child .namespace-rank{background:var(--color-primary-light-1);color:rgb(var(--primary-6))}
.namespace-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.namespace-count{flex-shrink:0;color:var(--color-text-3);font-variant-numeric:tabular-nums}
.node-name{font-weight:500;overflow-wrap:anywhere}
.node-detail{margin-top:4px;font-size:12px}
.node-panel :deep(.arco-table-th){background:var(--color-fill-1)}
@media(max-width:1440px){.overview-layout{grid-template-columns:minmax(0,1fr) 300px}.overview-stats{gap:12px}.overview-icon{width:40px;height:40px;font-size:22px}}
@media(max-width:1200px){.overview-layout{grid-template-columns:1fr}.cluster-info{grid-template-columns:repeat(2,minmax(0,1fr));padding-top:0}.overview-icon{width:50px;height:50px;font-size:24px}}
@media(max-width:900px){.resource-grid{padding:0}.resource-item{gap:16px;padding:10px}.resource-details>div{gap:12px}}
@media(max-width:700px){.workload-grid,.resource-grid{grid-template-columns:1fr}.resource-item{justify-content:flex-start;gap:32px;padding:16px 10px}.resource-item+.resource-item{border-left:0;border-top:1px solid var(--color-border-1)}.resource-chart h3{margin-top:10px}.resource-details{padding-bottom:24px}}
@media(max-width:550px){.dashboard-panel{padding:16px}.overview-stats{padding:0;gap:12px}.overview-item{padding:16px 8px}.overview-icon{width:36px;height:36px;font-size:20px}.overview-value{font-size:12px;gap:12px}.cluster-info{grid-template-columns:1fr}.resource-item{justify-content:center;gap:16px;padding:16px 0}.resource-ring{width:120px;height:120px}.panel-heading{gap:8px}.panel-title{font-size:15px}.phase-row{gap:12px}}
</style>
