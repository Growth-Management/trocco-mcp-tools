#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_ENDPOINT;
const token = process.env.MCP_AUTH_TOKEN;
const pipelineDefinitionId = Number(process.env.PIPELINE_DEFINITION_ID ?? 3847);
const smokeDatamartId = Number(process.env.SMOKE_DATAMART_DEFINITION_ID ?? 8251);
const configuredExpectedCount = process.env.EXPECTED_DATAMART_COUNT === undefined
  ? null
  : Number(process.env.EXPECTED_DATAMART_COUNT);

if (!endpoint) {
  console.error("MCP_ENDPOINT is required, for example https://example.run.app/mcp");
  process.exit(1);
}

if (!token) {
  console.error("MCP_AUTH_TOKEN is required.");
  process.exit(1);
}

const client = new Client({
  name: "trocco-mcp-http-smoke-test",
  version: "0.2.0",
});

const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
    },
  },
});

function readPayload(result, toolName) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error(`${toolName} did not return text content.`);
  }

  const payload = JSON.parse(text);
  if (payload?.ok !== true) {
    throw new Error(`${toolName} failed: ${JSON.stringify(payload?.error ?? payload)}`);
  }
  return payload;
}

async function callTool(name, args) {
  return readPayload(await client.callTool({ name, arguments: args }), name);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateInventoryDatamart(datamart) {
  const missingFields = ["name", "query", "destination", "dependencies"]
    .filter((field) => datamart?.[field] === undefined || datamart?.[field] === null);
  assert(missingFields.length === 0, `Datamart ${datamart?.datamart_definition_id ?? "unknown"} is missing: ${missingFields.join(", ")}`);
}

function report(check, detail = {}) {
  console.log(JSON.stringify({ ok: true, check, ...detail }, null, 2));
}

try {
  await client.connect(transport);

  const discovery = await client.listTools();
  const toolNames = discovery.tools.map((tool) => tool.name);
  const requiredTools = [
    "get_workflow",
    "get_datamart",
    "build_workflow_audit_payload",
    "list_workflow_datamarts",
    "get_datamarts",
    "analyze_datamart_sql",
  ];
  const missingTools = requiredTools.filter((name) => !toolNames.includes(name));
  assert(missingTools.length === 0, `MCP discovery is missing tools: ${missingTools.join(", ")}`);
  report("listTools", { tool_count: toolNames.length, missing_tools: missingTools });

  const workflow = await callTool("get_workflow", {
    pipeline_definition_id: pipelineDefinitionId,
  });
  const workflowName = workflow.workflow_name ?? workflow.name;
  assert(workflowName, "get_workflow did not return a workflow name.");
  report("get_workflow", {
    pipeline_definition_id: pipelineDefinitionId,
    workflow_name: workflowName,
  });

  const smokeDatamart = await callTool("get_datamart", {
    datamart_definition_id: smokeDatamartId,
    pipeline_definition_id: pipelineDefinitionId,
    include_query: true,
  });
  validateInventoryDatamart(smokeDatamart);
  report("get_datamart", {
    datamart_definition_id: smokeDatamartId,
    name: smokeDatamart.name,
  });

  const audit = await callTool("build_workflow_audit_payload", {
    pipeline_definition_id: pipelineDefinitionId,
  });
  const auditDatamartCount = Array.isArray(audit.datamarts) ? audit.datamarts.length : null;
  const auditErrorCount = Array.isArray(audit.datamart_errors) ? audit.datamart_errors.length : null;
  assert(auditErrorCount === 0, `build_workflow_audit_payload returned ${auditErrorCount} datamart errors.`);
  report("build_workflow_audit_payload", {
    pipeline_definition_id: pipelineDefinitionId,
    workflow_name: audit.workflow_name,
    datamart_count: auditDatamartCount,
    datamart_error_count: auditErrorCount,
  });

  const pageSize = 10;
  const listedDatamarts = [];
  let offset = 0;
  let listTotal = null;
  do {
    const page = await callTool("list_workflow_datamarts", {
      pipeline_definition_id: pipelineDefinitionId,
      limit: pageSize,
      offset,
    });
    assert(Array.isArray(page.datamarts), "list_workflow_datamarts did not return datamarts.");
    assert(page.datamarts.every((item) => item.query === undefined), "list_workflow_datamarts leaked SQL query text.");
    listedDatamarts.push(...page.datamarts);
    listTotal = page.total;
    offset += page.datamarts.length;
    if (!page.has_more) break;
    assert(page.datamarts.length > 0, "list_workflow_datamarts returned has_more with an empty page.");
  } while (true);

  const listedIds = listedDatamarts.map((item) => item.datamart_definition_id);
  assert(listedIds.length === listTotal, `Listed ${listedIds.length} datamarts but total is ${listTotal}.`);
  assert(new Set(listedIds).size === listedIds.length, "list_workflow_datamarts returned duplicate IDs.");
  assert(auditDatamartCount === listedIds.length, "Audit and list datamart counts do not match.");
  const expectedCountMatches = configuredExpectedCount === null || configuredExpectedCount === listedIds.length;
  report("list_workflow_datamarts", {
    datamart_count: listedIds.length,
    expected_datamart_count: configuredExpectedCount,
    expected_count_matches: expectedCountMatches,
    pages: Math.ceil(listedIds.length / pageSize),
    unique_id_count: new Set(listedIds).size,
    query_bodies_returned: 0,
  });

  const sequentialSampleIds = listedIds.slice(0, 3);
  for (const datamartDefinitionId of sequentialSampleIds) {
    validateInventoryDatamart(await callTool("get_datamart", {
      datamart_definition_id: datamartDefinitionId,
      pipeline_definition_id: pipelineDefinitionId,
      include_query: true,
    }));
  }
  report("get_datamart_sequential_sample", {
    requested_ids: sequentialSampleIds,
    success_count: sequentialSampleIds.length,
    failure_count: 0,
  });

  const failures = [];
  let successCount = 0;
  for (const datamartDefinitionId of listedIds) {
    try {
      const datamart = await callTool("get_datamart", {
        datamart_definition_id: datamartDefinitionId,
        pipeline_definition_id: pipelineDefinitionId,
        include_query: true,
      });
      validateInventoryDatamart(datamart);
      successCount += 1;
    } catch (error) {
      failures.push({
        failed_datamart_definition_id: datamartDefinitionId,
        error_type: error instanceof Error ? error.name : "Error",
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  assert(failures.length === 0, `Full datamart inventory had failures: ${JSON.stringify(failures)}`);
  report("get_datamart_full_inventory", {
    requested_count: listedIds.length,
    success_count: successCount,
    failure_count: failures.length,
    failures,
  });

  const batchIds = listedIds.slice(0, Math.min(5, listedIds.length));
  const batch = await callTool("get_datamarts", {
    datamart_definition_ids: batchIds,
    pipeline_definition_id: pipelineDefinitionId,
    include_query: false,
  });
  assert(batch.datamarts?.length === batchIds.length, "get_datamarts did not return every requested datamart.");
  assert(batch.datamart_errors?.length === 0, "get_datamarts returned unexpected errors.");
  report("get_datamarts", {
    requested_count: batchIds.length,
    success_count: batch.datamarts.length,
    failure_count: batch.datamart_errors.length,
    query_included: false,
  });

  const analysis = await callTool("analyze_datamart_sql", {
    query: smokeDatamart.query,
    datamart_definition_id: smokeDatamartId,
    name: smokeDatamart.name,
    destination_fqtn: smokeDatamart.destination?.fqtn ?? undefined,
    destination_table: smokeDatamart.destination?.table ?? undefined,
  });
  assert(Array.isArray(analysis.source_tables), "analyze_datamart_sql did not return source_tables.");
  assert(Array.isArray(analysis.search_keys), "analyze_datamart_sql did not return search_keys.");
  report("analyze_datamart_sql", {
    datamart_definition_id: smokeDatamartId,
    source_table_count: analysis.source_tables.length,
    cte_count: analysis.ctes?.length ?? 0,
    search_key_count: analysis.search_keys.length,
  });
} finally {
  await client.close();
}
