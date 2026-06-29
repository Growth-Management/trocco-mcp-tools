# Workflow post-run audit actions

This note documents the guarded workflow-definition action added for TROCCO BigQuery post-run audits.

## Tool

### `patch_workflow_tasks`

Adds or updates selected workflow tasks and task dependencies on an existing TROCCO workflow definition.

TROCCO endpoint:

- `PATCH /api/pipeline_definitions/{pipeline_definition_id}`

The tool performs a read-before-write fetch, merges the requested tasks and dependencies into the current definition, and sends only the resulting `tasks` and `task_dependencies` arrays in the PATCH payload.

Required safety fields:

- `confirm: true`
- `change_reason`: human-readable reason for the workflow change
- optional `expected_current`: precondition values checked before PATCH is sent

Supported post-run audit task types:

- `bigquery_data_check`
- `if_else`
- `slack_notify`

## Example

```json
{
  "pipeline_definition_id": 3847,
  "upsert_tasks": [
    {
      "task_identifier": 101,
      "type": "bigquery_data_check",
      "bigquery_data_check_config": {
        "connection_id": 345,
        "name": "check_8278_critical",
        "query": "select count(*) as critical_count from `project.dataset.audit_table` where severity = 'critical'",
        "operator": "greater_equal",
        "query_result": 1,
        "accepts_null": false,
        "custom_variables": []
      }
    },
    {
      "task_identifier": 102,
      "type": "if_else",
      "if_else_config": {
        "condition": {
          "source_task_identifier": 101,
          "field": "check_result"
        }
      }
    },
    {
      "task_identifier": 103,
      "type": "slack_notify",
      "slack_notify_config": {
        "message": "TROCCO BigQuery post-run audit found critical differences."
      }
    }
  ],
  "upsert_task_dependencies": [
    {
      "source_task_identifier": 101,
      "destination_task_identifier": 102
    },
    {
      "source_task_identifier": 102,
      "destination_task_identifier": 103
    }
  ],
  "expected_current": {
    "name": "SH_PLUS_BQ_RAISE_data_daily_new"
  },
  "confirm": true,
  "change_reason": "Add guarded post-run BigQuery audit tasks after reviewed datamart execution."
}
```

## Read payload additions

`get_workflow` and `build_workflow_audit_payload` now expose normalized workflow information for post-run audit planning:

- `tasks`
- `task_dependencies`
- `notifications`
- `schedules`
- `normalized_tasks`
- `normalized_task_dependencies`
- `bigquery_data_check_tasks`
- `if_else_tasks`
- `slack_notify_tasks`
- `task_identifier` derived from `task_identifier`, `key`, or `identifier`
- `type_config` for each task's `<type>_config`
- `check_result_reference` on `bigquery_data_check` tasks to make downstream `if_else` planning explicit

## Safety notes

- This tool is intentionally narrower than a generic `update_workflow_definition` passthrough.
- It does not create or update schedules or notifications.
- It does not execute the workflow.
- Use `expected_current` for production changes, at minimum checking the workflow name or the exact pre-change task/dependency arrays when practical.
- Confirm the exact TROCCO `if_else_config` and `slack_notify_config` shapes from a fetched existing workflow or a safe staging workflow before production use.
