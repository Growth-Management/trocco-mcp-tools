import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { attachDownstreamReferences, buildDatamartAuditFields } from "./auditModel.js";
import { analyzeSql } from "./sqlAnalysis.js";
import { TroccoClient, TroccoClientError, type TroccoDatamartDefinition, type TroccoWorkflow } from "./troccoClient.js";

const TaskIdentifierSchema = z.union([z.string().min(1), z.number().int().nonnegative()]);
const TaskKeySchema = z.string().min(1);
const LooseConfigSchema = z.object({}).passthrough();
const IfElseConfigSchema = z.object({
  name: z.string().min(1).optional(),
  condition_groups: z.object({
    set_type: z.enum(["and", "or"]),
    conditions: z.array(z.object({
      task_key: z.string().min(1).nullable().optional(),
      variable: z.string().min(1),
      operator: z.string().min(1),
      value: z.string(),
    }).passthrough()).min(1),
  }).passthrough(),
  destinations: z.object({
    if: z.array(z.string()),
    else: z.array(z.string()),
  }).passthrough(),
}).passthrough();
const SlackNotifyConfigSchema = z.object({
  name: z.string().min(1).optional(),
  connection_id: z.number().int().positive().optional(),
  message: z.string().optional(),
  ignore_error: z.boolean().optional(),
}).passthrough();

const BigQueryDataCheckTaskSchema = z.object({
  key: TaskKeySchema.optional(),
  task_identifier: TaskIdentifierSchema.optional(),
  type: z.literal("bigquery_data_check"),
  bigquery_data_check_config: z.object({
    connection_id: z.number().int().positive(),
    name: z.string().min(1),
    query: z.string().min(1),
    operator: z.string().min(1),
    query_result: z.union([z.string(), z.number(), z.boolean()]),
    accepts_null: z.boolean().optional(),
    custom_variables: z.array(LooseConfigSchema).optional(),
  }).passthrough(),
}).passthrough();

const IfElseTaskSchema = z.object({
  key: TaskKeySchema.optional(),
  task_identifier: TaskIdentifierSchema.optional(),
  type: z.literal("if_else"),
  if_else_config: IfElseConfigSchema,
}).passthrough();

const SlackNotifyTaskSchema = z.object({
  key: TaskKeySchema.optional(),
  task_identifier: TaskIdentifierSchema.optional(),
  type: z.literal("slack_notify"),
  slack_notify_config: SlackNotifyConfigSchema,
}).passthrough();

const WorkflowPatchTaskSchema = z.discriminatedUnion("type", [
  BigQueryDataCheckTaskSchema,
  IfElseTaskSchema,
  SlackNotifyTaskSchema,
]).refine((task) => readUpsertTaskKey(task) !== undefined, {
  message: "upsert task must include key, or a string/number task_identifier that can be used as key.",
});

const WorkflowDependencyPatchSchema = z.object({
  source: TaskIdentifierSchema.optional(),
  destination: TaskIdentifierSchema.optional(),
  source_task_identifier: TaskIdentifierSchema.optional(),
  destination_task_identifier: TaskIdentifierSchema.optional(),
}).strict().refine((dependency) => readDependencySource(dependency) !== undefined && readDependencyDestination(dependency) !== undefined, {
  message: "dependency must include source/destination or source_task_identifier/destination_task_identifier.",
});

const DatamartCreateBigQueryOptionSchema = z.object({
  bigquery_connection_id: z.number().int().positive(),
  query: z.string().min(1),
  query_mode: z.enum(["insert"]).optional(),
  destination_dataset: z.string().min(1),
  destination_table: z.string().min(1),
  write_disposition: z.enum(["append", "truncate", "incremental", "scd_type_2"]),
  schema_evolution_mode: z.enum(["detect_only", "auto_add_column"]).optional(),
  incremental_column: z.string().nullable().optional(),
  merge_keys: z.array(z.string()).min(1).optional(),
  on_matched_action: z.enum(["upsert", "skip"]).nullable().optional(),
  lookback_period_column: z.string().nullable().optional(),
  lookback_period_column_type: z.enum(["TIMESTAMP", "DATETIME", "DATE"]).nullable().optional(),
  lookback_period_timezone: z.string().nullable().optional(),
  lookback_period_from: z.number().int().nullable().optional(),
  lookback_period_to: z.number().int().nullable().optional(),
  lookback_period_unit: z.enum(["days", "hours"]).nullable().optional(),
  before_load: z.string().nullable().optional(),
  partitioning: z.enum(["ingestion_time", "time_unit_column"]).nullable().optional(),
  partitioning_time: z.enum(["DAY", "HOUR", "MONTH", "YEAR"]).nullable().optional(),
  partitioning_field: z.string().nullable().optional(),
  clustering_fields: z.array(z.string()).max(4).optional(),
}).strict();

