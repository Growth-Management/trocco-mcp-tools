import { analyzeSql, type SqlAnalysis } from "./sqlAnalysis.js";
import type { TroccoDatamartDefinition, TroccoWorkflow } from "./troccoClient.js";

export type WorkflowDatamartNode = {
  datamart_definition_id: number;
  name: string | null;
  node_id: string | null;
  node_type: string;
  execution_order: number;
  direct_upstream_node_ids: string[];
  direct_downstream_node_ids: string[];
  direct_upstream_nodes: WorkflowDependencyNode[];
  enabled: boolean | null;
};

export type WorkflowDependencyNode = {
  node_id: string;
  type: string | null;
  datamart_definition_id: number | null;
  name: string | null;
};

export function buildWorkflowDatamartIndex(workflow: TroccoWorkflow) {
  const tasks = Array.isArray(workflow.tasks) ? workflow.tasks.filter(isRecord) : [];
  const dependencies = Array.isArray(workflow.task_dependencies)
    ? workflow.task_dependencies.filter(isRecord).map(normalizeDependency)
    : [];
  const taskByNodeId = new Map(tasks.flatMap((task): Array<[string, Record<string, unknown>]> => {
    const nodeId = readNodeId(task);
    return nodeId === null ? [] : [[nodeId, task]];
  }));

  return tasks.flatMap((task, executionOrder): WorkflowDatamartNode[] => {
    if (task.type !== "trocco_bigquery_datamart") {
      return [];
    }
    const definitionId = readNestedNumber(task, ["trocco_bigquery_datamart_config", "definition_id"]);
    if (!definitionId) {
      return [];
    }
    const nodeId = readNodeId(task);
    const config = isRecord(task.trocco_bigquery_datamart_config) ? task.trocco_bigquery_datamart_config : {};
    const upstreamIds = nodeId === null ? [] : dependencies.filter((item) => item.destination === nodeId).map((item) => item.source);
    return [{
      datamart_definition_id: definitionId,
      name: readString(config.name) ?? readString(task.name) ?? readString(task.key) ?? readString(task.identifier) ?? null,
      node_id: nodeId,
      node_type: "trocco_bigquery_datamart",
      execution_order: executionOrder + 1,
      direct_upstream_node_ids: upstreamIds,
      direct_downstream_node_ids: nodeId === null ? [] : dependencies.filter((item) => item.source === nodeId).map((item) => item.destination),
      direct_upstream_nodes: upstreamIds.map((upstreamId) => summarizeWorkflowNode(upstreamId, taskByNodeId.get(upstreamId))),
      enabled: readBoolean(task.enabled) ?? invertBoolean(task.disabled) ?? null,
    }];
  });
}

export function buildInventoryDatamart(
  datamart: TroccoDatamartDefinition,
  requestedId: number,
  options: {
    includeQuery: boolean;
    workflowNodes?: WorkflowDatamartNode[];
  },
) {
  const bigqueryOption = isRecord(datamart.datamart_bigquery_option) ? datamart.datamart_bigquery_option : {};
  const query = readString(bigqueryOption.query) ?? "";
  const analysis = analyzeSql(query);
  const destination = buildDestination(bigqueryOption, analysis);
  const currentNode = options.workflowNodes?.find((node) => node.datamart_definition_id === requestedId);
  const workflowNodes = currentNode?.direct_upstream_nodes ?? [];

  return {
    datamart_definition_id: readNumber(datamart.id) ?? requestedId,
    name: readString(datamart.name) ?? currentNode?.name ?? null,
    ...(options.includeQuery ? { query } : {}),
    destination,
    dependencies: {
      workflow_nodes: workflowNodes,
      bigquery_tables: analysis.source_tables.map(trimBackticks),
    },
    source_tables: analysis.source_tables.map(trimBackticks),
    ctes: analysis.ctes,
    sql_identifiers: analysis.identifiers,
    search_keys: buildSearchKeys({
      name: readString(datamart.name) ?? currentNode?.name ?? undefined,
      destination,
      analysis,
    }),
  };
}

function summarizeWorkflowNode(nodeId: string, task: Record<string, unknown> | undefined): WorkflowDependencyNode {
  if (!task) {
    return { node_id: nodeId, type: null, datamart_definition_id: null, name: null };
  }
  const type = readString(task.type) ?? null;
  const rawTypeConfig = type ? task[`${type}_config`] : undefined;
  const typeConfig = isRecord(rawTypeConfig) ? rawTypeConfig : {};
  return {
    node_id: nodeId,
    type,
    datamart_definition_id: type === "trocco_bigquery_datamart"
      ? readNestedNumber(task, ["trocco_bigquery_datamart_config", "definition_id"]) ?? null
      : null,
    name: readString(typeConfig.name) ?? readString(task.name) ?? readString(task.key) ?? readString(task.identifier) ?? null,
  };
}

