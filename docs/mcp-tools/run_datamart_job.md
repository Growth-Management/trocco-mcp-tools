# run_datamart_job

## Purpose

Start a TROCCO datamart job for a specific datamart definition.

This is a run/execute action and must be guarded more strictly than read-only audit tools.

## TROCCO endpoint

`POST /api/datamart_jobs`

Confirmed behavior from TROCCO API docs:

- `datamart_definition_id` is required.
- Optional request fields include `context_time`, `time_zone`, `memo`, and `custom_variables`.
- The response includes the executed datamart job `id`, `datamart_definition_id`, and `context_time`.

## MCP input

```json
{
  "datamart_definition_id": 67890,
  "confirm": true,
  "run_reason": "Validate corrected incremental settings after review",
  "context_time": "2026-06-15 15:30:00",
  "time_zone": "Asia/Tokyo",
  "memo": "Manual validation from TROCCO MCP",
  "custom_variables": [
    {
      "name": "$target_date$",
      "value": "2026-06-15"
    }
  ]
}
```

## Guardrails

- `confirm: true` is required by the MCP layer.
- `run_reason` is required by the MCP layer and should be sent as `memo` when `memo` is omitted.
- The MCP tool should reject ambiguous identifiers and should not infer a datamart id from a name.
- Custom variable names should remain explicitly wrapped with `$` when used.

## Normalized output

```json
{
  "ok": true,
  "datamart_definition_id": 67890,
  "datamart_job_id": 12345,
  "context_time": "2026-06-15 15:30:00",
  "raw": {}
}
```

## Implementation notes

- Implement after a status/read strategy is decided.
- Keep the client method separate from read-only methods.
- Add smoke coverage for the guarded-failure path where `confirm` is omitted or false.
- Only run a confirmed end-to-end smoke test in a safe environment.
