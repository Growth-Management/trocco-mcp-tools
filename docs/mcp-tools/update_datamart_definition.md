# update_datamart_definition

## Purpose

Update selected TROCCO datamart definition settings through a guarded MCP action.

This is the highest-risk action in the first action set because it can change BigQuery datamart behavior. Implement it after status and run actions are clarified.

## TROCCO endpoint

`PATCH /api/datamart_definitions/{datamart_definition_id}`

Confirmed behavior from TROCCO API docs:

- Datamart definitions can be updated with this endpoint.
- The DWH type itself cannot be changed.
- BigQuery, Snowflake, and Databricks are listed as currently updateable DWH types.
- For BigQuery `write_disposition`, API values are `append`, `truncate`, `incremental`, and `scd_type_2`.

Audit-only inferred values such as `delete_insert` or `merge` should not be sent as BigQuery API `write_disposition` values.

## MCP input

```json
{
  "datamart_definition_id": 67890,
  "patch": {
    "write_disposition": "incremental",
    "incremental_column": "updated_at",
    "merge_keys": ["id"],
    "on_matched_action": "upsert"
  },
  "expected_current": {
    "write_disposition": "append"
  },
  "confirm": true,
  "change_reason": "Align datamart update method with SOURCE to AGGREGATION differential audit policy"
}
```

## Initial allowed BigQuery patch fields

Start with a narrow allowlist:

- `query`
- `destination_dataset`
- `destination_table`
- `write_disposition`
- `schema_evolution_mode`
- `incremental_column`
- `merge_keys`
- `on_matched_action`
- `lookback_period_column`
- `lookback_period_column_type`
- `lookback_period_timezone`
- `lookback_period_from`
- `lookback_period_to`
- `lookback_period_unit`
- `before_load`
- `partitioning`
- `partitioning_time`
- `partitioning_field`
- `clustering_fields`

The MCP implementation should wrap these values under `datamart_bigquery_option` when sending the TROCCO API request.

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
  "updated_fields": ["write_disposition", "incremental_column", "merge_keys", "on_matched_action"],
  "raw": {}
}
```

## Implementation notes

- Keep update behavior separate from read-only audit payload generation.
- Prefer read-before-write validation before sending the update request.
- Add docs for rollback or manual restore before allowing production usage.
