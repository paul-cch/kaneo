import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

/**
 * Workspace labels are templates. Assigning one to a task copies its name and
 * colour into a task-scoped row, so the two rows never share an id. Callers
 * that receive workspace label ids from the UI must resolve them to names
 * before matching task labels.
 */
export async function resolveWorkspaceLabelNames(
  workspaceId: string,
  labelIds: readonly string[],
): Promise<Map<string, string>> {
  const requestedIds = [...new Set(labelIds)];
  if (requestedIds.length === 0) return new Map();

  const rows = await db
    .select({ id: schema.labelTable.id, name: schema.labelTable.name })
    .from(schema.labelTable)
    .where(
      and(
        eq(schema.labelTable.workspaceId, workspaceId),
        isNull(schema.labelTable.taskId),
        inArray(schema.labelTable.id, requestedIds),
      ),
    );
  if (rows.length !== requestedIds.length) {
    throw new HTTPException(400, {
      message: "Every labelId must belong to the workspace",
    });
  }

  return new Map(rows.map((row) => [row.id, row.name]));
}
