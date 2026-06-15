# update_datamart_definition

## Purpose

Update selected TROCCO datamart definition settings through a guarded MCP action.

This is the highest-risk action in the first action set because it can change BigQuery datamart behavior. Implement it after status and run actions are in place.

## Status

Draft. The exact TROCCO API endpoint, request body shape, mutable fields, and response fields must be confirmed before production use.

## Input

```json
{
  "datamart_definition_id": 67890,
  "patch": {
    "write_disposition": "delete_insert",
    "incremental_column": "updated_at",
    "merge_keys": ["id"]
  },
  "expected_current": {
    "write_disposition": "append"
  },
  "confirm": true,
  "change_reason": "Align datamart update method with SOURCE to AGGREGATION differential audit policy"
}
```

## Allowed patch fields

Start with a narrow allowlist:

- `query`
- `destination_dataset`
- `destination_table`
- `write_disposition`
- `incremental_column`
- `merge_keys`
- `lookback_period`

Do not add broad passthrough updates until TROCCO API behavior and rollback expectations are confirmed.

## Guardrails

- `confirm: true` is required.
- `change_reason` is required.
- `patch` must contain at least one allowed field.
- Optional `expected_current` should be checked before update once the client supports read-before-write guards.
- The tool should return both normalized fields and safe raw TROCCO detail.

## Normalized output

```json
{
  "ok": true,
  "datamart_definition_id": 67890,
  "updated_fields": ["write_disposition", "incremental_column", "merge_keys"],
  "raw": {}
}
```

## Implementation notes

- Implement after `get_datamart_job_status` and `run_datamart_job`.
- Keep update behavior separate from read-only audit payload generation.
- Prefer read-before-write validation before sending the update request.
- Add docs for rollback or manual restore before allowing production usage.
