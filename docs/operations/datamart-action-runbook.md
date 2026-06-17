# Datamart Action Runbook

## Scope

This runbook covers the first write/run action set for TROCCO MCP operations:

1. `get_datamart_job_status`
2. `run_datamart_job`
3. `update_datamart_definition`

Current implementation status:

- `get_datamart_job_status` is intentionally guarded as unsupported until a TROCCO datamart job status endpoint is confirmed.
- `run_datamart_job` is implemented against `POST /api/datamart_jobs` and requires `confirm: true` plus `run_reason`.
- `update_datamart_definition` is implemented against `PATCH /api/datamart_definitions/{datamart_definition_id}` and requires `confirm: true` plus `change_reason`.

## Phase 1 audit priority

For the TROCCO BigQuery differential audit agent, the first audit phase focuses on `SOURCE -> AGGREGATION` datamart behavior. Action implementation and validation should prioritize settings that affect differential updates:

- destination dataset/table
- write disposition
- delete/insert behavior
- incremental column
- merge keys
- lookback period
- downstream references

## Safety posture

- Read-only tools may be callable by default.
- Write/run actions must require explicit confirmation.
- Update actions should use narrow patch allowlists.
- Unknown TROCCO API fields must remain documented as unknown until confirmed.
- Production execution should be deferred unless the target datamart, reason, rollback/restore path, and stop condition are clear.
- The first production-like validation should use a safe non-critical datamart or a reviewed low-risk target.

## Completed PR sequence

1. Templates and draft schemas: merged in #1.
2. Guarded runtime tools: merged in #2.

## Recommended next PR sequence

1. README and runbook alignment for the merged guarded action state.
2. Deployed Cloud Run smoke verification for `smoke:http` and `smoke:actions`.
3. TROCCO API behavior confirmation for `run_datamart_job` response fields.
4. Datamart job status endpoint confirmation. If no supported endpoint exists, keep `get_datamart_job_status` as an explicit unsupported placeholder.
5. Optional tightening after real responses are captured: normalize job id/status fields, add response examples, and narrow or expand the update allowlist based on confirmed BigQuery option behavior.

## Deployment smoke checklist

- Deploy latest `main` to Cloud Run.
- Confirm `GET /status` returns healthy service metadata.
- Confirm `POST /mcp` requires the expected bearer token when `MCP_AUTH_TOKEN` is set.
- Run `npm run smoke:http` against the deployed endpoint.
- Run `npm run smoke:actions` against the deployed endpoint.
- Confirm `get_datamart_job_status` returns `ok: false` with `unsupported_operation`.
- Do not call `run_datamart_job` or `update_datamart_definition` during generic smoke checks.

## Pre-action checklist

Before calling `run_datamart_job`:

- Confirm the datamart definition id and target environment.
- Confirm why the job needs to run now.
- Confirm the expected `context_time` and `time_zone`.
- Confirm the downstream impact if the job succeeds, fails, or runs twice.
- Record the expected response shape, including the stable job id field.

Before calling `update_datamart_definition`:

- Fetch the current datamart definition.
- Confirm the current destination, write disposition, incremental column, merge keys, and lookback settings.
- Provide `expected_current` for the fields that must not drift between review and update.
- Limit `patch` to the smallest set of fields needed.
- Confirm rollback or manual restore values before sending the update.

## Stop conditions

Stop and open a follow-up issue when any of the following are true:

- The TROCCO endpoint or method is still unknown.
- The operation can mutate production state without an explicit confirmation field.
- The requested patch field is outside the allowlist.
- The job/run response does not include a stable identifier that can be checked later.
- Rollback or manual restore is unclear for a datamart definition update.
- The target datamart is part of the Phase 1 `SOURCE -> AGGREGATION` chain and downstream impact has not been reviewed.
