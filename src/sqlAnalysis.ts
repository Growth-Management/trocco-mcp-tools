export type SqlDestination = {
  operation: "create_or_replace_table" | "insert_into" | "delete_from" | "merge_into";
  table: string;
};

export type SqlWriteDispositionInference = "delete_insert" | "merge" | "append" | "truncate" | "unknown";

export type SqlAnalysis = {
  source_tables: string[];
  destinations: SqlDestination[];
  inferred_write_disposition: SqlWriteDispositionInference;
  has_delete_statement: boolean;
  has_insert_statement: boolean;
  has_merge_statement: boolean;
  has_create_or_replace_table_statement: boolean;
  destination_also_used_as_source: boolean;
};

const TABLE_IDENTIFIER_PATTERN = "`[^`]+`|[A-Za-z0-9_$-]+(?:\\.[A-Za-z0-9_$-]+){1,2}";

export function analyzeSql(sql: string | undefined): SqlAnalysis {
  const normalizedSql = stripSqlComments(sql ?? "");
  const sourceTables = unique(extractSourceTables(normalizedSql));
  const destinations = extractDestinations(normalizedSql);
  const destinationTables = unique(destinations.map((destination) => normalizeTableIdentifier(destination.table)));
  const normalizedSourceTables = sourceTables.map(normalizeTableIdentifier);
  const hasDeleteStatement = destinations.some((destination) => destination.operation === "delete_from");
  const hasInsertStatement = destinations.some((destination) => destination.operation === "insert_into");
  const hasMergeStatement = destinations.some((destination) => destination.operation === "merge_into");
  const hasCreateOrReplaceTableStatement = destinations.some(
    (destination) => destination.operation === "create_or_replace_table",
  );

  return {
    source_tables: sourceTables,
    destinations,
    inferred_write_disposition: inferWriteDisposition({
      hasDeleteStatement,
      hasInsertStatement,
      hasMergeStatement,
      hasCreateOrReplaceTableStatement,
    }),
    has_delete_statement: hasDeleteStatement,
    has_insert_statement: hasInsertStatement,
    has_merge_statement: hasMergeStatement,
    has_create_or_replace_table_statement: hasCreateOrReplaceTableStatement,
    destination_also_used_as_source: destinationTables.some((destination) => normalizedSourceTables.includes(destination)),
  };
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n\r]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

function extractSourceTables(sql: string): string[] {
  return extractTables(sql, new RegExp(`\\b(?:from|join)\\s+(${TABLE_IDENTIFIER_PATTERN})`, "gi"));
}

function extractDestinations(sql: string): SqlDestination[] {
  return [
    ...extractTables(sql, new RegExp(`\\bcreate\\s+or\\s+replace\\s+table\\s+(${TABLE_IDENTIFIER_PATTERN})`, "gi")).map(
      (table) => ({ operation: "create_or_replace_table" as const, table }),
    ),
    ...extractTables(sql, new RegExp(`\\binsert\\s+into\\s+(${TABLE_IDENTIFIER_PATTERN})`, "gi")).map((table) => ({
      operation: "insert_into" as const,
      table,
    })),
    ...extractTables(sql, new RegExp(`\\bdelete\\s+from\\s+(${TABLE_IDENTIFIER_PATTERN})`, "gi")).map((table) => ({
      operation: "delete_from" as const,
      table,
    })),
    ...extractTables(sql, new RegExp(`\\bmerge\\s+${optionalInto()}(${TABLE_IDENTIFIER_PATTERN})`, "gi")).map((table) => ({
      operation: "merge_into" as const,
      table,
    })),
  ];
}

function extractTables(sql: string, pattern: RegExp): string[] {
  const tables = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const table = match[1];
    if (table) {
      tables.push(table);
    }
  }
  return tables;
}

function inferWriteDisposition(args: {
  hasDeleteStatement: boolean;
  hasInsertStatement: boolean;
  hasMergeStatement: boolean;
  hasCreateOrReplaceTableStatement: boolean;
}): SqlWriteDispositionInference {
  if (args.hasDeleteStatement && args.hasInsertStatement) {
    return "delete_insert";
  }
  if (args.hasMergeStatement) {
    return "merge";
  }
  if (args.hasCreateOrReplaceTableStatement) {
    return "truncate";
  }
  if (args.hasInsertStatement) {
    return "append";
  }
  return "unknown";
}

function normalizeTableIdentifier(table: string): string {
  return table.replace(/^`|`$/g, "").toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function optionalInto(): string {
  return "(?:into\\s+)?";
}