const DatamartUpdatePatchSchema = DatamartCreateBigQueryOptionSchema.partial().strict().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: "patch must include at least one allowed field." },
);

export function createTroccoMcpServer() {
  const server = new McpServer({ name: "trocco-mcp-tools", version: "0.1.0" });

  server.tool(
    "get_workflow",
    "Fetch a TROCCO workflow definition by pipeline_definition_id for read-only audit preparation.",
    { pipeline_definition_id: z.number().int().positive() },
    async ({ pipeline_definition_id }) => {
      try {
        const client = new TroccoClient();
        const workflow = await client.getWorkflow(pipeline_definition_id);
        return jsonContent({ ok: true, ...normalizeWorkflow(workflow, pipeline_definition_id), raw: workflow });
      } catch (error) {
        return jsonContent(toErrorPayload(error));
      }
    },
  );

  server.tool(
    "patch_workflow_tasks",
    "Add or update post-run audit tasks and task_dependencies on a TROCCO workflow definition. Requires confirm: true.",
    {
      pipeline_definition_id: z.number().int().positive(),
      upsert_tasks: z.array(WorkflowPatchTaskSchema).min(1).optional(),
      upsert_task_dependencies: z.array(WorkflowDependencyPatchSchema).optional(),
      expected_current: z.record(z.unknown()).optional(),
      confirm: z.literal(true),
      change_reason: z.string().min(1),
    },
    async ({ pipeline_definition_id, upsert_tasks, upsert_task_dependencies, expected_current, change_reason }) => {
      try {
        const client = new TroccoClient();
        const current = await client.getWorkflow(pipeline_definition_id);
        const mismatches = buildWorkflowExpectedCurrentMismatches(current, expected_current);
        if (mismatches.length > 0) {
          return jsonContent({
            ok: false,
            pipeline_definition_id,
            error: {
              code: "precondition_failed",
              message: "Current workflow definition did not match expected_current values. Update was not sent.",
              detail: { mismatches },
            },
          });
        }

        const currentTasks = Array.isArray(current.tasks) ? current.tasks : [];
        const currentDependencies = Array.isArray(current.task_dependencies) ? current.task_dependencies : [];
        const nextTasks = mergeTasks(currentTasks, upsert_tasks ?? []);
        const nextDependencies = mergeDependencies(nextTasks, currentDependencies, upsert_task_dependencies ?? []);
        const updated = await client.updateWorkflowDefinition(pipeline_definition_id, {
          ...buildWorkflowPatchBase(current),
          tasks: nextTasks,
          task_dependencies: nextDependencies,
        });

        return jsonContent({
          ok: true,
          pipeline_definition_id: readNumber(updated.id) ?? pipeline_definition_id,
          upserted_task_keys: (upsert_tasks ?? []).map(readUpsertTaskKey).filter((key): key is string => key !== undefined),
          upserted_task_dependency_count: upsert_task_dependencies?.length ?? 0,
          change_reason,
          workflow: normalizeWorkflow(updated, pipeline_definition_id),
          raw: updated,
        });
      } catch (error) {
        return jsonContent(toErrorPayload(error));
      }
    },
  );

  server.tool(
    "get_datamart",
    "Fetch a TROCCO datamart definition by datamart_definition_id, including BigQuery SQL and option metadata when available.",
    { datamart_definition_id: z.number().int().positive() },
    async ({ datamart_definition_id }) => {
      try {
        const client = new TroccoClient();
        const datamart = await client.getDatamart(datamart_definition_id);
        return jsonContent({ ok: true, ...normalizeDatamart(datamart, datamart_definition_id), raw: datamart });
      } catch (error) {
        return jsonContent(toErrorPayload(error));
      }
    },
  );

  server.tool(
    "get_datamart_job_status",
    "Return an explicit unsupported response until a TROCCO datamart job status endpoint is confirmed.",
    { datamart_job_id: z.number().int().positive(), datamart_definition_id: z.number().int().positive().optional() },
    async ({ datamart_job_id, datamart_definition_id }) => jsonContent({
      ok: false,
      datamart_job_id,
      datamart_definition_id,
      error: {
        code: "unsupported_operation",
        message: "TROCCO API docs confirm POST /api/datamart_jobs, but a datamart job status GET endpoint has not been confirmed.",
        detail: {
          confirmed_datamart_job_endpoint: "POST /api/datamart_jobs",
          unconfirmed_status_endpoint: "GET /api/datamart_jobs/{datamart_job_id}",
        },
      },
    }),
  );

  server.tool(
    "run_datamart_job",
    "Run a TROCCO datamart job through POST /api/datamart_jobs. Requires confirm: true.",
    {
      datamart_definition_id: z.number().int().positive(),
      confirm: z.literal(true),
      run_reason: z.string().min(1),
      context_time: z.string().optional(),
      time_zone: z.string().optional(),
      memo: z.string().optional(),
      custom_variables: z.array(z.object({ name: z.string().min(1), value: z.string() }).strict()).optional(),
    },
    async ({ datamart_definition_id, run_reason, context_time, time_zone, memo, custom_variables }) => {
      try {
        const client = new TroccoClient();
        const job = await client.runDatamartJob({
          datamart_definition_id,
          context_time,
          time_zone,
          memo: memo ?? run_reason,
          custom_variables,
        });
        return jsonContent({
          ok: true,
          datamart_definition_id: readNumber(job.datamart_definition_id) ?? datamart_definition_id,
          datamart_job_id: readNumber(job.id),
          context_time: readString(job.context_time),
          raw: job,
        });
      } catch (error) {
        return jsonContent(toErrorPayload(error));
      }
    },
  );

  server.tool(
    "create_datamart_definition",
    "Create a BigQuery datamart definition through POST /api/datamart_definitions. Requires confirm: true.",
    {
      name: z.string().min(1),
      description: z.string().optional(),
      data_warehouse_type: z.literal("bigquery").optional(),
      datamart_bigquery_option: DatamartCreateBigQueryOptionSchema,
      confirm: z.literal(true),
      create_reason: z.string().min(1),
    },
    async ({ name, description, data_warehouse_type, datamart_bigquery_option, create_reason }) => {
      try {
        const client = new TroccoClient();
        const created = await client.createDatamartDefinition({
          name,
          description,
          data_warehouse_type: data_warehouse_type ?? "bigquery",
          datamart_bigquery_option: { query_mode: "insert", ...datamart_bigquery_option },
        });
        return jsonContent({
          ok: true,
          datamart_definition_id: readNumber(created.id),
          name: readString(created.name) ?? name,
          data_warehouse_type: readString(created.data_warehouse_type) ?? "bigquery",
          created_fields: ["name", "description", "data_warehouse_type", "datamart_bigquery_option"],
          create_reason,
          raw: created,
        });
      } catch (error) {
        return jsonContent(toErrorPayload(error));
      }
    },
  );

  server.tool(
    "update_datamart_definition",
    "Update selected BigQuery datamart definition fields through PATCH /api/datamart_definitions/{datamart_definition_id}. Requires confirm: true.",
    {
      datamart_definition_id: z.number().int().positive(),
      patch: DatamartUpdatePatchSchema,
      expected_current: z.record(z.unknown()).optional(),
      confirm: z.literal(true),
      change_reason: z.string().min(1),
    },
    async ({ datamart_definition_id, patch, expected_current, change_reason }) => {
      try {
        const client = new TroccoClient();
        const current = await client.getDatamart(datamart_definition_id);
        const mismatches = buildExpectedCurrentMismatches(current, expected_current);
        if (mismatches.length > 0) {
          return jsonContent({
            ok: false,
            datamart_definition_id,
            error: {
              code: "precondition_failed",
              message: "Current datamart definition did not match expected_current values. Update was not sent.",
              detail: { mismatches },
            },
          });
        }
        const updated = await client.updateDatamartDefinition(datamart_definition_id, { datamart_bigquery_option: patch });
        return jsonContent({
          ok: true,
          datamart_definition_id: readNumber(updated.id) ?? datamart_definition_id,
          updated_fields: Object.keys(patch),
          change_reason,
          raw: updated,
        });
      } catch (error) {
        return jsonContent(toErrorPayload(error));
      }
    },
  );

  server.tool(
    "build_workflow_audit_payload",
    "Fetch a TROCCO workflow and its BigQuery datamart definitions, returning a single read-only audit payload.",
    { pipeline_definition_id: z.number().int().positive() },
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
          datamarts: attachDownstreamReferences(datamarts),
          datamart_errors,
          raw: { workflow },
        });
      } catch (error) {
        return jsonContent(toErrorPayload(error));
      }
    },
  );

  return server;
}

