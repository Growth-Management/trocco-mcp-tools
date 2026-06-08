#!/usr/bin/env node
import type { Request, Response, NextFunction } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createTroccoMcpServer } from "./server.js";

const app = createMcpExpressApp({ host: "0.0.0.0" });
const port = Number(process.env.PORT ?? 8080);
const authToken = process.env.MCP_AUTH_TOKEN;

app.get("/status", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "trocco-mcp-tools" });
});

app.use("/mcp", requireAuthToken);

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createTroccoMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request", error);
    await transport.close();
    await server.close();

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(port, "0.0.0.0", () => {
  console.log(`trocco-mcp-tools HTTP server listening on port ${port}`);
});

function requireAuthToken(req: Request, res: Response, next: NextFunction) {
  if (!authToken) {
    next();
    return;
  }

  const authorization = req.header("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerToken = req.header("x-mcp-auth-token");

  if (bearerToken === authToken || headerToken === authToken) {
    next();
    return;
  }

  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized",
    },
    id: null,
  });
}

function methodNotAllowed(_req: Request, res: Response) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
}
