#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTroccoMcpServer } from "./server.js";

const server = createTroccoMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
