# Datamart definition action tools

This document summarizes the operational guardrails for TROCCO datamart definition create/update tools.

## Scope

Current action tools are intentionally limited to BigQuery datamart definitions.

- `create_datamart_definition`: create a BigQuery datamart definition through `POST /api/datamart_definitions`
- `update_datamart_definition`: update selected BigQuery option fields through `PATCH /api/datamart_definitions/{id}`
- `run_datamart_job`: run an existing datamart definition through `POST /api/datamart_jobs`

Workflow definition create/update and transfer definition create/update are out of scope for this phase. Workflow changes can break task/dependency graphs, and transfer definitions vary heavily by connector type.

## Safety conditions

Every write or execution tool must require an explicit confirmation field.

- `confirm: true` is required.
- A human-readable reason is required: `create_reason`, `change_reason`, or `run_reason`.
- Inputs are allowlisted with zod schemas rather than passed as arbitrary API payloads.
- `update_datamart_definition` supports `expected_current` and does not send the PATCH request when current values differ.

## Recommended create flow

1. Fetch a similar existing datamart with `get_datamart`.
2. Confirm the BigQuery connection id, destination dataset/table, write disposition, partitioning, clustering, and SQL.
3. Prefer creating the definition only; attach it to a workflow in a later, separate change.
4. After creation, fetch the new definition with `get_datamart` and verify the normalized audit fields.
5. Run the datamart only after confirming destination and write mode.

## Recommended update flow

1. Fetch the target definition with `get_datamart`.
2. Build a narrow patch with only fields that must change.
3. Include `expected_current` for the fields being changed when possible.
4. Re-fetch the definition after update and compare destination, write disposition, partitioning, and SQL.
5. Check downstream references before running the datamart.

## Deferred actions

The following are intentionally deferred to a later phase.

- Workflow definition create/update
- Transfer definition create/update
- Workflow task/dependency graph mutation
- Connector-specific transfer payload builders

These should be designed separately with stronger preflight validation and rollback notes.
