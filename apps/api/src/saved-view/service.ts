import { and, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  decodeSavedViewCursor,
  encodeSavedViewCursor,
  normalizeSavedViewDefinition,
  SAVED_VIEW_MAX_PAGE_SIZE,
  type SavedViewCursor,
  type SavedViewCursorValue,
  type SavedViewDefinition,
  type SavedViewFilterValues,
  type SavedViewSortTerm,
  storageDocuments,
} from "./contract";

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
): Promise<void> {
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

  if (filters.labelIds.length > 0) {
    const labels = await db
      .select({
        id: schema.labelTable.id,
        workspaceId: schema.labelTable.workspaceId,
        projectWorkspaceId: schema.projectTable.workspaceId,
      })
      .from(schema.labelTable)
      .leftJoin(
        schema.taskTable,
        eq(schema.labelTable.taskId, schema.taskTable.id),
      )
      .leftJoin(
        schema.projectTable,
        eq(schema.taskTable.projectId, schema.projectTable.id),
      )
      .where(inArray(schema.labelTable.id, filters.labelIds));
    const accessible = labels.filter(
      (label) =>
        label.workspaceId === workspaceId ||
        label.projectWorkspaceId === workspaceId,
    );
    if (accessible.length !== filters.labelIds.length) {
      badRequest("Every labelId must belong to the workspace");
    }
  }
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
): Promise<SavedViewSummary[]> {
  const rows = await db
    .select()
    .from(schema.savedViewTable)
    .where(
      and(
        eq(schema.savedViewTable.workspaceId, workspaceId),
        eq(schema.savedViewTable.ownerUserId, ownerUserId),
      ),
    );
  return rows
    .sort((a, b) => {
      if (a.pinnedPosition === null && b.pinnedPosition !== null) return 1;
      if (a.pinnedPosition !== null && b.pinnedPosition === null) return -1;
      return (
        (a.pinnedPosition ?? Number.MAX_SAFE_INTEGER) -
          (b.pinnedPosition ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name)
      );
    })
    .map(viewSummary);
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

type TaskRow = {
  id: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  number: number | null;
  title: string;
  status: string;
  priority: string | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  columnIsFinal: boolean | null;
  assigneeId: string | null;
  assigneeName: string | null;
};

const priorityRank: Record<string, number> = {
  "no-priority": 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

function sortValue(
  task: Pick<
    TaskRow,
    "id" | "priority" | "dueDate" | "updatedAt" | "createdAt" | "title"
  >,
  field: SavedViewSortTerm["field"],
): SavedViewCursorValue {
  switch (field) {
    case "priority":
      return priorityRank[task.priority ?? "no-priority"] ?? 0;
    case "dueDate":
      return task.dueDate?.getTime() ?? null;
    case "updatedAt":
      return task.updatedAt.getTime();
    case "createdAt":
      return task.createdAt.getTime();
    case "title":
      return task.title.toLocaleLowerCase();
    case "taskId":
      return task.id;
  }
}

function compareSortValues(
  left: SavedViewCursorValue,
  right: SavedViewCursorValue,
  term: SavedViewSortTerm,
): number {
  const direction = term.direction === "asc" ? 1 : -1;
  if (left === null || right === null) {
    if (left === right) return 0;
    const nullsLast = term.nulls !== "first";
    return left === null ? (nullsLast ? 1 : -1) : nullsLast ? -1 : 1;
  }
  if (left === right) return 0;
  return (left < right ? -1 : 1) * direction;
}

function compareValues(
  a: TaskRow,
  b: TaskRow,
  term: SavedViewSortTerm,
): number {
  return compareSortValues(
    sortValue(a, term.field),
    sortValue(b, term.field),
    term,
  );
}

function isDueMatch(
  due: SavedViewFilterValues["due"],
  date: Date | null,
): boolean {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (due === "any") return true;
  if (due === "no-due-date") return date === null;
  if (!date) return false;
  if (due === "overdue") return date < start;
  if (due === "today") return date >= start && date < end;
  const days = due === "next-7-days" ? 7 : 30;
  const horizon = new Date(start);
  horizon.setDate(horizon.getDate() + days + 1);
  return date >= start && date < horizon;
}

async function taskLabels(taskIds: string[]): Promise<Map<string, string[]>> {
  if (taskIds.length === 0) return new Map();
  const labels = await db
    .select({ taskId: schema.labelTable.taskId, labelId: schema.labelTable.id })
    .from(schema.labelTable)
    .where(inArray(schema.labelTable.taskId, taskIds));
  const byTask = new Map<string, string[]>();
  for (const label of labels) {
    if (!label.taskId) continue;
    const values = byTask.get(label.taskId) ?? [];
    values.push(label.labelId);
    byTask.set(label.taskId, values);
  }
  return byTask;
}

async function queryTasks(
  workspaceId: string,
  definition: SavedViewDefinition,
): Promise<SavedViewTask[]> {
  const filters = definition.filters;
  const rows = await db
    .select({
      id: schema.taskTable.id,
      projectId: schema.projectTable.id,
      projectName: schema.projectTable.name,
      projectSlug: schema.projectTable.slug,
      number: schema.taskTable.number,
      title: schema.taskTable.title,
      description: schema.taskTable.description,
      status: schema.taskTable.status,
      priority: schema.taskTable.priority,
      dueDate: schema.taskTable.dueDate,
      createdAt: schema.taskTable.createdAt,
      updatedAt: schema.taskTable.updatedAt,
      columnIsFinal: schema.columnTable.isFinal,
      assigneeId: schema.userTable.id,
      assigneeName: schema.userTable.name,
    })
    .from(schema.taskTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.taskTable.projectId, schema.projectTable.id),
    )
    .leftJoin(
      schema.columnTable,
      eq(schema.taskTable.columnId, schema.columnTable.id),
    )
    .leftJoin(
      schema.userTable,
      eq(schema.taskTable.userId, schema.userTable.id),
    )
    .where(
      and(
        eq(schema.projectTable.workspaceId, workspaceId),
        inArray(schema.projectTable.id, filters.projectIds),
        filters.assigneeIds.length > 0
          ? inArray(schema.taskTable.userId, filters.assigneeIds)
          : undefined,
        filters.priorities.length > 0
          ? inArray(schema.taskTable.priority, filters.priorities)
          : undefined,
        filters.text
          ? or(
              ilike(schema.taskTable.title, `%${filters.text}%`),
              ilike(schema.taskTable.description, `%${filters.text}%`),
            )
          : undefined,
      ),
    );
  const labelsByTask = await taskLabels(rows.map((row) => row.id));
  const filtered = rows.filter((row) => {
    if (filters.state === "active" && row.columnIsFinal === true) return false;
    if (filters.state === "final" && row.columnIsFinal !== true) return false;
    if (!isDueMatch(filters.due, row.dueDate)) return false;
    if (
      filters.labelIds.length > 0 &&
      !filters.labelIds.some((labelId) =>
        labelsByTask.get(row.id)?.includes(labelId),
      )
    ) {
      return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    for (const term of definition.sort) {
      const result = compareValues(a, b, term);
      if (result !== 0) return result;
    }
    return a.id.localeCompare(b.id);
  });
  return filtered.map((row) => ({
    id: row.id,
    shortId: `${row.projectSlug}-${row.number ?? 0}`,
    number: row.number ?? 0,
    title: row.title,
    status: row.status,
    priority: row.priority ?? "no-priority",
    dueDate: row.dueDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    project: {
      id: row.projectId,
      name: row.projectName,
      slug: row.projectSlug,
    },
    assignee:
      row.assigneeId && row.assigneeName
        ? { id: row.assigneeId, name: row.assigneeName }
        : null,
    labels: labelsByTask.get(row.id) ?? [],
    url: `/dashboard/workspace/${workspaceId}/project/${row.projectId}/task/${row.id}`,
  }));
}

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

export async function runFocusQuery(
  workspaceId: string,
  definition: SavedViewDefinition,
  limit: number,
  cursorValue?: string,
): Promise<SavedViewPage> {
  const safeLimit = Math.min(
    Math.max(Math.floor(limit || 50), 1),
    SAVED_VIEW_MAX_PAGE_SIZE,
  );
  const cursor: SavedViewCursor | null = decodeSavedViewCursor(cursorValue);
  const items = await queryTasks(workspaceId, definition);
  let start = 0;
  if (cursor) {
    if (cursor.sortValues?.length === definition.sort.length) {
      const index = items.findIndex((item) => {
        for (const [position, term] of definition.sort.entries()) {
          const result = compareSortValues(
            sortValue(item, term.field),
            cursor.sortValues?.[position] ?? null,
            term,
          );
          if (result !== 0) return result > 0;
        }
        return item.id.localeCompare(cursor.taskId) > 0;
      });
      start = index < 0 ? items.length : index;
    } else {
      const index = items.findIndex((item) => item.id === cursor.taskId);
      start = index < 0 ? cursor.position + 1 : index + 1;
    }
  }
  const page = items.slice(start, start + safeLimit);
  const last = page.at(-1);
  const nextCursor =
    last && start + page.length < items.length
      ? encodeSavedViewCursor({
          taskId: last.id,
          position: start + page.length - 1,
          sortValues: definition.sort.map((term) =>
            sortValue(last, term.field),
          ),
        })
      : null;
  return { items: page, nextCursor };
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
