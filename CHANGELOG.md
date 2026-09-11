# Changelog

## Unreleased

- 新增 Longhorn 容量采集与 kubelet PVC 容量采集配置：采集卷申请容量、Longhorn 后端实际占用及 PVC 文件系统用量指标。kubelet 未暴露卷统计时不产生数据，待其开启后自动采集。

- 修复 upstream service fallback 的 VRL 可失败条件导致 Vector `normalize` 配置加载失败的问题。此前 higress-log DaemonSet 会进入 CrashLoopBackOff，新 HTTPS 访问无法写入 Apps 统计；现先安全转换 Service 字段再执行 fallback。

- 修复个别请求 enrichment lookup 未命中导致 Apps 完全无数据的问题。即使 Pod/Service 映射暂时缺失，只要访问日志包含有效 `upstream_service`，也会回退写入 Service workload 身份；映射命中时仍使用 `w7.cc.app/title` 中文名。

- 流量工作负载 enrichment 增加 `workload_title`。按 `w7.cc.app/title`、`title`、workload 原始名称的顺序持久化展示名，使 Apps 流量排行可显示应用中文名称，并在 Pod 重建或资源删除后保留当时名称。

- 修复工作负载 Service 映射 CSV 为空的问题；现在从已生成的 Pod-to-workload CSV 导出唯一的服务别名，确保无上游 IP 的请求能使用 Service fallback 归属 Apps。

- 修复上游连接未建立时 `upstream_ip` 为 `-` 导致 Apps 无数据的问题。现在按 `upstream_service` 和命名空间回退匹配工作负载，使 404、路由拒绝等访问也能归属到对应 App。

- 修复 Higress Log Vector 配置中 enrichment table 的 CSV `encoding` 层级错误。此前 `w7panel-metrics` 升级后 Vector 报 `missing field encoding in enrichment_tables.workloads` 并导致 higress-log DaemonSet 无法启动；现将编码配置放入 file table 定义内部，恢复采集器启动。

- 流量工作负载快照增加上游 Pod 名称并随日志持久化。Apps 抽屉可按当时的 Pod 名称列出和搜索流量，即使该 Pod 后续已销毁或 IP 被复用，也不会依赖查询时的 Pod IP 反查。

- Higress Access Log 现会在入库前按上游 Pod IP 写入顶层 Kubernetes 工作负载身份，支持 Deployment、StatefulSet、DaemonSet、Job 和 CronJob。此前流量排行只能依赖 Pod/IP，Pod 重建或销毁后会产生无法稳定归属的历史数据；现在由周期性 owner 快照供 Vector 丰富日志字段，供 Apps 聚合使用。

- 修复 Higress Access Log 采集对 Docker User-Agent 中 `\\(`、`\\)` 等非法 JSON 转义的兼容处理。此前 `docker pull` 的 Blob 下载日志会在 Vector `parse_json!` 阶段失败，并因 `drop_on_error` 被丢弃，导致统计分析的流量明显偏小；现在会仅移除非法转义的反斜杠，保留合法 JSON 转义，使 Blob 下行字节能够写入 VictoriaLogs 并参与统计。
- Higress Access Log 的 Vector DaemonSet 增加 Helm revision 注解。Vector 不会自动重载 ConfigMap；此前 Helm 已更新配置但旧 Pod 仍继续使用旧规则，现每次 Helm 发布都会滚动 Pod 并加载新配置。
