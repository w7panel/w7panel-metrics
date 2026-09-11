---
name: w7panel-metrics-monitoring
description: Query and diagnose metrics and Higress access logs collected by the w7panel-metrics Helm Chart. Use for W7Panel cluster capacity, node, Kubernetes, Cilium/Hubble, Higress, GPU, HAMI, or traffic-observability questions.
---

# W7Panel Metrics Monitoring

Use the deployed `VMSingle` Prometheus-compatible API for metric queries. The Helm release normally runs in `default`; identify the actual VMSingle service instead of assuming an address:

```sh
kubectl -n default get svc -l app.kubernetes.io/name=vmsingle
```

For one-off cluster-local queries, execute from the VMSingle Pod or use port-forward. Query `/api/v1/query` for an instant value, `/api/v1/query_range` for a trend, and `/api/v1/series` or `label/__name__/values` to discover data. Do not put sensitive labels, credentials, request IDs, or raw access-log records in output unless the task requires them.

## Select the data source

- Capacity, CPU, memory, node filesystems, containers, Kubernetes API, Cilium, Hubble, Higress, DCGM, and HAMI use VictoriaMetrics / PromQL. Read [metric-catalog.md](references/metric-catalog.md).
- Higress request-level analytics uses VictoriaLogs, not PromQL. Read [higress-access-logs.md](references/higress-access-logs.md).
- For missing data, first inspect the matching `VM*Scrape` object's status and the VMAgent target health. Read [troubleshooting.md](references/troubleshooting.md).

## Query conventions

- Prefer `rate(counter[5m])` for request, byte, packet, error, and flow counters. Do not graph a raw `_total` counter as a rate.
- Aggregate only after choosing the identity labels to retain. Typical labels are `namespace`, `pod`, `container`, `node`, `service`, `pvc`, `pvc_namespace`, `volume`, `route`, and `response_code`.
- Use `sum by (...)` for totals and `max by (...)` for capacity gauges reported by multiple Longhorn manager Pods.
- Guard ratios with a positive denominator, e.g. `used / capacity * 100`, and filter `capacity > 0` when necessary.
- The Chart intentionally keeps only the metric families listed in the catalog for Cilium, Hubble, Higress, Longhorn, and optional kubelet PVC collection. Node exporter, cAdvisor, Kubernetes API, DCGM, and HAMI scrape their exporter output broadly; discover exact names from the running cluster before asserting a metric is available.

## Configuration boundaries

`longhornMetrics.enabled` defaults to true. `kubeletVolumeMetrics.enabled` defaults to false because a kubelet `/metrics` scrape can be large and some clusters do not expose `kubelet_volume_stats_*`. Enable it only when PVC filesystem-level usage is required. Cilium, Hubble, Higress, and access-log collectors also have independent values switches; see the catalog before changing Chart values.

