import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { resolveWorkspaceLabelNames } from "../utils/resolve-workspace-label-names";
import {
  normalizeSavedViewDefinition,
  type SavedViewDefinition,
  type SavedViewFilterValues,
  storageDocuments,
} from "./contract";

import {
  runFocusFacets as runFocusFacetsSql,
  runFocusQuery as runFocusQuerySql,
} from "./focus-query";

type SavedViewRow = typeof schema.savedViewTable.$inferSelect;

export type SavedViewSummary = {
  id: string;
  name: string;
  schemaVersion: number;
  filters: unknown;
  sort: unknown;
  pinnedPosition: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SavedViewTask = {
  id: string;
  workspaceId: string;
  shortId: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  project: { id: string; name: string; slug: string };
  assignee: { id: string; name: string } | null;
  labels: string[];
  url: string;
};

export type SavedViewPage = {
  items: SavedViewTask[];
  nextCursor: string | null;
};

function viewSummary(row: SavedViewRow): SavedViewSummary {
  return {
    id: row.id,
    name: row.name,
    schemaVersion: row.schemaVersion,
    filters: row.filters,
    sort: row.sort,
    pinnedPosition: row.pinnedPosition,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

function notFound(): never {
  throw new HTTPException(404, { message: "Saved view not found" });
}

function conflict(message: string): never {
  throw new HTTPException(409, { message });
}

async function assertReferences(
  workspaceId: string,
  filters: SavedViewFilterValues,
): Promise<Map<string, string>> {
  const projects = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.workspaceId, workspaceId),
        inArray(schema.projectTable.id, filters.projectIds),
      ),
    );
  if (projects.length !== filters.projectIds.length) {
    badRequest("Every projectId must belong to the workspace");
  }

  if (filters.assigneeIds.length > 0) {
    const assignees = await db
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .innerJoin(
        schema.workspaceUserTable,
        eq(schema.workspaceUserTable.userId, schema.userTable.id),
      )
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          inArray(schema.userTable.id, filters.assigneeIds),
        ),
      );
    if (assignees.length !== filters.assigneeIds.length) {
      badRequest("Every assigneeId must belong to the workspace");
    }
  }

  return resolveWorkspaceLabelNames(workspaceId, filters.labelIds);
}

