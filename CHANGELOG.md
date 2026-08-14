# Changelog

## Unreleased

- Higress Access Log 现会在入库前按上游 Pod IP 写入顶层 Kubernetes 工作负载身份，支持 Deployment、StatefulSet、DaemonSet、Job 和 CronJob。此前流量排行只能依赖 Pod/IP，Pod 重建或销毁后会产生无法稳定归属的历史数据；现在由周期性 owner 快照供 Vector 丰富日志字段，供 Apps 聚合使用。

- 修复 Higress Access Log 采集对 Docker User-Agent 中 `\\(`、`\\)` 等非法 JSON 转义的兼容处理。此前 `docker pull` 的 Blob 下载日志会在 Vector `parse_json!` 阶段失败，并因 `drop_on_error` 被丢弃，导致统计分析的流量明显偏小；现在会仅移除非法转义的反斜杠，保留合法 JSON 转义，使 Blob 下行字节能够写入 VictoriaLogs 并参与统计。
- Higress Access Log 的 Vector DaemonSet 增加 Helm revision 注解。Vector 不会自动重载 ConfigMap；此前 Helm 已更新配置但旧 Pod 仍继续使用旧规则，现每次 Helm 发布都会滚动 Pod 并加载新配置。
