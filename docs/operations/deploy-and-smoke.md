# Deploy and Smoke Verification

## Purpose

Deploy the latest `main` branch of `trocco-mcp-tools` and verify the HTTP MCP endpoint before using it from ChatGPT.

This guide covers both the existing read-only audit smoke test and the datamart action smoke test added for guarded operation tools.

## Preconditions

- `gcloud` is authenticated to the target Google Cloud project.
- The target project can deploy Cloud Run services in `asia-northeast1`.
- Secret Manager contains the following secrets:
  - `trocco-api-key`
  - `trocco-mcp-auth-token`
- The local checkout is on latest `main`.

## Deploy

```bash
git checkout main
git pull --ff-only
npm install
npm run build

gcloud run deploy trocco-mcp-tools \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-secrets TROCCO_API_KEY=trocco-api-key:latest,MCP_AUTH_TOKEN=trocco-mcp-auth-token:latest
```

Record the deployed Cloud Run URL as `MCP_ENDPOINT` with `/mcp` appended.

```bash
export MCP_ENDPOINT="https://<cloud-run-url>/mcp"
export MCP_AUTH_TOKEN="$(gcloud secrets versions access latest --secret=trocco-mcp-auth-token)"
```

## Basic endpoint check

```bash
curl https://<cloud-run-url>/status
```

Expected response:

```json
{
  "ok": true,
  "service": "trocco-mcp-tools"
}
```

## Read-only audit smoke

```bash
export PIPELINE_DEFINITION_ID=3847
npm run smoke:http
```

Expected summary shape:

```json
{
  "ok": true,
  "check": "build_workflow_audit_payload",
  "pipeline_definition_id": 3847,
  "payload_ok": true,
  "workflow_name": "SH_PLUS_BQ_RAISE_data_daily_new",
  "datamart_count": 31,
  "datamart_error_count": 0
}
```

## Datamart action smoke

```bash
npm run smoke:actions
```

Expected checks:

- `get_datamart_job_status`, `run_datamart_job`, and `update_datamart_definition` are listed as MCP tools.
- `get_datamart_job_status` returns `unsupported_operation` until a TROCCO datamart job status endpoint is confirmed.

Expected summary shape:

```json
{
  "ok": true,
  "check": "datamartActionToolsListed",
  "missing_tools": []
}
```

```json
{
  "ok": true,
  "check": "get_datamart_job_status_guarded_response",
  "error_code": "unsupported_operation"
}
```

## Production safety notes

- Do not call `run_datamart_job` against production datamarts until the target definition and run reason are approved.
- Do not call `update_datamart_definition` unless rollback or manual restore is clear.
- For `update_datamart_definition`, prefer using `expected_current` so the tool performs read-before-write validation and stops on mismatch.
- Do not treat `get_datamart_job_status` as production-capable until Issue #4 is resolved.

## Issue tracking

- Deployment and smoke verification: #3
- Datamart job status endpoint strategy: #4
- Safe-environment validation for run/update actions: #5