function normalizeWorkflow(workflow: TroccoWorkflow, requestedId: number) {
  const tasks = Array.isArray(workflow.tasks) ? workflow.tasks : [];
  const taskDependencies = Array.isArray(workflow.task_dependencies) ? workflow.task_dependencies : [];
  const notifications = Array.isArray(workflow.notifications) ? workflow.notifications : [];
  const schedules = Array.isArray(workflow.schedules) ? workflow.schedules : [];

  return {
    pipeline_definition_id: readNumber(workflow.id) ?? requestedId,
    name: readString(workflow.name),
    tasks,
    task_dependencies: taskDependencies,
    notifications,
    schedules,
    normalized_tasks: tasks.filter(isRecord).map(normalizeWorkflowTask),
    normalized_task_dependencies: taskDependencies.filter(isRecord).map(normalizeWorkflowDependency),
    bigquery_data_check_tasks: tasks.filter(isRecord).filter((task) => task.type === "bigquery_data_check").map(normalizeWorkflowTask),
    if_else_tasks: tasks.filter(isRecord).filter((task) => task.type === "if_else").map(normalizeWorkflowTask),
    slack_notify_tasks: tasks.filter(isRecord).filter((task) => task.type === "slack_notify").map(normalizeWorkflowTask),
    datamart_tasks: tasks.filter(isRecord).filter((task) => task.type === "trocco_bigquery_datamart").map((task) => ({
      task_identifier: readTaskIdentifier(task),
      key: readTaskKey(task),
      identifier: readString(task.identifier),
      type: readString(task.type),
      definition_id: readNestedNumber(task, ["trocco_bigquery_datamart_config", "definition_id"]),
      raw: task,
    })),
  };
}

