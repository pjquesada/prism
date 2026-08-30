type Row = Record<string, unknown>;

export type FakeSessionDatabase = {
  guest_sessions: Row[];
  session_devices: Row[];
  pairing_codes: Row[];
  session_credentials: Row[];
  playback_state: Row[];
  active_preset_snapshots: Row[];
  session_feature_frames: Row[];
  session_feature_receipts: Row[];
};

const FORBIDDEN_PAIRING_KEYS = ["code", "code_hint", "plaintext_code", "pairing_code"];
const FORBIDDEN_CREDENTIAL_KEYS = ["secret", "token", "credential", "raw_secret", "plaintext"];

export function createFakeSessionDatabase(): FakeSessionDatabase {
  return {
    guest_sessions: [],
    session_devices: [],
    pairing_codes: [],
    session_credentials: [],
    playback_state: [],
    active_preset_snapshots: [],
    session_feature_frames: [],
    session_feature_receipts: [],
  };
}

type QueryAction = "select" | "insert" | "update" | "upsert" | "delete";

class FakeQuery implements PromiseLike<{
  data: unknown;
  error: { message: string; code?: string } | null;
}> {
  private action: QueryAction = "select";
  private payload: Row | null = null;
  private filters: Array<(row: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private wantSingle = false;
  private selectedColumns: string | null = null;

  constructor(
    private readonly db: FakeSessionDatabase,
    private readonly table: keyof FakeSessionDatabase,
  ) {}

  select(columns?: string): this {
    this.action = "select";
    this.selectedColumns = columns ?? null;
    return this;
  }

  insert(row: Row): this {
    this.action = "insert";
    this.payload = row;
    return this;
  }

  update(row: Row): this {
    this.action = "update";
    this.payload = row;
    return this;
  }

  upsert(row: Row): this {
    this.action = "upsert";
    this.payload = row;
    return this;
  }

  delete(): this {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push((row) => {
      const current = row[column];
      if (value === null) return current === null || current === undefined;
      return current === value;
    });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column]) > String(value));
    return this;
  }

  order(column: string, options: { ascending: boolean }): this {
    this.orderBy = { column, ascending: options.ascending };
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  maybeSingle(): Promise<{ data: Row | null; error: { message: string; code?: string } | null }> {
    this.wantSingle = true;
    return this.execute().then((result) => ({
      data: Array.isArray(result.data)
        ? ((result.data[0] as Row | undefined) ?? null)
        : (result.data as Row | null),
      error: result.error,
    }));
  }

  then<
    TResult1 = { data: unknown; error: { message: string; code?: string } | null },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
          data: unknown;
          error: { message: string; code?: string } | null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
    try {
      return Promise.resolve(this.run());
    } catch (error) {
      return Promise.resolve({
        data: null,
        error: { message: error instanceof Error ? error.message : "query_failed" },
      });
    }
  }

  private rows(): Row[] {
    return this.db[this.table];
  }

  private matched(): Row[] {
    let rows = this.rows().filter((row) => this.filters.every((fn) => fn(row)));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        if (left === right) return 0;
        const cmp = left < right ? -1 : 1;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount);
    }
    return rows;
  }

  private assertNoForbidden(row: Row): void {
    const keys = Object.keys(row);
    if (this.table === "pairing_codes") {
      const hit = keys.find((key) => FORBIDDEN_PAIRING_KEYS.includes(key));
      if (hit) {
        throw new Error(`plaintext pairing field not allowed: ${hit}`);
      }
    }
    if (this.table === "session_credentials") {
      const hit = keys.find((key) => FORBIDDEN_CREDENTIAL_KEYS.includes(key));
      if (hit) {
        throw new Error(`raw credential field not allowed: ${hit}`);
      }
    }
  }

  private run(): { data: unknown; error: { message: string; code?: string } | null } {
    if (this.action === "insert") {
      if (!this.payload) throw new Error("missing insert payload");
      this.assertNoForbidden(this.payload);
      if (this.table === "pairing_codes") {
        const hash = this.payload.code_hash;
        if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
          return {
            data: null,
            error: {
              message:
                "new row for relation pairing_codes violates check constraint pairing_codes_code_hash_hmac_chk",
              code: "23514",
            },
          };
        }
      }
      const row: Row = { ...this.payload };
      if (
        (this.table === "pairing_codes" ||
          this.table === "guest_sessions" ||
          this.table === "session_devices") &&
        !row.id
      ) {
        row.id = crypto.randomUUID();
      }
      this.rows().push(row);
      return { data: this.wantSingle ? row : [row], error: null };
    }
    if (this.action === "upsert") {
      if (!this.payload) throw new Error("missing upsert payload");
      this.assertNoForbidden(this.payload);
      const table = this.rows();
      const payload = this.payload;
      if (this.table === "session_credentials") {
        const idx = table.findIndex(
          (row) => row.session_id === payload.session_id && row.device_id === payload.device_id,
        );
        if (idx >= 0) {
          table[idx] = { ...table[idx], ...this.payload };
          return { data: table[idx], error: null };
        }
      }
      if (this.table === "session_feature_frames" || this.table === "session_feature_receipts") {
        const key = payload.session_id;
        const idx = table.findIndex((row) => row.session_id === key);
        if (idx >= 0) {
          table[idx] = { ...table[idx], ...this.payload };
          return { data: table[idx], error: null };
        }
      }
      table.push({ ...this.payload });
      return { data: this.payload, error: null };
    }
    if (this.action === "update") {
      if (!this.payload) throw new Error("missing update payload");
      this.assertNoForbidden(this.payload);
      const updated: Row[] = [];
      for (const row of this.matched()) {
        Object.assign(row, this.payload);
        updated.push(row);
      }
      return { data: this.wantSingle ? (updated[0] ?? null) : updated, error: null };
    }
    if (this.action === "delete") {
      const remaining = this.rows().filter((row) => !this.filters.every((fn) => fn(row)));
      this.db[this.table] = remaining;
      return { data: [], error: null };
    }
    if (this.table === "pairing_codes" && this.selectedColumns) {
      const requested = this.selectedColumns.split(",").map((part) => part.trim());
      const leftover = requested.find((column) => FORBIDDEN_PAIRING_KEYS.includes(column));
      if (leftover) {
        return {
          data: null,
          error: {
            message: `Could not find the '${leftover}' column of 'pairing_codes' in the schema cache`,
            code: "PGRST204",
          },
        };
      }
    }
    const selected = this.matched();
    return { data: this.wantSingle ? (selected[0] ?? null) : selected, error: null };
  }
}

