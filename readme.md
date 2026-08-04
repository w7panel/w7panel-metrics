# w7panel-metrics

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
