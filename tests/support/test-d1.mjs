import { DatabaseSync } from "node:sqlite";

class TestD1Statement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new TestD1Statement(this.database, this.sql, parameters.map((value) => value === undefined ? null : value));
  }

  first(column) {
    const row = this.database.prepare(this.sql).get(...this.parameters);
    if (!row) return null;
    return column ? row[column] ?? null : row;
  }

  all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.parameters), meta: {} };
  }

  run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

export function createTestD1() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  return {
    prepare(sql) { return new TestD1Statement(database, sql); },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
    exec(sql) { database.exec(sql); },
    query(sql, ...parameters) { return database.prepare(sql).all(...parameters); },
    first(sql, ...parameters) { return database.prepare(sql).get(...parameters) ?? null; },
    close() { database.close(); },
  };
}
