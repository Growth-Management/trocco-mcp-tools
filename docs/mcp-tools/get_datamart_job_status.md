# get_datamart_job_status

## Purpose

Read the status of a TROCCO datamart job after it has been started by `run_datamart_job` or by an external TROCCO operation.

This is the safest first action to implement because it is read-only.

## Status

Draft. The exact TROCCO API endpoint and raw response fields must be confirmed before production use.

## Input

```json
{
  "datamart_job_id": 12345,
  "datamart_definition_id": 67890
}
```

`datamart_definition_id` is optional unless the confirmed TROCCO endpoint requires it.

## Normalized output

```json
{
  "ok": true,
  "datamart_job_id": 12345,
  "datamart_definition_id": 67890,
  "status": "running",
  "raw_status": "running",
  "raw": {}
}
```

Normalized status values:

- `queued`
- `running`
- `success`
- `failed`
- `canceled`
- `unknown`

## Implementation notes

- Add a typed client method after confirming the TROCCO endpoint.
- Preserve the raw TROCCO response under `raw` when safe.
- Return structured MCP errors for 401/403, 404, other API errors, and network errors.
- Add this tool before `run_datamart_job` so job execution can be observed safely.