async function ownedView(
  viewId: string,
  workspaceId: string,
  ownerUserId: string,
): Promise<SavedViewRow> {
  const [row] = await db
    .select()
    .from(schema.savedViewTable)
    .where(
      and(
        eq(schema.savedViewTable.id, viewId),
        eq(schema.savedViewTable.workspaceId, workspaceId),
        eq(schema.savedViewTable.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  if (!row) notFound();
  return row;
}

function normalizeStoredDefinition(row: SavedViewRow): SavedViewDefinition {
  const filters = row.filters as Record<string, unknown>;
  return normalizeSavedViewDefinition({
    name: row.name,
    filters,
    sort: row.sort,
    pinnedPosition: row.pinnedPosition,
  });
}

export async function listSavedViews(
  workspaceId: string,
  ownerUserId: string,
  limit?: number,
): Promise<SavedViewSummary[]> {
  const rows = await db
    .select()
    .from(schema.savedViewTable)
    .where(
      and(
        eq(schema.savedViewTable.workspaceId, workspaceId),
        eq(schema.savedViewTable.ownerUserId, ownerUserId),
      ),
    )
    .orderBy(
      sql`case when ${schema.savedViewTable.pinnedPosition} is null then 1 else 0 end`,
      asc(schema.savedViewTable.pinnedPosition),
      asc(schema.savedViewTable.name),
    )
    .limit(Math.min(Math.max(limit ?? 50, 1), 100));
  return rows.map(viewSummary);
}

export async function getSavedView(
  viewId: string,
  workspaceId: string,
  ownerUserId: string,
): Promise<SavedViewSummary> {
  return viewSummary(await ownedView(viewId, workspaceId, ownerUserId));
}

export async function createSavedView(
  workspaceId: string,
  ownerUserId: string,
  input: unknown,
): Promise<SavedViewSummary> {
  const definition = normalizeSavedViewDefinition(input);
  await assertReferences(workspaceId, definition.filters);

  const duplicate = await db
    .select({ id: schema.savedViewTable.id })
    .from(schema.savedViewTable)
    .where(
      and(
        eq(schema.savedViewTable.workspaceId, workspaceId),
        eq(schema.savedViewTable.ownerUserId, ownerUserId),
        sql`lower(${schema.savedViewTable.name}) = lower(${definition.name})`,
      ),
    )
    .limit(1);
  if (duplicate.length > 0)
    conflict("A saved view with this name already exists");

  const documents = storageDocuments(definition);
  const [row] = await db
    .insert(schema.savedViewTable)
    .values({
      workspaceId,
      ownerUserId,
      name: definition.name,
      schemaVersion: definition.schemaVersion,
      filters: documents.filters,
      sort: documents.sort,
      pinnedPosition: definition.pinnedPosition,
    })
    .returning();
  if (!row)
    throw new HTTPException(500, { message: "Saved view was not created" });
  return viewSummary(row);
}

export async function updateSavedView(
  viewId: string,
  workspaceId: string,
  ownerUserId: string,
  input: unknown,
): Promise<SavedViewSummary> {
  const current = await ownedView(viewId, workspaceId, ownerUserId);
  const raw = input as { updatedAt?: unknown };
  if (typeof raw.updatedAt !== "string") conflict("updatedAt is required");
  const expected = new Date(raw.updatedAt);
  if (
    Number.isNaN(expected.getTime()) ||
    expected.getTime() !== current.updatedAt.getTime()
  ) {
    conflict("Saved view has changed; reload before updating");
  }

  const definition = normalizeSavedViewDefinition(input);
  await assertReferences(workspaceId, definition.filters);
  const duplicate = await db
    .select({ id: schema.savedViewTable.id })
    .from(schema.savedViewTable)
    .where(
      and(
        eq(schema.savedViewTable.workspaceId, workspaceId),
        eq(schema.savedViewTable.ownerUserId, ownerUserId),
        ne(schema.savedViewTable.id, viewId),
        sql`lower(${schema.savedViewTable.name}) = lower(${definition.name})`,
      ),
    )
    .limit(1);
  if (duplicate.length > 0)
    conflict("A saved view with this name already exists");

  const documents = storageDocuments(definition);
  const [row] = await db
    .update(schema.savedViewTable)
    .set({
      name: definition.name,
      schemaVersion: definition.schemaVersion,
      filters: documents.filters,
      sort: documents.sort,
      pinnedPosition: definition.pinnedPosition,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.savedViewTable.id, viewId),
        eq(schema.savedViewTable.workspaceId, workspaceId),
        eq(schema.savedViewTable.ownerUserId, ownerUserId),
        eq(schema.savedViewTable.updatedAt, current.updatedAt),
      ),
    )
    .returning();
  if (!row) conflict("Saved view has changed; reload before updating");
  return viewSummary(row);
}

export async function deleteSavedView(
  viewId: string,
  workspaceId: string,
  ownerUserId: string,
): Promise<{ id: string; deleted: true }> {
  await ownedView(viewId, workspaceId, ownerUserId);
  const [row] = await db
    .delete(schema.savedViewTable)
    .where(
      and(
        eq(schema.savedViewTable.id, viewId),
        eq(schema.savedViewTable.workspaceId, workspaceId),
        eq(schema.savedViewTable.ownerUserId, ownerUserId),
      ),
    )
    .returning({ id: schema.savedViewTable.id });
  if (!row) notFound();
  return { id: row.id, deleted: true };
}

export type SavedViewFacets = {
  total: number;
  queryMs: number;
  facets: {
    projects: Record<string, number>;
    statuses: Record<string, number>;
    priorities: Record<string, number>;
    assignees: Record<string, number>;
    labels: Record<string, number>;
  };
};

export async function runSavedView(
  viewId: string,
  workspaceId: string,
  ownerUserId: string,
  limit: number,
  cursorValue?: string,
): Promise<SavedViewPage> {
  const row = await ownedView(viewId, workspaceId, ownerUserId);
  const definition = normalizeStoredDefinition(row);
  return runFocusQuery(workspaceId, definition, limit, cursorValue);
}

export async function runFocusFacets(
  workspaceId: string,
  definition: SavedViewDefinition,
): Promise<SavedViewFacets> {
  const labelNamesById = await assertReferences(
    workspaceId,
    definition.filters,
  );
  return runFocusFacetsSql(workspaceId, definition, labelNamesById);
}

export async function runFocusQuery(
  workspaceId: string,
  definition: SavedViewDefinition,
  limit: number,
  cursorValue?: string,
): Promise<SavedViewPage> {
  const labelNamesById = await assertReferences(
    workspaceId,
    definition.filters,
  );
  return runFocusQuerySql(
    workspaceId,
    definition,
    limit,
    cursorValue,
    labelNamesById,
  );
}
export async function normalizeFocusInput(
  input: unknown,
): Promise<SavedViewDefinition> {
  const raw = input && typeof input === "object" ? input : {};
  return normalizeSavedViewDefinition({
    ...(raw as Record<string, unknown>),
    name: "Focus",
  });
}