function normalizeWorkflowTask(task: Record<string, unknown>) {
  return {
    task_identifier: readTaskIdentifier(task),
    key: readTaskKey(task),
    identifier: readString(task.identifier),
    type: readString(task.type),
    type_config: readTaskTypeConfig(task),
    check_result_reference: buildCheckResultReference(task),
    raw: task,
  };
}

function normalizeWorkflowDependency(dependency: Record<string, unknown>) {
  return {
    source_task_identifier: readStringOrNumber(dependency.source_task_identifier) ?? readStringOrNumber(dependency.source),
    destination_task_identifier: readStringOrNumber(dependency.destination_task_identifier) ?? readStringOrNumber(dependency.destination),
    raw: dependency,
  };
}

function buildCheckResultReference(task: Record<string, unknown>) {
  if (task.type !== "bigquery_data_check") {
    return undefined;
  }
  return {
    task_key: readTaskKey(task),
    task_identifier: readTaskIdentifier(task),
    description: "Use this bigquery_data_check task key from a downstream if_else condition as task_key with variable=check_result.",
  };
}

function readTaskTypeConfig(task: Record<string, unknown>) {
  const type = readString(task.type);
  if (!type) {
    return undefined;
  }
  return task[`${type}_config`];
}

function buildWorkflowPatchBase(current: TroccoWorkflow): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const field of [
    "name",
    "resource_group_id",
    "description",
    "max_task_parallelism",
    "execution_timeout",
    "max_retries",
    "min_retry_interval",
    "is_concurrent_execution_skipped",
    "is_stopped_on_errors",
    "labels",
    "notifications",
    "schedules",
  ]) {
    if (field in current) {
      base[field] = current[field];
    }
  }
  return base;
}

