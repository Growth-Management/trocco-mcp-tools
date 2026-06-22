# Agent-driven Cloud Run deploy

This repository can deploy the TROCCO MCP server to Cloud Run through GitHub Actions. The purpose is to let an agent merge a code change, observe the deploy workflow, and then confirm that the ChatGPT / Agent Builder action schema has refreshed.

## Workflow

Workflow file:

- `.github/workflows/deploy-cloud-run.yml`

Triggers:

- `workflow_dispatch` for manual deploys from GitHub Actions
- `push` to `main` when runtime or deploy-related files change

The workflow runs:

1. Repository configuration check
2. `npm ci`
3. `npm run build`
4. Google Cloud authentication through Workload Identity Federation
5. `gcloud run deploy` with the same Secret Manager mapping documented in `README.md`
6. `npm run smoke:http`
7. `npm run smoke:actions`

## Required GitHub repository variables

Set these under repository Settings -> Secrets and variables -> Actions -> Variables:

- `GCP_PROJECT_ID`: Google Cloud project id that owns the Cloud Run service
- `GCP_WORKLOAD_IDENTITY_PROVIDER`: full Workload Identity Provider resource name
- `GCP_SERVICE_ACCOUNT`: deployer service account email

Optional variables:

- `CLOUD_RUN_SERVICE`: defaults to `trocco-mcp-tools`
- `CLOUD_RUN_REGION`: defaults to `asia-northeast1`

## Google Cloud prerequisites

The GitHub deployer service account should be able to:

- deploy Cloud Run services
- run Cloud Build source deployments
- write build artifacts as required by Cloud Build
- attach the runtime service account used by Cloud Run
- read `trocco-mcp-auth-token` for smoke tests

The Cloud Run runtime service account also needs access to the Secret Manager secrets used by the service:

- `trocco-api-key`
- `trocco-mcp-auth-token`

## Secret names used by deploy

The workflow expects these Secret Manager secret names to exist in the target project:

- `trocco-api-key`
- `trocco-mcp-auth-token`

They are attached to Cloud Run as environment variables:

- `TROCCO_API_KEY=trocco-api-key:latest`
- `MCP_AUTH_TOKEN=trocco-mcp-auth-token:latest`

## Agent operating flow

After this workflow is merged and the repository variables are configured:

1. The agent opens a PR for MCP changes.
2. CI validates the PR.
3. The agent merges the PR.
4. The push to `main` triggers Cloud Run deploy.
5. The agent inspects the GitHub Actions run and smoke-test result.
6. The agent checks action discovery in ChatGPT / Agent Builder.

If the action schema has not refreshed yet, reconnect or refresh the MCP server in ChatGPT / Agent Builder and re-check discovery.
