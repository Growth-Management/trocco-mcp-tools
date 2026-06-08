# trocco-mcp-tools

TROCCO API を Model Context Protocol (MCP) から扱うためのツール群です。まずは TROCCO workflow と BigQuery datamart の差分監査に必要な情報を読み取り専用で取得し、監査エージェントが SQL、出力先、更新方式、依存関係を整理できる状態を目指します。

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

## 既定の監査対象

明示指定がない場合、監査エージェントは次の workflow を既定対象として扱います。

- `pipeline_definition_id=3847`
- `SH_PLUS_BQ_RAISE_data_daily_new`

ただし、MCP ツール自体は任意の workflow id を受け取れるように設計します。

## 想定する環境変数

TROCCO API 接続に必要な認証情報は環境変数から読み込みます。名称は実装時に確定しますが、初期案は次の通りです。

- `TROCCO_API_KEY`: TROCCO API key
- `TROCCO_BASE_URL`: TROCCO API base URL。未指定時は公式 API の既定 URL を使う想定

認証情報はコード、README、テストデータに直接書き込まないでください。

## 初期 MCP ツール候補

### `get_workflow`

指定した workflow の構造を取得する最小ツールです。初回実装では、差分監査 payload の材料になる workflow metadata をそのまま確認できることを優先します。

想定 input:

```json
{
  "pipeline_definition_id": 3847
}
```

想定 output:

```json
{
  "pipeline_definition_id": 3847,
  "name": "SH_PLUS_BQ_RAISE_data_daily_new",
  "tasks": [],
  "task_dependencies": [],
  "raw": {}
}
```

最小実装で行うこと:

- `pipeline_definition_id` を必須 input として受け取る
- TROCCO workflow API から workflow definition を取得する
- `tasks[]` と `task_dependencies[]` を返す
- `type = trocco_bigquery_datamart` の task から `trocco_bigquery_datamart_config.definition_id` を確認できるようにする
- API レスポンス全体は `raw` に保持し、正規化漏れがあっても監査で確認できるようにする
- API error、認証 error、workflow 未存在 error を区別して返す

初回実装ではまだ行わないこと:

- datamart SQL の追加取得
- BigQuery lineage の完全解析
- destination / write_disposition の高度な推定
- workflow 実行や TROCCO 設定変更

### 次の候補: `get_datamart`

`get_workflow` で取得した datamart definition id を使い、BigQuery datamart definition の SQL と metadata を取得します。

### 次の候補: `build_workflow_audit_payload`

workflow、datamart、依存関係をまとめ、差分監査エージェントがそのまま監査コメントを書ける payload を返します。

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

## 初回コミットに含める内容

初回コミットでは、この README のみを追加します。目的、読み取り専用方針、既定 workflow、`get_workflow` の最小実装方針、次に追加するツール候補を明文化し、以後の実装 PR や Notion タスクと対応しやすい状態にします。

## 次の実装ステップ

1. MCP server の実装言語と package 構成を決める
2. TROCCO API client の最小 module を追加する
3. `get_workflow` tool schema を定義する
4. `get_workflow` で workflow definition を取得して返す
5. API error と認証 error の扱いを整理する
6. Inspector で `pipeline_definition_id=3847` の取得確認を行う
7. `get_datamart` の実装に進み、SQL と BigQuery option metadata を取得する
8. `build_workflow_audit_payload` で workflow と datamart 情報を監査向けに統合する
