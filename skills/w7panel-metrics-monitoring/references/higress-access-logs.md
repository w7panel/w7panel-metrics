# Higress access logs

When both `victoriaLogs.enabled` and `higressAccessLogs.enabled` are true, Vector reads Higress gateway access logs and writes JSON lines to VictoriaLogs. This is request-level observability, separate from Prometheus metrics.

The stream fields are `log_type`, `route_namespace`, and `authority`; query `log_type:higress_access`. Normalized fields include:

- `start_time`, `path` (query string removed), `authority`, `route_namespace`, `route`;
- `upstream_service`, `upstream_namespace`, `upstream_port`, `upstream_pod_name`;
- `workload_kind`, `workload_name`, `workload_title`, `workload_namespace`;
- `duration_ms`, `bytes_received`, `bytes_sent`, `status_code`.

Use LogsQL against the VictoriaLogs HTTP endpoint. Start with narrow time bounds and a scoped filter, for example:

```logsql
_stream:{log_type="higress_access"} | stats count() as requests by (authority, status_code)
_stream:{log_type="higress_access"} | stats quantile(0.95, duration_ms) as p95_ms by (workload_namespace, workload_name)
_stream:{log_type="higress_access"} status_code:>=500 | stats count() as errors by (route_namespace, route)
_stream:{log_type="higress_access"} | stats sum(bytes_sent) as egress_bytes by (workload_namespace, workload_name)
```

The Vector transform removes `request_id`, `trace_id`, `user_agent`, `x_forwarded_for`, and downstream/upstream address fields before ingestion. Do not rely on them being searchable. `workload_title` uses the Kubernetes `w7.cc.app/title` label when available and otherwise falls back to the workload/service name.

