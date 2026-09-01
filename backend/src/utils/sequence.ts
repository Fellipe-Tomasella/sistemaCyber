/** Numeração sequencial por workspace (order_number, member_number). */
import { sql as raw } from "../db/client.ts";

export async function nextNumber(table: string, column: string, workspaceId: string, start = 1): Promise<number> {
  const rows = await raw.unsafe(
    `select coalesce(max(${column}), ${start - 1}) + 1 as next from ${table} where workspace_id = $1`,
    [workspaceId],
  );
  return Number(rows[0]?.next ?? start);
}
