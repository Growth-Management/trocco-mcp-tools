# trocco-mcp-tools

TROCCO API を Model Context Protocol (MCP) から扱うための読み取り専用ツール群です。まずは TROCCO workflow と BigQuery datamart の差分監査に必要な情報を取得し、監査エージェントが SQL、出力先、更新方式、依存関係を整理できる状態を目指します。

## 目的

このリポジトリでは、TROCCO と BigQuery を使った差分監査を支援するため、次の情報を MCP ツール経由で取得できるようにします。

- workflow の基本情報
- workflow task 一覧
- task dependency 一覧
- TROCCO BigQuery datamart task の definition id
- datamart SQL
- datamart の出力先 dataset / table
- write_disposition、incremental_column、merge_keys、lookback_period などの更新設定
- SQL から推定した source table / destination / write disposition

初期段階では読み取り専用のツールに限定し、TROCCO 側の設定変更や実行操作は対象外とします。

## 実装構成

- Runtime: Node.js 20+
- Language: TypeScript
- MCP framework: `@modelcontextprotocol/sdk`
- Validation: `zod`
- Entry point: `src/index.ts`
- TROCCO API client: `src/troccoClient.ts`
- SQL analysis: `src/sqlAnalysis.ts`

## 既定の監査対象

明示指定がない場合、監査エージェントは次の workflow を既定対象として扱います。

- `pipeline_definition_id=3847`
- `SH_PLUS_BQ_RAISE_data_daily_new`

ただし、MCP ツール自体は任意の workflow id を受け取れるように設計します。

## 環境変数

TROCCO API 接続に必要な認証情報は環境変数から読み込みます。

- `TROCCO_API_KEY`: TROCCO API key
- `TROCCO_BASE_URL`: TROCCO API base URL。未指定時は `https://trocco.io` を使います

認証情報はコード、README、テストデータに直接書き込まないでください。

TROCCO API は `Authorization: Token {{API KEY}}` 形式の header で認証します。

## セットアップ

```bash
npm install
npm run build
```

MCP server を stdio で起動します。

```bash
TROCCO_API_KEY=... npm run start
```

Inspector で確認します。

```bash
TROCCO_API_KEY=... npm run build
TROCCO_API_KEY=... npm run inspector
```

まず `get_workflow` に次の input を渡して確認します。

```json
{
  "pipeline_definition_id": 3847
}
```

期待する確認ポイント:

- workflow 名が `SH_PLUS_BQ_RAISE_data_daily_new` であること
- `tasks[]` が返ること
- `task_dependencies[]` が返ること
- `normalized_task_dependencies[]` に `source_task_identifier` / `destination_task_identifier` が返ること
- `datamart_tasks[]` に `type = trocco_bigquery_datamart` の task が抽出されること
- 各 datamart task で `definition_id` を確認できること

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

Output の主な項目:

```json
{
  "ok": true,
  "datamart_definition_id": 12345,
  "name": "example_datamart",
  "data_warehouse_type": "bigquery",
  "sql": "select * from dataset.table",
  "sql_analysis": {
    "source_tables": ["dataset.table"],
    "destinations": [],
    "inferred_write_disposition": "unknown",
    "destination_also_used_as_source": false
  },
  "query_mode": "insert",
  "destination_dataset": "dataset",
  "destination_table": "table",
  "write_disposition": "append",
  "merge_keys": [],
  "incremental_column": "updated_at",
  "lookback_period": {},
  "before_load": "DELETE FROM dataset.table WHERE ...",
  "partitioning": {},
  "clustering_fields": [],
  "datamart_bigquery_option": {},
  "raw": {}
}
```

### `build_workflow_audit_payload`

指定した workflow と、その配下の BigQuery datamart definition をまとめて取得します。監査コメント生成の入力 payload として使う最小統合 tool です。

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
  "datamarts": [],
  "datamart_errors": []
}
```

## SQL analysis

`sql_analysis` は SQL コメントを除去したうえで、監査に必要な最低限の候補を抽出します。

- `from` / `join` から source table 候補を抽出
- `create or replace table` / `insert into` / `delete from` / `merge` から destination 候補を抽出
- `delete from` と `insert into` の組み合わせを `delete_insert` として推定
- `merge` を `merge` として推定
- destination と source が同じ table の場合に `destination_also_used_as_source` を `true` にする

高度な SQL lineage parser ではないため、確定値ではなく監査用の候補値として扱います。

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

## BigQuery 差分監査で重視する観点

- SQL 本文
- 参照元 BigQuery table
- 出力先 BigQuery table
- write_disposition
- `delete_insert` の削除条件
- `incremental_column`
- `merge_keys`
- `lookback_period`
- workflow の task dependencies
- 実行順序
- 出力先 table が後続 datamart の参照元になっているか
- 差分更新なのに partition/date 条件が弱くないか
- append 扱いすべきでない処理が append になっていないか

## 次の実装ステップ

1. 実環境で `npm install` / `npm run build` を確認する
2. Inspector で `pipeline_definition_id=3847` の `build_workflow_audit_payload` を実行する
3. 返却された `datamarts[]`、`datamart_errors[]`、`sql_analysis` を確認する
4. downstream reference と risk flags を audit payload に追加する
5. 実レスポンスに合わせて normalized schema を調整する