function mergeTasks(currentTasks: unknown[], upsertTasks: Array<z.infer<typeof WorkflowPatchTaskSchema>>) {
  const nextTasks = currentTasks.filter(isRecord).map(normalizeTaskForWorkflowPatch);
  const keyToIndex = new Map<string, number>();
  for (const [index, task] of nextTasks.entries()) {
    const key = readString(task.key);
    if (key) {
      keyToIndex.set(key, index);
    }
  }

  let nextTaskIdentifier = maxTaskIdentifier(nextTasks) + 1;
  for (const task of upsertTasks) {
    const key = readUpsertTaskKey(task);
    if (!key) {
      throw new Error("upsert task must include key or task_identifier.");
    }

    const existingIndex = keyToIndex.get(key);
    const existingTask = existingIndex === undefined ? undefined : nextTasks[existingIndex];
    const assignedIdentifier = readNumber(existingTask?.task_identifier)
      ?? readNumber(task.task_identifier)
      ?? nextTaskIdentifier++;
    const taskPayload = normalizeUpsertTaskForWorkflowPatch(task, key, assignedIdentifier);

    if (existingIndex !== undefined) {
      nextTasks[existingIndex] = {
        ...existingTask,
        ...taskPayload,
      };
    } else {
      keyToIndex.set(key, nextTasks.length);
      nextTasks.push(taskPayload);
    }
  }
  return nextTasks;
}

function normalizeTaskForWorkflowPatch(task: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...task };
  const key = readTaskKey(task);
  if (!key) {
    throw new Error("existing workflow task is missing both key and task_identifier.");
  }
  payload.key = key;
  delete payload.identifier;

  const taskIdentifier = readNumber(task.task_identifier) ?? readNumericString(task.task_identifier);
  if (taskIdentifier === undefined) {
    delete payload.task_identifier;
  } else {
    payload.task_identifier = taskIdentifier;
  }
  return normalizeTaskConfigForWorkflowPatch(payload);
}

function normalizeUpsertTaskForWorkflowPatch(
  task: z.infer<typeof WorkflowPatchTaskSchema>,
  key: string,
  taskIdentifier: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...task, key, task_identifier: taskIdentifier };
  delete payload.identifier;
  return normalizeTaskConfigForWorkflowPatch(payload);
}

function normalizeTaskConfigForWorkflowPatch(task: Record<string, unknown>): Record<string, unknown> {
  if (task.type === "if_else" && isRecord(task.if_else_config)) {
    const ifElseConfig = { ...task.if_else_config };
    delete ifElseConfig.condition;
    task.if_else_config = ifElseConfig;
  }
  return task;
}

function maxTaskIdentifier(tasks: Array<Record<string, unknown>>): number {
  return tasks.reduce((max, task) => {
    const identifier = readNumber(task.task_identifier) ?? readNumericString(task.task_identifier);
    return identifier === undefined ? max : Math.max(max, identifier);
  }, 0);
}

function mergeDependencies(
  nextTasks: Array<Record<string, unknown>>,
  currentDependencies: unknown[],
  upsertDependencies: Array<z.infer<typeof WorkflowDependencyPatchSchema>>,
) {
  const taskKeyByIdentifier = buildTaskKeyByIdentifier(nextTasks);
  const nextDependencies = currentDependencies
    .filter(isRecord)
    .map((dependency) => normalizeDependencyForWorkflowPatch(dependency, taskKeyByIdentifier));
  const dependencyKeys = new Set(nextDependencies.map((dependency) => `${dependency.source}\u0000${dependency.destination}`));

  for (const dependency of upsertDependencies) {
    const source = resolveTaskReference(readDependencySource(dependency), taskKeyByIdentifier);
    const destination = resolveTaskReference(readDependencyDestination(dependency), taskKeyByIdentifier);
    if (!source || !destination) {
      throw new Error("dependency must include resolvable source and destination task keys.");
    }

    const dependencyKey = `${source}\u0000${destination}`;
    if (!dependencyKeys.has(dependencyKey)) {
      nextDependencies.push({ source, destination });
      dependencyKeys.add(dependencyKey);
    }
  }
  return nextDependencies;
}

function buildTaskKeyByIdentifier(tasks: Array<Record<string, unknown>>): Map<string, string> {
  const taskKeyByIdentifier = new Map<string, string>();
  for (const task of tasks) {
    const key = readString(task.key);
    const identifier = normalizeIdentifier(task.task_identifier);
    if (key && identifier) {
      taskKeyByIdentifier.set(identifier, key);
    }
  }
  return taskKeyByIdentifier;
}

function normalizeDependencyForWorkflowPatch(
  dependency: Record<string, unknown>,
  taskKeyByIdentifier: Map<string, string>,
): { source: string; destination: string } {
  const source = resolveTaskReference(
    readStringOrNumber(dependency.source) ?? readStringOrNumber(dependency.source_task_identifier),
    taskKeyByIdentifier,
  );
  const destination = resolveTaskReference(
    readStringOrNumber(dependency.destination) ?? readStringOrNumber(dependency.destination_task_identifier),
    taskKeyByIdentifier,
  );
  if (!source || !destination) {
    throw new Error("existing workflow dependency includes an unresolvable source or destination.");
  }
  return { source, destination };
}

