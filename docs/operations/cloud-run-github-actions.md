# Cloud Run GitHub Actions Operation

## Purpose

Use the manual `Cloud Run` GitHub Actions workflow to inspect or deploy the TROCCO MCP Cloud Run service when a local `gcloud` environment is not available.

The workflow supports two modes:

- `describe`: inspect the currently deployed Cloud Run revision and service URL.
- `deploy`: deploy the selected GitHub ref to Cloud Run using `gcloud run deploy --source .`.

## Required GitHub Secrets

Configure these repository secrets before running the workflow:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`: Workload Identity Provider resource name for GitHub Actions.
- `GCP_SERVICE_ACCOUNT`: Google service account email used by GitHub Actions.
- `MCP_AUTH_TOKEN`: MCP bearer token used only by post-deploy smoke tests.

The service account should have enough permissions to:

- describe and deploy the target Cloud Run service
- use Cloud Build source deployment
- read the Secret Manager secrets referenced by the Cloud Run service

## Required Google Secret Manager Secrets

The workflow defaults to these Secret Manager names:

- `trocco-api-key`: injected as `TROCCO_API_KEY`
- `trocco-mcp-auth-token`: injected as `MCP_AUTH_TOKEN`

You can override the secret names from the workflow dispatch inputs.

## Recommended Operation

1. Run the workflow in `describe` mode.
2. Confirm the latest ready revision and service URL.
3. If the revision predates the guarded datamart action implementation, run the workflow in `deploy` mode.
4. Enable `run_smoke` after deploy when the GitHub `MCP_AUTH_TOKEN` secret is configured.
5. Confirm `smoke:http` succeeds.
6. Confirm `smoke:actions` lists:
   - `get_datamart_job_status`
   - `run_datamart_job`
   - `update_datamart_definition`
7. Refresh or reconnect the ChatGPT MCP connector if tool discovery still shows only read tools.

## Safety Notes

The workflow smoke tests do not call mutating datamart operations.

- `smoke:http` calls `build_workflow_audit_payload`.
- `smoke:actions` only checks tool discovery and calls the guarded `get_datamart_job_status` unsupported response.

Do not use `run_datamart_job` or `update_datamart_definition` for generic deployment verification.
