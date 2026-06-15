# run_datamart_job

## Purpose

Start a TROCCO datamart job for a specific datamart definition.

This is a run/execute action and must be guarded more strictly than read-only audit tools.

## Status

Draft. The exact TROCCO API endpoint, supported parameters, idempotency behavior, and response fields must be confirmed before production use.

## Input

```json
{
  "datamart_definition_id": 67890,
  "confirm": true,
  "run_reason": "Validate corrected incremental settings after review",
  "idempotency_key": "optional-key",
  "parameters": {}
}
```

## Guardrails

- `confirm: true` is required.
- `run_reason` is required and must explain why the job is being started.
- Optional `parameters` must remain empty until TROCCO API behavior is confirmed.
- The MCP tool should reject ambiguous identifiers and should not infer a datamart id from a name.

## Normalized output

```json
{
  "ok": true,
  "datamart_definition_id": 67890,
  "datamart_job_id": 12345,
  "status": "queued",
  "raw": {}
}
```

## Implementation notes

- Implement after `get_datamart_job_status`.
- Keep the client method separate from read-only methods.
- Add smoke coverage for the guarded-failure path where `confirm` is omitted or false.
- Only run a confirmed end-to-end smoke test in a safe environment.