function readUpsertTaskKey(task: { key?: string; task_identifier?: string | number }): string | undefined {
  return readString(task.key) ?? normalizeIdentifier(task.task_identifier);
}

function readDependencySource(dependency: { source?: string | number; source_task_identifier?: string | number }): string | number | undefined {
  return readStringOrNumber(dependency.source) ?? readStringOrNumber(dependency.source_task_identifier);
}

function readDependencyDestination(dependency: { destination?: string | number; destination_task_identifier?: string | number }): string | number | undefined {
  return readStringOrNumber(dependency.destination) ?? readStringOrNumber(dependency.destination_task_identifier);
}

function resolveTaskReference(reference: unknown, taskKeyByIdentifier: Map<string, string>): string | undefined {
  const normalized = normalizeIdentifier(reference);
  if (!normalized) {
    return undefined;
  }
  return taskKeyByIdentifier.get(normalized) ?? normalized;
}

function normalizeDatamart(datamart: TroccoDatamartDefinition, requestedId: number) {
  const bigqueryOption = isRecord(datamart.datamart_bigquery_option) ? datamart.datamart_bigquery_option : null;
  const sql = readBigQueryString(bigqueryOption, "query");
  const sqlAnalysis = analyzeSql(sql);
  const destinationDataset = readBigQueryString(bigqueryOption, "destination_dataset");
  const destinationTable = readBigQueryString(bigqueryOption, "destination_table");
  const writeDisposition = readBigQueryString(bigqueryOption, "write_disposition");

  return {
    datamart_definition_id: readNumber(datamart.id) ?? requestedId,
    name: readString(datamart.name),
    data_warehouse_type: readString(datamart.data_warehouse_type),
    datamart_bigquery_option: bigqueryOption,
    sql,
    sql_analysis: sqlAnalysis,
    query_mode: readBigQueryString(bigqueryOption, "query_mode"),
    destination_dataset: destinationDataset,
    destination_table: destinationTable,
    write_disposition: writeDisposition,
    ...buildDatamartAuditFields({ destinationDataset, destinationTable, writeDisposition, sqlAnalysis }),
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

function buildExpectedCurrentMismatches(current: TroccoDatamartDefinition, expectedCurrent: Record<string, unknown> | undefined): Array<{ field: string; expected: unknown; actual: unknown }> {
  if (!expectedCurrent) {
    return [];
  }
  const bigqueryOption = isRecord(current.datamart_bigquery_option) ? current.datamart_bigquery_option : {};
  return Object.entries(expectedCurrent).map(([field, expected]) => {
    const actual = field in bigqueryOption ? bigqueryOption[field] : current[field];
    return valuesEqual(actual, expected) ? null : { field, expected, actual };
  }).filter((mismatch): mismatch is { field: string; expected: unknown; actual: unknown } => mismatch !== null);
}

function buildWorkflowExpectedCurrentMismatches(current: TroccoWorkflow, expectedCurrent: Record<string, unknown> | undefined): Array<{ field: string; expected: unknown; actual: unknown }> {
  if (!expectedCurrent) {
    return [];
  }
  const normalized = normalizeWorkflow(current, readNumber(current.id) ?? 0);
  return Object.entries(expectedCurrent).map(([field, expected]) => {
    const actual = field in normalized ? normalized[field as keyof typeof normalized] : current[field];
    return valuesEqual(actual, expected) ? null : { field, expected, actual };
  }).filter((mismatch): mismatch is { field: string; expected: unknown; actual: unknown } => mismatch !== null);
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
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

function readNumericString(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

function readStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readTaskIdentifier(task: Record<string, unknown>): string | undefined {
  const identifier = readStringOrNumber(task.task_identifier) ?? readStringOrNumber(task.key) ?? readStringOrNumber(task.identifier);
  return normalizeIdentifier(identifier);
}

function readTaskKey(task: Record<string, unknown>): string | undefined {
  return readString(task.key) ?? normalizeIdentifier(task.task_identifier) ?? readString(task.identifier);
}

function normalizeIdentifier(identifier: unknown): string | undefined {
  if (typeof identifier === "string") {
    return identifier;
  }
  if (typeof identifier === "number") {
    return String(identifier);
  }
  return undefined;
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
