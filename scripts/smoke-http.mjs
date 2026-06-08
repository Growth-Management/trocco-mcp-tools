#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_ENDPOINT;
const token = process.env.MCP_AUTH_TOKEN;
const pipelineDefinitionId = Number(process.env.PIPELINE_DEFINITION_ID ?? 3847);

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
  version: "0.1.0",
});

const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  authProvider: {
    token: async () => token.trim(),
  },
});

try {
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(JSON.stringify({
    ok: true,
    check: "listTools",
    tools: tools.tools.map((tool) => tool.name),
  }, null, 2));

  const result = await client.callTool({
    name: "build_workflow_audit_payload",
    arguments: {
      pipeline_definition_id: pipelineDefinitionId,
    },
  });

  const text = result.content?.[0]?.type === "text" ? result.content[0].text : undefined;
  const payload = text ? JSON.parse(text) : null;

  console.log(JSON.stringify({
    ok: true,
    check: "build_workflow_audit_payload",
    pipeline_definition_id: pipelineDefinitionId,
    payload_ok: payload?.ok,
    workflow_name: payload?.workflow_name,
    datamart_count: Array.isArray(payload?.datamarts) ? payload.datamarts.length : null,
    datamart_error_count: Array.isArray(payload?.datamart_errors) ? payload.datamart_errors.length : null,
  }, null, 2));
} finally {
  await client.close();
}
