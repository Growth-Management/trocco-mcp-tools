#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeSql } from "./sqlAnalysis.js";
import { TroccoClient, TroccoClientError, type TroccoDatamartDefinition, type TroccoWorkflow } from "./troccoClient.js";

const server = new McpServer({
  name: "trocco-mcp-tools",
  version: "0.1.0",
});

server.tool(
  "get_workflow",
  "Fetch a TROCCO workflow definition by pipeline_definition_id for read-only audit preparation.",
  {
    pipeline_definition_id: z.number().int().positive(),
  },
  async ({ pipeline_definition_id }) => {
    try {
      const client = new TroccoClient();
      const workflow = await client.getWorkflow(pipeline_definition_id);
      return jsonContent({
        ok: true,
        ...normalizeWorkflow(workflow, pipeline_definition_id),
        raw: workflow,
      });
    } catch (error) {
      return jsonContent(toErrorPayload(error));
    }
  },
);

server.tool(
  "get_datamart",
  "Fetch a TROCCO datamart definition by datamart_definition_id, including BigQuery SQL and option metadata when available.",
  {
    datamart_definition_id: z.number().int().positive(),
  },
  async ({ datamart_definition_id }) => {
    try {
      const client = new TroccoClient();
      const datamart = await client.getDatamart(datamart_definition_id);
      return jsonContent({
        ok: true,
        ...normalizeDatamart(datamart, datamart_definition_id),
        raw: datamart,
      });
    } catch (error) {
      return jsonContent(toErrorPayload(error));
    }
  },
);

server.tool(
  "build_workflow_audit_payload",
  "Fetch a TROCCO workflow and its BigQuery datamart definitions, returning a single read-only audit payload.",
  {
    pipeline_definition_id: z.number().int().positive(),
  },
  async ({ pipeline_definition_id }) => {
    try {
      const client = new TroccoClient();
      const workflow = await client.getWorkflow(pipeline_definition_id);
      const normalizedWorkflow = normalizeWorkflow(workflow, pipeline_definition_id);
      const datamarts = [];
      const datamart_errors = [];

      for (const datamartTask of normalizedWorkflow.datamart_tasks) {
        if (!datamartTask.definition_id) {
          datamart_errors.push({
            task_identifier: datamartTask.task_identifier,
            error: {
              code: "missing_definition_id",
              message: "Datamart task does not include trocco_bigquery_datamart_config.definition_id.",
            },
          });
          continue;
        }

        try {
          const datamart = await client.getDatamart(datamartTask.definition_id);
          datamarts.push({
            task_identifier: datamartTask.task_identifier,
            task_key: datamartTask.key,
            task_type: datamartTask.type,
            definition_id: datamartTask.definition_id,
            ...normalizeDatamart(datamart, datamartTask.definition_id),
            raw: datamart,
          });
        } catch (error) {
          datamart_errors.push({
            task_identifier: datamartTask.task_identifier,
            definition_id: datamartTask.definition_id,
            ...toErrorPayload(error),
          });
        }
      }

      return jsonContent({
        ok: datamart_errors.length === 0,
        pipeline_definition_id: normalizedWorkflow.pipeline_definition_id,
        workflow_name: normalizedWorkflow.name,
        workflow: normalizedWorkflow,
        datamarts,
        datamart_errors,
        raw: {
          workflow,
        },
      });
    } catch (error) {
      return jsonContent(toErrorPayload(error));
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

function normalizeWorkflow(workflow: TroccoWorkflow, requestedId: number) {
  const tasks = Array.isArray(workflow.tasks) ? workflow.tasks : [];
  const taskDependencies = Array.isArray(workflow.task_dependencies) ? workflow.task_dependencies : [];

  return {
    pipeline_definition_id: readNumber(workflow.id) ?? requestedId,
    name: readString(workflow.name),
    tasks,
    task_dependencies: taskDependencies,
    normalized_task_dependencies: taskDependencies.filter(isRecord).map((dependency) => ({
      source_task_identifier: readString(dependency.source),
      destination_task_identifier: readString(dependency.destination),
      raw: dependency,
    })),
    datamart_tasks: tasks
      .filter(isRecord)
      .filter((task) => task.type === "trocco_bigquery_datamart")
      .map((task) => ({
        task_identifier: readString(task.key) ?? readString(task.identifier),
        key: readString(task.key),
        identifier: readString(task.identifier),
        type: readString(task.type),
        definition_id: readNestedNumber(task, ["trocco_bigquery_datamart_config", "definition_id"]),
        raw: task,
      })),
  };
}

function normalizeDatamart(datamart: TroccoDatamartDefinition, requestedId: number) {
  const bigqueryOption = isRecord(datamart.datamart_bigquery_option) ? datamart.datamart_bigquery_option : null;
  const sql = readBigQueryString(bigqueryOption, "query");

  return {
    datamart_definition_id: readNumber(datamart.id) ?? requestedId,
    name: readString(datamart.name),
    data_warehouse_type: readString(datamart.data_warehouse_type),
    datamart_bigquery_option: bigqueryOption,
    sql,
    sql_analysis: analyzeSql(sql),
    query_mode: readBigQueryString(bigqueryOption, "query_mode"),
    destination_dataset: readBigQueryString(bigqueryOption, "destination_dataset"),
    destination_table: readBigQueryString(bigqueryOption, "destination_table"),
    write_disposition: readBigQueryString(bigqueryOption, "write_disposition"),
    merge_keys: readBigQueryStringArray(bigqueryOption, "merge_keys"),
    incremental_column: readBigQueryString(bigqueryOption, "incremental_column"),
    lookback_period: {
      column: readBigQueryString(bigqueryOption, "lookback_period_column"),
      column_type: readBigQueryString(bigqueryOption, "lookback_period_column_type"),
      timezone: readBigQueryString(bigqueryOption, "lookback_period_timezone"),
      from: readBigQueryNumber(bigqueryOption, "lookback_period_from"),
      to: readBigQueryNumber(bigqueryOption, "lookback_period_to"),
      unit: readBigQueryString(bigqueryOption, "lookback_period_unit"),
    },
    before_load: readBigQueryString(bigqueryOption, "before_load"),
    partitioning: {
      type: readBigQueryString(bigqueryOption, "partitioning"),
      time: readBigQueryString(bigqueryOption, "partitioning_time"),
      field: readBigQueryString(bigqueryOption, "partitioning_field"),
    },
    clustering_fields: readBigQueryStringArray(bigqueryOption, "clustering_fields"),
  };
}

function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toErrorPayload(error: unknown) {
  if (error instanceof TroccoClientError) {
    return error.toPayload();
  }

  return {
    ok: false,
    error: {
      code: "api_error",
      message: error instanceof Error ? error.message : "Unexpected error.",
      detail: error instanceof Error ? { name: error.name } : error,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readBigQueryString(bigqueryOption: Record<string, unknown> | null, key: string): string | undefined {
  return bigqueryOption ? readString(bigqueryOption[key]) : undefined;
}

function readBigQueryNumber(bigqueryOption: Record<string, unknown> | null, key: string): number | undefined {
  return bigqueryOption ? readNumber(bigqueryOption[key]) : undefined;
}

function readBigQueryStringArray(bigqueryOption: Record<string, unknown> | null, key: string): string[] | undefined {
  return bigqueryOption ? readStringArray(bigqueryOption[key]) : undefined;
}

function readNestedNumber(record: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return readNumber(current);
}
