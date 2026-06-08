# trocco-mcp-tools

TROCCO API を Model Context Protocol (MCP) から扱うための読み取り専用ツール群です。TROCCO workflow と BigQuery datamart の差分監査に必要な情報を取得し、ChatGPT から監査エージェントが SQL、出力先、更新方式、依存関係、リスク候補を整理できる状態を目指します。

## 現在の優先方針

現在の最優先は、実監査そのものではなく、この TROCCO MCP server を ChatGPT から追加・接続できる状態にすることです。

進め方:

1. Cloud Run などに HTTP MCP endpoint を deploy する
2. `TROCCO_API_KEY` を安全に server 側へ注入する
3. ChatGPT から MCP server を追加する
4. ChatGPT から `build_workflow_audit_payload` を呼べることを確認する
5. 以後の監査は ChatGPT から MCP tool を利用して実行する

## 目的

このリポジトリでは、TROCCO と BigQuery を使った差分監査を支援するため、次の情報を MCP ツール経由で取得します。

- workflow の基本情報
- workflow task 一覧
- task dependency 一覧
- TROCCO BigQuery datamart task の definition id
- datamart SQL
- datamart の出力先 dataset / table
- write_disposition、incremental_column、merge_keys、lookback_period などの更新設定
- SQL から推定した source table / destination / write disposition
- resolved destination / resolved write disposition
- risk flags
- downstream references

初期段階では読み取り専用のツールに限定し、TROCCO 側の設定変更や実行操作は対象外とします。

## 実装構成

- Runtime: Node.js 20+
- Language: TypeScript
- MCP framework: `@modelcontextprotocol/sdk`
- Validation: `zod`
- Stdio entry point: `src/index.ts`
- HTTP entry point: `src/http.ts`
- Shared MCP server factory: `src/server.ts`
- TROCCO API client: `src/troccoClient.ts`
- SQL analysis: `src/sqlAnalysis.ts`
- Audit model: `src/auditModel.ts`
- HTTP smoke test: `scripts/smoke-http.mjs`

## Transport

この repository では 2 種類の起動方式を持ちます。

- stdio: Cloud Shell やローカルでの検証用
- Streamable HTTP: ChatGPT / Cloud Run 接続用

HTTP endpoint:

- `GET /status`: status check
- `POST /mcp`: MCP Streamable HTTP endpoint

`MCP_AUTH_TOKEN` を設定した場合、`POST /mcp` は `Authorization: Bearer <token>` または `x-mcp-auth-token: <token>` を要求します。

## 既定の監査対象

明示指定がない場合、監査エージェントは次の workflow を既定対象として扱います。

- `pipeline_definition_id=3847`
- `SH_PLUS_BQ_RAISE_data_daily_new`

## 環境変数

TROCCO API 接続に必要な認証情報は環境変数から読み込みます。

- `TROCCO_API_KEY`: TROCCO API key
- `TROCCO_BASE_URL`: TROCCO API base URL。未指定時は `https://trocco.io` を使います
- `PORT`: HTTP server port。Cloud Run では自動設定されます
- `MCP_AUTH_TOKEN`: HTTP MCP endpoint 用の bearer token
- `MCP_ENDPOINT`: smoke test 用 MCP endpoint URL
- `PIPELINE_DEFINITION_ID`: smoke test 用 workflow id。未指定時は `3847`

TROCCO API は `Authorization: Token {{API KEY}}` 形式の header で認証します。

## セットアップ

```bash
npm install
npm run build
```

stdio server を起動します。

```bash
TROCCO_API_KEY=... npm run start:stdio
```

HTTP server を起動します。

```bash
TROCCO_API_KEY=... MCP_AUTH_TOKEN=... npm run start:http
```

status check:

```bash
curl http://localhost:8080/status
```

## Cloud Run deployment

Secret Manager に TROCCO API key を保存します。

```bash
printf '%s' '<TROCCO_API_KEY>' | gcloud secrets create trocco-api-key --data-file=-
```

MCP endpoint 用 token は `trocco-mcp-auth-token` として保存済みの前提です。未作成の場合だけ次を実行します。

```bash
openssl rand -hex 32 | gcloud secrets create trocco-mcp-auth-token --data-file=-
```

Cloud Run に deploy します。

```bash
gcloud run deploy trocco-mcp-tools \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-secrets TROCCO_API_KEY=trocco-api-key:latest,MCP_AUTH_TOKEN=trocco-mcp-auth-token:latest
```

Deploy 後に確認します。

```bash
curl https://<cloud-run-url>/status
```

ChatGPT に追加するときの MCP endpoint は次です。

```text
https://<cloud-run-url>/mcp
```

ChatGPT 側の connector 設定では、`trocco-mcp-auth-token` と同じ値を bearer token として設定してください。

## HTTP smoke test

