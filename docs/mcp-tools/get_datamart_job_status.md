# get_datamart_job_status

## Purpose

Read the status of a TROCCO datamart job after it has been started by `run_datamart_job` or by an external TROCCO operation.

This would be the safest first action to implement if TROCCO exposes a confirmed read endpoint for datamart job status.

## TROCCO endpoint status

Unconfirmed.

The TROCCO API overview lists `POST /api/datamart_jobs` for datamart job execution, but the same endpoint list does not show a corresponding `GET /api/datamart_jobs/{datamart_job_id}` status endpoint. Do not implement this MCP tool as production-ready until one of the following is confirmed:

- TROCCO supports a datamart job status GET endpoint that is not listed in the overview.
- Datamart job status can be obtained through another supported endpoint.
- The tool is intentionally scoped as a placeholder that returns a structured unsupported response.

## Proposed MCP input if endpoint is confirmed

```json
{
  "datamart_job_id": 12345,
  "datamart_definition_id": 67890
}
```

`datamart_definition_id` should remain optional unless the confirmed TROCCO endpoint requires it.

## Proposed normalized output

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

Proposed normalized status values:

- `queued`
- `running`
- `success`
- `failed`
- `canceled`
- `unknown`

## Implementation notes

- Confirm the endpoint before adding a production-capable client method.
- Preserve the raw TROCCO response under `raw` when safe.
- Return structured MCP errors for 401/403, 404, other API errors, and network errors.
- If no endpoint exists, implement this as an explicit unsupported tool only if callers need discoverability.
