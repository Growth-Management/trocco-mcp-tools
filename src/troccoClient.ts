export type TroccoErrorCode =
  | "config_error"
  | "auth_error"
  | "not_found"
  | "api_error"
  | "network_error";

export type TroccoErrorPayload = {
  ok: false;
  error: {
    code: TroccoErrorCode;
    message: string;
    status?: number;
    endpoint?: string;
    detail?: unknown;
  };
};

export class TroccoClientError extends Error {
  readonly code: TroccoErrorCode;
  readonly status?: number;
  readonly endpoint?: string;
  readonly detail?: unknown;

  constructor(args: {
    code: TroccoErrorCode;
    message: string;
    status?: number;
    endpoint?: string;
    detail?: unknown;
  }) {
    super(args.message);
    this.name = "TroccoClientError";
    this.code = args.code;
    this.status = args.status;
    this.endpoint = args.endpoint;
    this.detail = args.detail;
  }

  toPayload(): TroccoErrorPayload {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        status: this.status,
        endpoint: this.endpoint,
        detail: this.detail,
      },
    };
  }
}

export type TroccoClientOptions = {
  apiKey?: string;
  baseUrl?: string;
};

export type TroccoWorkflow = Record<string, unknown> & {
  id?: number;
  name?: string;
  tasks?: unknown[];
  task_dependencies?: unknown[];
  notifications?: unknown[];
  schedules?: unknown[];
};

export type TroccoDatamartDefinition = Record<string, unknown> & {
  id?: number;
  name?: string;
  data_warehouse_type?: string;
  datamart_bigquery_option?: Record<string, unknown>;
};

export type TroccoDatamartJob = Record<string, unknown> & {
  id?: number;
  datamart_definition_id?: number;
  context_time?: string;
};

export type CreateDatamartDefinitionRequest = {
  name: string;
  description?: string;
  data_warehouse_type: "bigquery";
  datamart_bigquery_option: Record<string, unknown>;
};

export type RunDatamartJobRequest = {
  datamart_definition_id: number;
  context_time?: string;
  time_zone?: string;
  memo?: string;
  custom_variables?: Array<{
    name: string;
    value: string;
  }>;
};

export type UpdateDatamartDefinitionRequest = {
  datamart_bigquery_option: Record<string, unknown>;
};

export type UpdateWorkflowDefinitionRequest = {
  tasks?: unknown[];
  task_dependencies?: unknown[];
};

const DEFAULT_BASE_URL = "https://trocco.io";

export class TroccoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: TroccoClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.TROCCO_API_KEY;
    if (!apiKey) {
      throw new TroccoClientError({
        code: "config_error",
        message: "TROCCO_API_KEY is required.",
      });
    }

    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.TROCCO_BASE_URL ?? DEFAULT_BASE_URL);
  }

  async getWorkflow(pipelineDefinitionId: number): Promise<TroccoWorkflow> {
    return this.get<TroccoWorkflow>(`/api/pipeline_definitions/${pipelineDefinitionId}`);
  }

  async updateWorkflowDefinition(
    pipelineDefinitionId: number,
    request: UpdateWorkflowDefinitionRequest,
  ): Promise<TroccoWorkflow> {
    return this.patch<TroccoWorkflow>(`/api/pipeline_definitions/${pipelineDefinitionId}`, request);
  }

  async getDatamart(datamartDefinitionId: number): Promise<TroccoDatamartDefinition> {
    return this.get<TroccoDatamartDefinition>(`/api/datamart_definitions/${datamartDefinitionId}`);
  }

  async createDatamartDefinition(request: CreateDatamartDefinitionRequest): Promise<TroccoDatamartDefinition> {
    return this.post<TroccoDatamartDefinition>("/api/datamart_definitions", request);
  }

  async runDatamartJob(request: RunDatamartJobRequest): Promise<TroccoDatamartJob> {
    return this.post<TroccoDatamartJob>("/api/datamart_jobs", request);
  }

  async updateDatamartDefinition(
    datamartDefinitionId: number,
    request: UpdateDatamartDefinitionRequest,
  ): Promise<TroccoDatamartDefinition> {
    return this.patch<TroccoDatamartDefinition>(`/api/datamart_definitions/${datamartDefinitionId}`, request);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  private async request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const endpoint = `${this.baseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Token ${this.apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new TroccoClientError({
        code: "network_error",
        message: "Failed to connect to TROCCO API.",
        endpoint,
        detail: serializeError(error),
      });
    }

    const responseBody = await parseResponseBody(response);

    if (!response.ok) {
      throw new TroccoClientError({
        code: classifyHttpStatus(response.status),
        message: buildHttpErrorMessage(response.status),
        status: response.status,
        endpoint,
        detail: responseBody,
      });
    }

    return responseBody as T;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function classifyHttpStatus(status: number): TroccoErrorCode {
  if (status === 401 || status === 403) {
    return "auth_error";
  }
  if (status === 404) {
    return "not_found";
  }
  return "api_error";
}

function buildHttpErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "TROCCO API authentication failed. Check TROCCO_API_KEY.";
  }
  if (status === 404) {
    return "Requested TROCCO resource was not found.";
  }
  return `TROCCO API request failed with status ${status}.`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return error;
}
