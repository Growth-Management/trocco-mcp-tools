import type { SqlAnalysis } from "./sqlAnalysis.js";

export type ResolvedDestination = {
  source: "api" | "sql_inferred" | "unknown";
  dataset?: string;
  table?: string;
  table_identifier?: string;
  operation?: string;
};

export type ResolvedWriteDisposition = {
  source: "api" | "sql_inferred" | "unknown";
  value: string;
  sql_inferred_value: string;
  api_value?: string;
};

export type DatamartAuditFields = {
  resolved_destination: ResolvedDestination;
  resolved_write_disposition: ResolvedWriteDisposition;
  risk_flags: string[];
};

export type DatamartForDownstream = {
  definition_id?: number;
  name?: string;
  task_identifier?: string;
  resolved_destination?: ResolvedDestination;
  sql_analysis?: SqlAnalysis;
};

export type DownstreamReference = {
  definition_id?: number;
  name?: string;
  task_identifier?: string;
};

export function buildDatamartAuditFields(args: {
  destinationDataset?: string;
  destinationTable?: string;
  writeDisposition?: string;
  sqlAnalysis: SqlAnalysis;
}): DatamartAuditFields {
  const resolvedDestination = resolveDestination({
    destinationDataset: args.destinationDataset,
    destinationTable: args.destinationTable,
    sqlAnalysis: args.sqlAnalysis,
  });
  const resolvedWriteDisposition = resolveWriteDisposition({
    writeDisposition: args.writeDisposition,
    sqlAnalysis: args.sqlAnalysis,
  });

  return {
    resolved_destination: resolvedDestination,
    resolved_write_disposition: resolvedWriteDisposition,
    risk_flags: buildRiskFlags({
      destinationDataset: args.destinationDataset,
      destinationTable: args.destinationTable,
      writeDisposition: args.writeDisposition,
      resolvedDestination,
      resolvedWriteDisposition,
      sqlAnalysis: args.sqlAnalysis,
    }),
  };
}

export function attachDownstreamReferences<T extends DatamartForDownstream>(datamarts: T[]): Array<T & { downstream_references: DownstreamReference[] }> {
  return datamarts.map((datamart) => {
    const destination = normalizeDestination(datamart.resolved_destination?.table_identifier);
    if (!destination) {
      return {
        ...datamart,
        downstream_references: [],
      };
    }

    return {
      ...datamart,
      downstream_references: datamarts
        .filter((candidate) => candidate.definition_id !== datamart.definition_id)
        .filter((candidate) =>
          (candidate.sql_analysis?.source_tables ?? []).some((sourceTable) => tableMatches(destination, normalizeDestination(sourceTable))),
        )
        .map((candidate) => ({
          definition_id: candidate.definition_id,
          name: candidate.name,
          task_identifier: candidate.task_identifier,
        })),
    };
  });
}

function resolveDestination(args: {
  destinationDataset?: string;
  destinationTable?: string;
  sqlAnalysis: SqlAnalysis;
}): ResolvedDestination {
  if (args.destinationDataset && args.destinationTable) {
    return {
      source: "api",
      dataset: args.destinationDataset,
      table: args.destinationTable,
      table_identifier: `${args.destinationDataset}.${args.destinationTable}`,
    };
  }

  const sqlDestination = args.sqlAnalysis.destinations[0];
  if (sqlDestination) {
    return {
      source: "sql_inferred",
      table_identifier: trimBackticks(sqlDestination.table),
      operation: sqlDestination.operation,
    };
  }

  return {
    source: "unknown",
  };
}

function resolveWriteDisposition(args: {
  writeDisposition?: string;
  sqlAnalysis: SqlAnalysis;
}): ResolvedWriteDisposition {
  if (args.writeDisposition) {
    return {
      source: "api",
      value: args.writeDisposition,
      api_value: args.writeDisposition,
      sql_inferred_value: args.sqlAnalysis.inferred_write_disposition,
    };
  }

  if (args.sqlAnalysis.inferred_write_disposition !== "unknown") {
    return {
      source: "sql_inferred",
      value: args.sqlAnalysis.inferred_write_disposition,
      sql_inferred_value: args.sqlAnalysis.inferred_write_disposition,
    };
  }

  return {
    source: "unknown",
    value: "unknown",
    sql_inferred_value: "unknown",
  };
}

function buildRiskFlags(args: {
  destinationDataset?: string;
  destinationTable?: string;
  writeDisposition?: string;
  resolvedDestination: ResolvedDestination;
  resolvedWriteDisposition: ResolvedWriteDisposition;
  sqlAnalysis: SqlAnalysis;
}): string[] {
  const flags = [];
  const hasApiDestination = Boolean(args.destinationDataset && args.destinationTable);

  if (!hasApiDestination) {
    flags.push("missing_api_destination");
  }
  if (args.resolvedDestination.source === "sql_inferred") {
    flags.push("sql_destination_inferred");
  }
  if (args.sqlAnalysis.destination_also_used_as_source) {
    flags.push("destination_also_used_as_source");
  }
  if (args.writeDisposition && args.sqlAnalysis.inferred_write_disposition === "unknown") {
    flags.push("api_write_disposition_but_sql_destination_unknown");
  }
  if (isWriteDispositionMismatch(args.resolvedWriteDisposition)) {
    flags.push("write_disposition_mismatch");
  }

  return flags;
}

function isWriteDispositionMismatch(resolvedWriteDisposition: ResolvedWriteDisposition): boolean {
  if (!resolvedWriteDisposition.api_value || resolvedWriteDisposition.sql_inferred_value === "unknown") {
    return false;
  }

  const apiValue = normalizeWriteDisposition(resolvedWriteDisposition.api_value);
  const sqlValue = normalizeWriteDisposition(resolvedWriteDisposition.sql_inferred_value);
  return apiValue !== sqlValue;
}

function normalizeWriteDisposition(value: string): string {
  if (value === "truncate" && value) {
    return "truncate";
  }
  return value;
}

function normalizeDestination(value: string | undefined): string | undefined {
  return value ? trimBackticks(value).toLowerCase() : undefined;
}

function tableMatches(destination: string, source: string | undefined): boolean {
  if (!source) {
    return false;
  }
  return source === destination || source.endsWith(`.${destination}`) || destination.endsWith(`.${source}`);
}

function trimBackticks(value: string): string {
  return value.replace(/^`|`$/g, "");
}
