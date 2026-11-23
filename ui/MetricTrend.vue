<template>
  <div class="metric-trend" :class="{ compact }" role="img" :aria-label="`${label}，${summary}`">
    <svg v-if="validPoints.length" viewBox="0 0 300 84" preserveAspectRatio="none" aria-hidden="true">
      <line x1="2" y1="78" x2="298" y2="78" class="trend-baseline" />
      <path :d="path" class="trend-line" />
      <circle v-for="point in coordinates.filter(point => point.y != null)" :key="point.time" :cx="point.x" :cy="point.y" r="2">
        <title>{{ timeLabel(point.time) }} · {{ formatter(point.value) }}</title>
      </circle>
    </svg>
    <span v-else class="trend-empty">暂无趋势</span>
    <div v-if="!compact && validPoints.length" class="trend-axis"><span>{{ timeLabel(start) }}</span><span>{{ timeLabel(end) }}</span></div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({
  points: { type: Array, default: () => [] }, label: { type: String, default: '' },
  start: { type: Number, required: true }, end: { type: Number, required: true },
  formatter: { type: Function, default: value => value.toFixed(2) }, compact: Boolean,
})
const validPoints = computed(() => props.points.filter(([, value]) => Number.isFinite(value)))
const summary = computed(() => validPoints.value.length ? `趋势末值 ${props.formatter(validPoints.value.at(-1)[1])}` : '暂无数据')
const ceiling = computed(() => Math.max(...validPoints.value.map(([, value]) => value), 0.01) * 1.1)
const coordinates = computed(() => props.points.map(([time, value]) => ({
  time, value, x: 2 + (time - props.start) / Math.max(props.end - props.start, 1) * 296,
  y: value == null ? null : 78 - Math.max(0, value) / ceiling.value * 72,
})))
const path = computed(() => {
  let connected = false, previousTime
  const gaps = props.points.slice(1).map((point, index) => point[0] - props.points[index][0]).filter(value => value > 0)
  const step = gaps.length ? Math.min(...gaps) : 60
  return coordinates.value.map(point => {
    if (point.y == null) { connected = false; return '' }
    const command = connected && point.time - previousTime <= step * 1.5 ? 'L' : 'M'
    connected = true
    previousTime = point.time
    return `${command}${point.x.toFixed(2)},${point.y.toFixed(2)}`
  }).join(' ')
})
const acrossDays = computed(() => new Date(props.start * 1000).toLocaleDateString() !== new Date(props.end * 1000).toLocaleDateString())
const timeLabel = time => new Date(time * 1000).toLocaleString('zh-CN', {
  ...(acrossDays.value ? { month: '2-digit', day: '2-digit' } : {}), hour: '2-digit', minute: '2-digit', hour12: false,
})
</script>

<style scoped>
.metric-trend{min-width:0;color:rgb(var(--primary-6))}
.metric-trend svg{display:block;width:100%;height:90px;overflow:visible}
.trend-baseline{stroke:var(--color-border-2);stroke-width:1}
.trend-line{fill:none;stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke}
circle{fill:currentColor}
circle:not(:last-child){opacity:0}
circle:hover{opacity:1;r:4}
.trend-axis{display:flex;justify-content:space-between;margin-top:8px;color:var(--color-text-3);font-size:11px}
.trend-empty{display:flex;align-items:center;justify-content:center;min-height:90px;color:var(--color-text-3);font-size:12px}
.compact{width:110px}
.compact svg,.compact .trend-empty{height:32px;min-height:32px}
</style>
