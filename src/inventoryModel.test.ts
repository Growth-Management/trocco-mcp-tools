import test from "node:test";
import assert from "node:assert/strict";
import { buildInventoryDatamart, buildSqlInventoryAnalysis, buildWorkflowDatamartIndex } from "./inventoryModel.js";

test("workflow index preserves task order and normalizes direct dependencies", () => {
  const workflow = {
    id: 3847,
    name: "SH_PLUS_BQ_RAISE_data_daily_new",
    tasks: [
      {
        task_identifier: 10,
        key: "source_model",
        type: "trocco_bigquery_datamart",
        trocco_bigquery_datamart_config: { definition_id: 8251 },
      },
      {
        task_identifier: 20,
        key: "aggregation_model",
        type: "trocco_bigquery_datamart",
        trocco_bigquery_datamart_config: { definition_id: 8269 },
      },
    ],
    task_dependencies: [{ source_task_identifier: 10, destination_task_identifier: 20 }],
  };

  const nodes = buildWorkflowDatamartIndex(workflow);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]?.datamart_definition_id, 8251);
  assert.equal(nodes[1]?.execution_order, 2);
  assert.deepEqual(nodes[1]?.direct_upstream_node_ids, ["10"]);
  assert.equal(nodes[1]?.direct_upstream_nodes[0]?.datamart_definition_id, 8251);
  assert.deepEqual(nodes[0]?.direct_downstream_node_ids, ["20"]);
});

test("inventory response separates CTEs from BigQuery source tables and orders search keys", () => {
  const query = `
    WITH base AS (
      SELECT customer_identifier, COUNT(*) AS order_count
      FROM \`analytics.raw.orders\`
      GROUP BY customer_identifier
    ), target_titles AS (
      SELECT * FROM base JOIN \`analytics.master.titles\` USING (customer_identifier)
    )
    SELECT * FROM target_titles
  `;
  const nodes = buildWorkflowDatamartIndex({
    tasks: [
      {
        task_identifier: 10,
        key: "source_model",
        type: "trocco_bigquery_datamart",
        trocco_bigquery_datamart_config: { definition_id: 8251 },
      },
      {
        task_identifier: 20,
        key: "aggregation_model",
        type: "trocco_bigquery_datamart",
        trocco_bigquery_datamart_config: { definition_id: 8269 },
      },
    ],
    task_dependencies: [{ source: 10, destination: 20 }],
  });
  const result = buildInventoryDatamart({
    id: 8269,
    name: "aggregation_model",
    datamart_bigquery_option: {
      query,
      destination_dataset: "aggregation",
      destination_table: "daily_orders",
      write_disposition: "truncate",
    },
  }, 8269, { includeQuery: false, workflowNodes: nodes });

  assert.equal("query" in result, false);
  assert.deepEqual(result.ctes, ["base", "target_titles"]);
  assert.deepEqual(result.source_tables, ["analytics.raw.orders", "analytics.master.titles"]);
  assert.equal(result.dependencies.workflow_nodes[0]?.datamart_definition_id, 8251);
  assert.deepEqual(result.search_keys.slice(0, 2).map((key) => key.type), ["datamart_name", "destination_table"]);
});

test("SQL analysis builds destination and source search keys", () => {
  const result = buildSqlInventoryAnalysis({
    query: "CREATE OR REPLACE TABLE `p.out.t` AS SELECT * FROM `p.raw.s`",
    datamartDefinitionId: 8251,
    name: "example_datamart",
    destinationFqtn: "p.out.t",
  });

  assert.deepEqual(result.source_tables, ["p.raw.s"]);
  assert.deepEqual(result.search_keys.slice(0, 4).map((key) => key.type), [
    "datamart_name",
    "destination_fqtn",
    "destination_table",
    "source_fqtn",
  ]);
});
