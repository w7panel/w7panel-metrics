# w7panel-metrics

## 存储容量指标

Chart 默认采集 Longhorn 容量指标；kubelet PVC 容量采集默认关闭，按需开启后可观察卷内文件系统用量。

| 指标 | 含义 |
| --- | --- |
| `longhorn_volume_capacity_bytes` | Longhorn Volume/PVC 配置容量。 |
| `longhorn_volume_actual_size_bytes` | Longhorn 后端实际分配的数据量。 |
| `longhorn_disk_capacity_bytes` / `longhorn_disk_usage_bytes` | Longhorn 磁盘总容量与后端已用量。 |
| `longhorn_node_storage_capacity_bytes` / `longhorn_node_storage_usage_bytes` | Longhorn 节点存储总量与后端已用量。 |
| `kubelet_volume_stats_capacity_bytes` / `used_bytes` / `available_bytes` | PVC 文件系统容量、卷内已用和可用空间。 |

可通过 values 控制采集：

```yaml
longhornMetrics:
  enabled: true
  namespace: longhorn-system
kubeletVolumeMetrics:
  enabled: true # 默认关闭；仅在 kubelet 已暴露卷统计时开启
```

`kubelet_volume_stats_*` 仅在 kubelet 暴露卷统计时存在；未暴露时对应抓取目标保持正常但不会写入该类时序。

常用容量使用率查询：

```promql
# Longhorn 后端按 PVC 实际分配比例
longhorn_volume_actual_size_bytes / longhorn_volume_capacity_bytes

# PVC 文件系统已用比例（按 kubelet 可见的卷）
kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes
```

## Hubble 指标采集

`charts/w7panel-metrics/values.yaml` 中的配置：

```yaml
hubbleMetrics:
  enabled: true
```

用于控制 `w7panel-metrics` 是否采集 Hubble 暴露的 Prometheus 指标。开启后，Chart 会创建 `VMPodScrape`：

- 查找 `kube-system` 命名空间中标签为 `k8s-app=cilium` 的 Pod。
- 采集 Pod 的 `hubble-metrics` 端口。
- 只保留名称匹配 `hubble_.*` 的指标。
- 为指标补充所在 Kubernetes 节点的 `node` 标签。
- 通过 VMAgent 将指标写入 VictoriaMetrics。

面板目前使用以下 Hubble 指标：

| 指标 | 用途 |
| --- | --- |
| `hubble_flows_processed_total` | Pod Cilium 流量 |
| `hubble_drop_total` | Pod Cilium 丢包 |
| `hubble_dns_queries_total` | Pod DNS 请求 |
| `hubble_tcp_flags_total` | Pod TCP 事件 |
| `hubble_http_requests_total` | Pod HTTP 请求 |

### 开启 Cilium 的 Hubble 指标

`hubbleMetrics.enabled` 只负责采集指标，不会自动修改 Cilium 配置。Cilium 必须先开放 `hubble-metrics` Prometheus 端口。

K3s 内置 Cilium 可应用以下 `HelmChartConfig`：

```yaml
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: cilium
  namespace: kube-system
spec:
  valuesContent: |-
    prometheus:
      enabled: true
    hubble:
      enabled: true
      metrics:
        enableOpenMetrics: true
        enabled:
          - dns:query;ignoreAAAA;sourceContext=pod;destinationContext=pod
          - drop:sourceContext=pod;destinationContext=pod
          - tcp:sourceContext=pod;destinationContext=pod
          - flow:sourceContext=pod;destinationContext=pod
          - icmp:sourceContext=pod;destinationContext=pod
          - http:sourceContext=pod;destinationContext=pod
```

配置生效后，确认 Cilium Pod 已暴露相应端口：

```bash
kubectl get pods -n kube-system -l k8s-app=cilium
kubectl get pod -n kube-system -l k8s-app=cilium \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*].ports[*]}{.name}{" "}{end}{"\n"}{end}'
```

安装或升级 `w7panel-metrics` 后，确认采集资源和指标数据：

```bash
kubectl get vmpodscrape -A | grep hubble
```

### 与 Cilium 指标的区别

- `ciliumMetrics.enabled` 采集 Cilium Agent 自身的 Endpoint、BPF Map、连通性和底层丢包等 `cilium_*` 指标。
- `hubbleMetrics.enabled` 采集网络流、DNS、TCP、HTTP 等 `hubble_*` 流量观测指标。
- 统计分析中的域名、热点 URL 和请求趋势主要来自 Higress 访问日志，不依赖 Hubble。
