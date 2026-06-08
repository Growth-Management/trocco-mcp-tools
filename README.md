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

初期段階では読み取り専用のツールに限定し、TROCCO 側の設定変更や実行操作は対象外とします。

## 実装構成

実装言語と package 構成は次で進めます。

- Runtime: Node.js 20+
- Language: TypeScript
- MCP framework: `@modelcontextprotocol/sdk`
- Validation: `zod`
- Entry point: `src/index.ts`
- TROCCO API client: `src/troccoClient.ts`

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

Inspector 上では、まず `get_workflow` に次の input を渡して確認します。

```json
{
  "pipeline_definition_id": 3847
}
```

期待する確認ポイント:

- workflow 名が `SH_PLUS_BQ_RAISE_data_daily_new` であること
- `tasks[]` が返ること
- `task_dependencies[]` が返ること
- `datamart_tasks[]` に `type = trocco_bigquery_datamart` の task が抽出されること
- 各 datamart task で `definition_id` を確認できること

## MCP tools

### `get_workflow`

指定した workflow の構造を取得する最小ツールです。差分監査 payload の材料になる workflow metadata をそのまま確認できることを優先します。

TROCCO endpoint:

- `GET /api/pipeline_definitions/{pipeline_definition_id}`

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
  "name": "SH_PLUS_BQ_RAISE_data_daily_new",
  "tasks": [],
  "task_dependencies": [],
  "datamart_tasks": [],
  "raw": {}
}
```

実装済みのこと:

- `pipeline_definition_id` を必須 input として受け取る
- TROCCO workflow API から workflow definition を取得する
- `tasks[]` と `task_dependencies[]` を返す
- `type = trocco_bigquery_datamart` の task から `trocco_bigquery_datamart_config.definition_id` を抽出する
- API レスポンス全体を `raw` に保持する
- API error、認証 error、workflow 未存在 error を区別して返す

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
  "query_mode": "insert",
  "destination_dataset": "dataset",
  "destination_table": "table",
  "write_disposition": "append",
  "datamart_bigquery_option": {},
  "raw": {}
}
```

実装済みのこと:

- `datamart_definition_id` を必須 input として受け取る
- TROCCO datamart definition API から詳細を取得する
- `datamart_bigquery_option.query` を `sql` として返す
- `query_mode`、`destination_dataset`、`destination_table`、`write_disposition` を返す
- API レスポンス全体を `raw` に保持する

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
2. Inspector で `pipeline_definition_id=3847` の `get_workflow` を実行する
3. 返却された `datamart_tasks[].definition_id` を使って `get_datamart` を確認する
4. `build_workflow_audit_payload` を追加し、workflow と datamart 情報をまとめる
5. SQL から source table / destination 推定を行う軽量 parser を追加する
6. `delete from` + `insert` を `delete_insert` として扱う推定ロジックを追加する
7. 監査結果向けの normalized payload schema を固める
