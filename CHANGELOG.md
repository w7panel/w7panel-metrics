# Changelog

## Unreleased

- 修复 Higress Access Log 采集对 Docker User-Agent 中 `\\(`、`\\)` 等非法 JSON 转义的兼容处理。此前 `docker pull` 的 Blob 下载日志会在 Vector `parse_json!` 阶段失败，并因 `drop_on_error` 被丢弃，导致统计分析的流量明显偏小；现在会仅移除非法转义的反斜杠，保留合法 JSON 转义，使 Blob 下行字节能够写入 VictoriaLogs 并参与统计。