export function createFakeAdminClient(db: FakeSessionDatabase) {
  const broadcasts: unknown[] = [];
  return {
    from: (relation: string) => {
      if (!(relation in db)) {
        throw new Error(`unknown table ${relation}`);
      }
      return new FakeQuery(db, relation as keyof FakeSessionDatabase);
    },
    channel(name: string) {
      return {
        httpSend: async (event: string, payload: unknown) => {
          broadcasts.push({ channel: name, type: "broadcast", event, payload });
          return { error: null };
        },
        send: async (message: { type: string; event: string; payload: unknown }) => {
          broadcasts.push({ channel: name, ...message });
          return { error: null };
        },
      };
    },
    __broadcasts: broadcasts,
  };
}

export function createFailingAdminClient(message = "simulated database error", code?: string) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message, code } }),
        }),
        limit: async () => ({ data: null, error: { message, code } }),
      }),
      insert: async () => ({ data: null, error: { message, code } }),
      update: () => ({
        eq: () => ({ error: { message, code } }),
      }),
    }),
  };
}

export function createStalePairingSchemaClient() {
  return createFailingAdminClient(
    "Could not find the 'revoked_at' column of 'pairing_codes' in the schema cache",
    "PGRST204",
  );
}

/** PostgREST cache missing `revoked_at` only. Inserts that omit the column succeed. */
export function createRevokedAtUnknownColumnClient() {
  const db = createFakeSessionDatabase();
  const inner = createFakeAdminClient(db);
  return {
    db,
    from(relation: string) {
      const query = inner.from(relation);
      if (relation !== "pairing_codes") return query;
      return {
        insert(row: Row) {
          if (Object.prototype.hasOwnProperty.call(row, "revoked_at")) {
            return Promise.resolve({
              data: null,
              error: {
                message:
                  "Could not find the 'revoked_at' column of 'pairing_codes' in the schema cache",
                code: "PGRST204",
              },
            });
          }
          return query.insert(row);
        },
        select: query.select.bind(query),
        update: query.update.bind(query),
        delete: query.delete.bind(query),
      };
    },
  };
}

/** Pre-hotfix pairing_codes: `code_hint` remains NOT NULL. */
export function createPreHotfixPairingSchemaClient() {
  const db = createFakeSessionDatabase();
  const inner = createFakeAdminClient(db);
  return {
    db,
    from(relation: string) {
      const query = inner.from(relation);
      if (relation !== "pairing_codes") return query;
      return {
        insert(row: Row) {
          if (row.code_hint == null) {
            return Promise.resolve({
              data: null,
              error: {
                message: 'null value in column "code_hint" violates not-null constraint',
                code: "23502",
              },
            });
          }
          return query.insert(row);
        },
        select: query.select.bind(query),
        update: query.update.bind(query),
        delete: query.delete.bind(query),
      };
    },
  };
}
