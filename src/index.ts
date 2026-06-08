#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
    datamart_tasks: tasks
      .filter(isRecord)
      .filter((task) => task.type === "trocco_bigquery_datamart")
      .map((task) => ({
        identifier: readString(task.identifier),
        name: readString(task.name),
        type: readString(task.type),
        definition_id: readNestedNumber(task, ["trocco_bigquery_datamart_config", "definition_id"]),
        raw: task,
      })),
  };
}

function normalizeDatamart(datamart: TroccoDatamartDefinition, requestedId: number) {
  const bigqueryOption = isRecord(datamart.datamart_bigquery_option) ? datamart.datamart_bigquery_option : null;

  return {
    datamart_definition_id: readNumber(datamart.id) ?? requestedId,
    name: readString(datamart.name),
    data_warehouse_type: readString(datamart.data_warehouse_type),
    datamart_bigquery_option: bigqueryOption,
    sql: bigqueryOption ? readString(bigqueryOption.query) : undefined,
    query_mode: bigqueryOption ? readString(bigqueryOption.query_mode) : undefined,
    destination_dataset: bigqueryOption ? readString(bigqueryOption.destination_dataset) : undefined,
    destination_table: bigqueryOption ? readString(bigqueryOption.destination_table) : undefined,
    write_disposition: bigqueryOption ? readString(bigqueryOption.write_disposition) : undefined,
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
