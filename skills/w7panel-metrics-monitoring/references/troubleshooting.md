# Scrape troubleshooting

First determine whether the problem is collection, ingestion, or query scope:

```sh
kubectl -n default get vmnodescrape,vmpodscrape,vmservicescrape
kubectl -n default get vmagent
kubectl -n default get pods -l app.kubernetes.io/name=vmagent
```

`STATUS=operational` means the operator accepted the resource; it does not prove the exporter returned samples. Inspect VMAgent targets at `/api/v1/targets?state=any`; an `up` target with zero relevant time series usually means the exporter does not expose the expected metric family or a metric relabel rule removed it.

For a new collector, validate in this order:

1. The Helm values switch is enabled and `helm template` emits the intended `VM*Scrape`.
2. The selector matches the Service/Pod and the named port exists.
3. VMAgent shows a healthy target and recent `lastScrape`.
4. The exporter exposes the metric family.
5. VictoriaMetrics returns the expected label set.

Kubelet PVC metrics are intentionally optional. A healthy kubelet target with no `kubelet_volume_stats_*` samples is expected on a kubelet that does not expose volume statistics; do not enable it solely to make an empty query return data.

