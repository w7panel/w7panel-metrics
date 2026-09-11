# Metrics catalog

The table records what the Chart actually creates. `Enabled` refers to the default in `charts/w7panel-metrics/values.yaml`.

| Domain | Collector and default | Kept metric families | Primary labels |
| --- | --- | --- | --- |
| Longhorn capacity | `VMServiceScrape` / enabled | `longhorn_volume_capacity_bytes`, `longhorn_volume_actual_size_bytes`, `longhorn_disk_{capacity,usage,reservation}_bytes`, `longhorn_node_storage_{capacity,usage,scheduled,reservation}_bytes` | `pvc`, `pvc_namespace`, `volume`, `node` |
| PVC filesystem | kubelet `VMNodeScrape` / **disabled** | `kubelet_volume_stats_{capacity,used,available}_bytes`, `kubelet_volume_stats_inodes{,_used,_free}` | `namespace`, `persistentvolumeclaim`, `node` (provided by kubelet) |
| Node host | node exporter / enabled | exporter-provided `node_*` families | `instance`, `node`, device/mount labels |
| Containers | kubelet cAdvisor / enabled | cAdvisor `container_*` families | `namespace`, `pod`, `container`, `node`, `image` |
| Kubelet resource | kubelet `/metrics/resource` / enabled | kubelet resource metrics, notably `kubelet_*` | `node`, `metrics_path` |
| Kubernetes API | API server service scrape / enabled | API-server exporter output, notably `apiserver_*`, `workqueue_*`, `etcd_*` where exposed | `job`, `instance` |
| Cilium agent | `VMPodScrape` / enabled | `cilium_drop_{count,bytes}_total`, `cilium_endpoint*`, `cilium_unreachable_{nodes,health_endpoints}`, `cilium_bpf_map_pressure`, `cilium_version` | `node`, endpoint labels |
| Hubble | `VMPodScrape` / enabled | every `hubble_*` family exposed by Cilium | `node`, flow source/destination context labels |
| Higress gateway | `VMPodScrape` / enabled | `envoy_cluster_upstream_rq_{total,2xx,3xx,4xx,5xx,time_bucket,time_sum,time_count}`, `envoy_cluster_upstream_cx_{rx,tx}_bytes_total`, `envoy_http_downstream_rq_total` | `cluster_name`, `response_code`, `destination_service`, `source_*` when emitted |
| NVIDIA GPU | DCGM service scrape / enabled when Service exists | exporter-provided `DCGM_FI_*` families | `gpu`, `UUID`, `modelName`, `Hostname` |
| HAMI | device plugin, scheduler, web UI service scrapes / enabled when Services exist | exporter-provided HAMI metrics | exporter-specific labels |

`node-cadvisor`, `node-resource`, and node-exporter remove a few noisy REST-client histograms only; other exporter metrics remain available. The `pod-node-exporter` scrape is disabled by default and is an alternative pod-based collection path.

## Capacity queries

```promql
# Longhorn actual backend allocation as a percentage of requested volume capacity, per PVC
100 * max by (pvc_namespace, pvc, volume) (longhorn_volume_actual_size_bytes)
  / max by (pvc_namespace, pvc, volume) (longhorn_volume_capacity_bytes)

# Longhorn disk usage, with reservations included for scheduling headroom
100 * max by (node, disk) (longhorn_disk_usage_bytes + longhorn_disk_reservation_bytes)
  / max by (node, disk) (longhorn_disk_capacity_bytes)

# Longhorn node storage usage
100 * max by (node) (longhorn_node_storage_usage_bytes)
  / max by (node) (longhorn_node_storage_capacity_bytes)

# PVC filesystem usage; available only when kubeletVolumeMetrics.enabled=true
100 * max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_used_bytes)
  / max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes)

# PVC available bytes
max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_available_bytes)
```

`longhorn_volume_actual_size_bytes` is backend allocation, not necessarily filesystem consumption. Use kubelet volume stats for data inside a mounted filesystem, and Longhorn metrics for replica/disk allocation.

## Node, container, and Kubernetes queries

```promql
# Node CPU busy percentage, excluding idle
100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))

# Node memory use percentage
100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)

# Filesystem use percentage; tune the mount filter for the cluster
100 * (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}
  / node_filesystem_size_bytes{fstype!~"tmpfs|overlay"})

# Container CPU cores used by namespace
sum by (namespace) (rate(container_cpu_usage_seconds_total{container!="",image!=""}[5m]))

# Container working-set memory by workload namespace
sum by (namespace) (container_memory_working_set_bytes{container!="",image!=""})

# API request rate and 5xx ratio; label names may differ by Kubernetes version
sum(rate(apiserver_request_total[5m]))
sum(rate(apiserver_request_total{code=~"5.."}[5m])) / sum(rate(apiserver_request_total[5m]))
```

## Network and gateway queries

```promql
# Cilium drops per second by reason and node
sum by (node, reason) (rate(cilium_drop_count_total[5m]))

# Cilium BPF map pressure (gauge; inspect labels to identify the map)
max by (node, map_name) (cilium_bpf_map_pressure)

# Hubble flows and drops; exact context labels depend on Cilium Hubble configuration
sum by (node) (rate(hubble_flows_processed_total[5m]))
sum by (node) (rate(hubble_drop_total[5m]))

# Higress upstream request rate and 5xx ratio
sum by (cluster_name, response_code) (rate(envoy_cluster_upstream_rq_total[5m]))
sum(rate(envoy_cluster_upstream_rq_5xx[5m])) / sum(rate(envoy_cluster_upstream_rq_total[5m]))

# Higress upstream p95 latency in seconds
histogram_quantile(0.95, sum by (le, cluster_name) (rate(envoy_cluster_upstream_rq_time_bucket[5m])))

# Gateway downstream requests per second
sum by (response_code) (rate(envoy_http_downstream_rq_total[5m]))
```

For GPU and HAMI, first list available metric names, then use the exporter’s labels:

```promql
# Metric discovery API selector examples
{__name__=~"DCGM_FI_.*"}
{__name__=~".*hami.*"}
```

Do not assume a DCGM/HAMI metric name from another exporter release; their versions and enabled devices determine the emitted set.