export function buildSqlInventoryAnalysis(args: {
  query: string;
  datamartDefinitionId?: number;
  name?: string;
  destinationFqtn?: string;
  destinationTable?: string;
}) {
  const analysis = analyzeSql(args.query);
  const parsedDestination = args.destinationFqtn ? parseTableIdentifier(args.destinationFqtn) : undefined;
  const destination = {
    project: parsedDestination?.project ?? null,
    dataset: parsedDestination?.dataset ?? null,
    table: args.destinationTable ?? parsedDestination?.table ?? null,
    fqtn: args.destinationFqtn ? trimBackticks(args.destinationFqtn) : null,
    write_mode: analysis.inferred_write_disposition,
    source: "sql_inferred" as const,
  };
  return {
    datamart_definition_id: args.datamartDefinitionId,
    name: args.name,
    source_tables: analysis.source_tables.map(trimBackticks),
    ctes: analysis.ctes,
    sql_identifiers: analysis.identifiers,
    destinations: analysis.destinations,
    inferred_write_disposition: analysis.inferred_write_disposition,
    search_keys: buildSearchKeys({ name: args.name, destination, analysis }),
  };
}

function buildDestination(option: Record<string, unknown>, analysis: SqlAnalysis) {
  const dataset = readString(option.destination_dataset) ?? null;
  const table = readString(option.destination_table) ?? null;
  const apiProject = readString(option.destination_project)
    ?? readString(option.destination_project_id)
    ?? readString(option.project)
    ?? readString(option.project_id);
  const sqlDestination = analysis.destinations[0]?.table;
  const parsedSqlDestination = sqlDestination ? parseTableIdentifier(sqlDestination) : undefined;
  const project = apiProject ?? parsedSqlDestination?.project ?? null;
  const resolvedDataset = dataset ?? parsedSqlDestination?.dataset ?? null;
  const resolvedTable = table ?? parsedSqlDestination?.table ?? null;
  const fqtn = project && resolvedDataset && resolvedTable ? `${project}.${resolvedDataset}.${resolvedTable}` : null;
  return {
    project,
    dataset: resolvedDataset,
    table: resolvedTable,
    fqtn,
    write_mode: readString(option.write_disposition) ?? analysis.inferred_write_disposition,
    source: dataset && table ? "api" as const : sqlDestination ? "sql_inferred" as const : "unknown" as const,
  };
}

function buildSearchKeys(args: {
  name?: string;
  destination: { fqtn: string | null; table: string | null };
  analysis: SqlAnalysis;
}) {
  const candidates = [
    ...(args.name ? [{ type: "datamart_name", value: args.name, priority: 1 }] : []),
    ...(args.destination.fqtn ? [{ type: "destination_fqtn", value: args.destination.fqtn, priority: 1 }] : []),
    ...(args.destination.table ? [{ type: "destination_table", value: args.destination.table, priority: 2 }] : []),
    ...args.analysis.source_tables.map((value) => ({ type: "source_fqtn", value: trimBackticks(value), priority: 2 })),
    ...args.analysis.ctes.map((value) => ({ type: "cte", value, priority: 3 })),
    ...args.analysis.identifiers.slice(0, 20).map((value) => ({ type: "sql_identifier", value, priority: 4 })),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.type}\u0000${candidate.value.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseTableIdentifier(value: string) {
  const parts = trimBackticks(value).split(".");
  if (parts.length === 3) {
    return { project: parts[0], dataset: parts[1], table: parts[2] };
  }
  if (parts.length === 2) {
    return { project: null, dataset: parts[0], table: parts[1] };
  }
  return { project: null, dataset: null, table: parts[0] ?? null };
}

function normalizeDependency(value: Record<string, unknown>) {
  return {
    source: normalizeId(value.source_task_identifier) ?? normalizeId(value.source) ?? "",
    destination: normalizeId(value.destination_task_identifier) ?? normalizeId(value.destination) ?? "",
  };
}

function readNodeId(task: Record<string, unknown>): string | null {
  return normalizeId(task.task_identifier) ?? normalizeId(task.key) ?? normalizeId(task.identifier) ?? null;
}

function normalizeId(value: unknown): string | undefined {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

function readNestedNumber(record: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return readNumber(current);
}

function trimBackticks(value: string): string {
  return value.replace(/^`|`$/g, "");
}

function invertBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? !value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
