<template>
  <main class="metrics-app">
    <header v-if="!embedded" class="local-nav"><router-link to="/dashboard">监控大屏</router-link><router-link to="/plugins">监控插件</router-link><span v-if="devPreview" class="preview-hint">开发预览 · 示例数据</span></header>
    <router-view />
  </main>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { isDevPreview } from './api'

const embedded = Boolean(window.__POWERED_BY_WUJIE__ || window.microData?.cd)
const devPreview = isDevPreview()
const router = useRouter()
const wujieBus = window.$wujie?.bus

function onRouteChange(target, data) {
  if (data?.fromSubPanel || typeof target !== 'string') return
  router.push(target.startsWith('#') ? target.slice(1) || '/dashboard' : target).catch(() => {})
}

onMounted(() => wujieBus?.$on?.('routeChange', onRouteChange))
onBeforeUnmount(() => wujieBus?.$off?.('routeChange', onRouteChange))
</script>

<style scoped>
.local-nav{align-items:center;flex-wrap:wrap}
.preview-hint{margin-left:auto;color:var(--color-text-3);font-size:12px}
</style>