Cloud Run deploy 後、ChatGPT に追加する前に MCP client で疎通確認します。

```bash
export MCP_ENDPOINT="https://<cloud-run-url>/mcp"
export MCP_AUTH_TOKEN="$(gcloud secrets versions access latest --secret=trocco-mcp-auth-token)"
npm run smoke:http
```

期待する summary:

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

## Inspector / local verification

Inspector で stdio server を確認します。

```bash
TROCCO_API_KEY=... npm run build
TROCCO_API_KEY=... npm run inspector
```

Cloud Shell などで Inspector proxy が扱いづらい場合は、MCP SDK client から stdio server を直接呼び出して確認します。

## MCP tools

### `get_workflow`

指定した workflow の構造を取得します。

TROCCO endpoint:

- `GET /api/pipeline_definitions/{pipeline_definition_id}`

Input:

```json
{
  "pipeline_definition_id": 3847
}
```

### `get_datamart`

指定した datamart definition の SQL と BigQuery option metadata を取得します。

TROCCO endpoint:

- `GET /api/datamart_definitions/{datamart_definition_id}`

Input:

```json
{
  "datamart_definition_id": 12345
}
```

### `build_workflow_audit_payload`

指定した workflow と、その配下の BigQuery datamart definition をまとめて取得します。監査コメント生成の入力 payload として使う統合 tool です。

Input:

```json
{
  "pipeline_definition_id": 3847
}
```

Output の主な項目:

```json
{
  "ok": true,
  "pipeline_definition_id": 3847,
  "workflow_name": "SH_PLUS_BQ_RAISE_data_daily_new",
  "workflow": {},
  "datamarts": [
    {
      "definition_id": 12345,
      "name": "example_datamart",
      "destination_dataset": "dataset",
      "destination_table": "table",
      "write_disposition": "append",
      "sql_analysis": {},
      "resolved_destination": {},
      "resolved_write_disposition": {},
      "risk_flags": [],
      "downstream_references": []
    }
  ],
  "datamart_errors": []
}
```

## SQL analysis

`sql_analysis` は SQL コメントを除去したうえで、監査に必要な最低限の候補を抽出します。

- `from` / `join` から source table 候補を抽出
- `create or replace table` / `insert into` / `insert <table>` / `delete from` / `merge` から destination 候補を抽出
- `delete from` と `insert` の組み合わせを `delete_insert` として推定
- `merge` を `merge` として推定
- destination と source が同じ table の場合に `destination_also_used_as_source` を `true` にする

高度な SQL lineage parser ではないため、確定値ではなく監査用の候補値として扱います。

## Resolved audit fields

`resolved_destination` は、API metadata と SQL 推定を分けて扱います。

- API の `destination_dataset` / `destination_table` があれば `source = api`
- API destination がなく SQL 内 destination があれば `source = sql_inferred`
- どちらもなければ `source = unknown`

`resolved_write_disposition` は、API の `write_disposition` を優先しつつ、SQL 推定値も保持します。

- API の `write_disposition` があれば `source = api`
- API 値がなく SQL 推定値があれば `source = sql_inferred`
- どちらもなければ `unknown`

## Risk flags

現在の実装では、次の `risk_flags` を返します。

- `missing_api_destination`: API metadata に destination がない
- `sql_destination_inferred`: SQL から destination を推定した
- `destination_also_used_as_source`: destination と source が同じ table の可能性がある
- `api_write_disposition_but_sql_destination_unknown`: API write_disposition はあるが SQL から destination が取れない
- `write_disposition_mismatch`: API と SQL 推定の write_disposition が食い違う

## Downstream references

`downstream_references` は、ある datamart の resolved destination が、別 datamart の `sql_analysis.source_tables` に含まれる場合に返します。workflow dependency と合わせて確認することで、後続参照や依存漏れの監査に使います。

## Error payload

MCP tool は失敗時も JSON text として次の形を返します。

```json
{
  "ok": false,
  "error": {
    "code": "auth_error",
    "message": "TROCCO API authentication failed. Check TROCCO_API_KEY.",
    "status": 401,
    "endpoint": "https://trocco.io/api/...",
    "detail": {}
  }
}
```

Error code:

- `config_error`: `TROCCO_API_KEY` が未設定
- `auth_error`: 401 / 403
- `not_found`: 404。workflow または datamart が存在しない、もしくは権限がない
- `api_error`: その他の HTTP error
- `network_error`: TROCCO API に接続できない

## 次の確認ステップ

1. Cloud Run に最新の `main` を deploy する
2. `/status` と `/mcp` の認証を確認する
3. `npm run smoke:http` を実行する
4. ChatGPT に `https://<cloud-run-url>/mcp` を追加する
5. ChatGPT から `build_workflow_audit_payload` を実行し、監査に進む
