# Datamart Action Runbook

## Scope

This runbook covers the first write/run action set for TROCCO MCP operations:

1. `get_datamart_job_status`
2. `run_datamart_job`
3. `update_datamart_definition`

The implementation order should stay in this order. Status reads come first, job execution second, and definition updates last.

## Phase 1 audit priority

For the TROCCO BigQuery differential audit agent, the first audit phase focuses on `SOURCE -> AGGREGATION` datamart behavior. Action implementation should prioritize settings that affect differential updates:

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
- Production execution should be deferred unless the target datamart, reason, and rollback/stop condition are clear.

## Recommended PR sequence

1. Templates and draft schemas
2. `get_datamart_job_status` client and MCP tool
3. `run_datamart_job` client and MCP tool with guarded-failure smoke coverage
4. `update_datamart_definition` client and MCP tool with read-before-write guard
5. README and smoke test updates for deployed Cloud Run operation

## Pre-implementation checklist

- Confirm the TROCCO endpoint and HTTP method.
- Capture a safe example response.
- Decide which raw fields can be returned to ChatGPT safely.
- Add or update the JSON schema draft.
- Add Zod validation in the MCP server.
- Add smoke-test instructions.

## Stop conditions

Stop and open a follow-up issue when any of the following are true:

- The TROCCO endpoint or method is still unknown.
- The operation can mutate production state without an explicit confirmation field.
- The requested patch field is outside the allowlist.
- The job/run response does not include a stable identifier that can be checked later.
- Rollback or manual restore is unclear for a datamart definition update.
