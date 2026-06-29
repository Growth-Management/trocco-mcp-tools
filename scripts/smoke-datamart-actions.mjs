#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_ENDPOINT;
const token = process.env.MCP_AUTH_TOKEN;
const datamartJobId = Number(process.env.DATAMART_JOB_ID ?? 1);

if (!endpoint) {
  console.error("MCP_ENDPOINT is required, for example https://example.run.app/mcp");
  process.exit(1);
}

if (!token) {
  console.error("MCP_AUTH_TOKEN is required.");
  process.exit(1);
}

const expectedTools = [
  "get_datamart_job_status",
  "run_datamart_job",
  "create_datamart_definition",
  "update_datamart_definition",
  "patch_workflow_tasks",
];

const client = new Client({
  name: "trocco-mcp-datamart-action-smoke-test",
  version: "0.1.0",
});

const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
    },
  },
});

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  const missingTools = expectedTools.filter((tool) => !toolNames.includes(tool));

  console.log(JSON.stringify({
    ok: missingTools.length === 0,
    check: "datamartAndWorkflowActionToolsListed",
    expected_tools: expectedTools,
    missing_tools: missingTools,
  }, null, 2));

  if (missingTools.length > 0) {
    process.exitCode = 1;
  } else {
    const result = await client.callTool({
      name: "get_datamart_job_status",
      arguments: {
        datamart_job_id: datamartJobId,
      },
    });

    const text = result.content?.[0]?.type === "text" ? result.content[0].text : undefined;
    const payload = text ? JSON.parse(text) : null;

    console.log(JSON.stringify({
      ok: payload?.ok === false && payload?.error?.code === "unsupported_operation",
      check: "get_datamart_job_status_guarded_response",
      datamart_job_id: datamartJobId,
      error_code: payload?.error?.code,
    }, null, 2));

    if (!(payload?.ok === false && payload?.error?.code === "unsupported_operation")) {
      process.exitCode = 1;
    }
  }
} finally {
  await client.close();
}
