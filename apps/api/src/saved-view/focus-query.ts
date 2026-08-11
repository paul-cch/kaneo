import {
  and,
  count,
  countDistinct,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  decodeSavedViewCursor,
  encodeSavedViewCursor,
  SAVED_VIEW_MAX_PAGE_SIZE,
  type SavedViewCursor,
  type SavedViewCursorValue,
  type SavedViewDefinition,
  type SavedViewSortTerm,
} from "./contract";
import type { SavedViewFacets, SavedViewPage, SavedViewTask } from "./service";

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

const focusFilterLabel = alias(schema.labelTable, "focus_filter_label");

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

function localDayBounds(now: Date): {
  start: Date;
  end: Date;
  next7: Date;
  next30: Date;
} {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const next7 = new Date(start);
  next7.setDate(next7.getDate() + 8);
  const next30 = new Date(start);
  next30.setDate(next30.getDate() + 31);
  return { start, end, next7, next30 };
}

function priorityPredicate(priorities: readonly string[]): SQL | undefined {
  if (priorities.length === 0) return undefined;
  const includeNoPriority = priorities.includes("no-priority");
  const concrete = priorities.filter((priority) => priority !== "no-priority");
  if (includeNoPriority && concrete.length > 0) {
    return or(
      inArray(schema.taskTable.priority, concrete),
      isNull(schema.taskTable.priority),
    );
  }
  return includeNoPriority
    ? isNull(schema.taskTable.priority)
    : inArray(schema.taskTable.priority, concrete);
}

function buildFocusWhere(
  workspaceId: string,
  definition: SavedViewDefinition,
  labelNames: readonly string[],
  now: Date,
): SQL {
  const filters = definition.filters;
  const day = localDayBounds(now);
  const due =
    filters.due === "no-due-date"
      ? isNull(schema.taskTable.dueDate)
      : filters.due === "overdue"
        ? lt(schema.taskTable.dueDate, day.start)
        : filters.due === "today"
          ? and(
              gte(schema.taskTable.dueDate, day.start),
              lt(schema.taskTable.dueDate, day.end),
            )
          : filters.due === "next-7-days"
            ? and(
                gte(schema.taskTable.dueDate, day.start),
                lt(schema.taskTable.dueDate, day.next7),
              )
            : filters.due === "next-30-days"
              ? and(
                  gte(schema.taskTable.dueDate, day.start),
                  lt(schema.taskTable.dueDate, day.next30),
                )
              : undefined;

  const state =
    filters.state === "active"
      ? or(
          isNull(schema.columnTable.isFinal),
          eq(schema.columnTable.isFinal, false),
        )
      : filters.state === "final"
        ? eq(schema.columnTable.isFinal, true)
        : undefined;

  const label =
    labelNames.length > 0
      ? exists(
          db
            .select({ id: focusFilterLabel.id })
            .from(focusFilterLabel)
            .where(
              and(
                eq(focusFilterLabel.taskId, schema.taskTable.id),
                inArray(focusFilterLabel.name, [...labelNames]),
              ),
            ),
        )
      : undefined;

  return and(
    eq(schema.projectTable.workspaceId, workspaceId),
    inArray(schema.projectTable.id, filters.projectIds),
    filters.assigneeIds.length > 0
      ? inArray(schema.taskTable.userId, filters.assigneeIds)
      : undefined,
    priorityPredicate(filters.priorities),
    filters.text
      ? sql`to_tsvector('simple', coalesce(${schema.taskTable.title}, '') || ' ' || coalesce(${schema.taskTable.description}, '')) @@ plainto_tsquery('simple', ${filters.text})`
      : undefined,
    state,
    due,
    label,
  ) as SQL;
}

function sortExpression(field: SavedViewSortTerm["field"]): SQL {
  switch (field) {
    case "priority":
      return sql<number>`case ${schema.taskTable.priority}
        when 'urgent' then 4
        when 'high' then 3
        when 'medium' then 2
        when 'low' then 1
        else 0
      end`;
    case "dueDate":
      return sql`date_trunc('milliseconds', ${schema.taskTable.dueDate})`;
    case "updatedAt":
      return sql`date_trunc('milliseconds', ${schema.taskTable.updatedAt})`;
    case "createdAt":
      return sql`date_trunc('milliseconds', ${schema.taskTable.createdAt})`;
    case "title":
      return sql`lower(${schema.taskTable.title})`;
    case "taskId":
      return sql`${schema.taskTable.id}`;
  }
}

function orderExpression(term: SavedViewSortTerm): SQL {
  const direction = term.direction === "asc" ? "asc" : "desc";
  const nulls = term.nulls === "first" ? "first" : "last";
  return sql`${sortExpression(term.field)} ${sql.raw(direction)} nulls ${sql.raw(nulls)}`;
}

function cursorSqlValue(
  term: SavedViewSortTerm,
  value: SavedViewCursorValue,
): Date | string | number | null {
  if (value === null) return null;
  if (
    (term.field === "dueDate" ||
      term.field === "updatedAt" ||
      term.field === "createdAt") &&
    typeof value === "number"
  ) {
    return new Date(value);
  }
  return value;
}

function nullRankExpression(expression: SQL, nulls: "first" | "last"): SQL {
  const nullRank = nulls === "first" ? 0 : 1;
  const valueRank = nulls === "first" ? 1 : 0;
  return sql`case when ${expression} is null then ${nullRank} else ${valueRank} end`;
}

function cursorTermEqual(
  term: SavedViewSortTerm,
  value: SavedViewCursorValue,
): SQL {
  const expression = sortExpression(term.field);
  const nulls = term.nulls === "first" ? "first" : "last";
  const cursorRank =
    value === null ? (nulls === "first" ? 0 : 1) : nulls === "first" ? 1 : 0;
  const rank = nullRankExpression(expression, nulls);
  if (value === null) return sql`${rank} = ${cursorRank}`;
  return sql`${rank} = ${cursorRank} and ${expression} = ${cursorSqlValue(term, value)}`;
}

function cursorTermAfter(
  term: SavedViewSortTerm,
  value: SavedViewCursorValue,
): SQL {
  const expression = sortExpression(term.field);
  const nulls = term.nulls === "first" ? "first" : "last";
  const cursorRank =
    value === null ? (nulls === "first" ? 0 : 1) : nulls === "first" ? 1 : 0;
  const rank = nullRankExpression(expression, nulls);
  const rankAfter = sql`${rank} > ${cursorRank}`;
  if (value === null) return rankAfter;
  const operator = term.direction === "asc" ? ">" : "<";
  return sql`(${rankAfter} or (${rank} = ${cursorRank} and ${expression} ${sql.raw(operator)} ${cursorSqlValue(term, value)}))`;
}

function sortKey(definition: SavedViewDefinition): string {
  return JSON.stringify(definition.sort);
}

function cursorWhere(
  definition: SavedViewDefinition,
  cursor: SavedViewCursor | null,
): SQL | undefined {
  if (!cursor) return undefined;
  if (
    !cursor.sortKey ||
    cursor.sortKey !== sortKey(definition) ||
    !cursor.sortValues ||
    cursor.sortValues.length !== definition.sort.length
  ) {
    throw new HTTPException(400, {
      message: "Saved view cursor no longer matches this sort",
    });
  }

  const branches: SQL[] = [];
  const equalPrefix: SQL[] = [];
  for (const [index, term] of definition.sort.entries()) {
    const value = cursor.sortValues[index] ?? null;
    const after = cursorTermAfter(term, value);
    branches.push(and(...equalPrefix, after) as SQL);
    equalPrefix.push(cursorTermEqual(term, value));
  }
  return or(...branches) as SQL;
}

async function taskLabels(
  workspaceId: string,
  taskIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (taskIds.length === 0) return new Map();
  const taskLabel = alias(schema.labelTable, "focus_page_task_label");
  const workspaceLabel = alias(schema.labelTable, "focus_page_workspace_label");
  const labels = await db
    .select({
      taskId: taskLabel.taskId,
      labelId: workspaceLabel.id,
    })
    .from(taskLabel)
    .innerJoin(
      workspaceLabel,
      and(
        eq(workspaceLabel.workspaceId, workspaceId),
        isNull(workspaceLabel.taskId),
        eq(workspaceLabel.name, taskLabel.name),
      ),
    )
    .where(inArray(taskLabel.taskId, [...taskIds]));
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
  labelNames: readonly string[],
  limit: number,
  cursor: SavedViewCursor | null,
  now: Date,
): Promise<SavedViewTask[]> {
  const rows = await db
    .select({
      id: schema.taskTable.id,
      projectId: schema.projectTable.id,
      projectName: schema.projectTable.name,
      projectSlug: schema.projectTable.slug,
      number: schema.taskTable.number,
      title: schema.taskTable.title,
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
        buildFocusWhere(workspaceId, definition, labelNames, now),
        cursorWhere(definition, cursor),
      ),
    )
    .orderBy(...definition.sort.map(orderExpression))
    .limit(limit);

  const labelsByTask = await taskLabels(
    workspaceId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    workspaceId,
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

function toFacetMap(
  rows: Array<{ key: string | null; count: number | string }>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.key === null) continue;
    result[row.key] = Number(row.count);
  }
  return result;
}

export async function runFocusFacets(
  workspaceId: string,
  definition: SavedViewDefinition,
  labelNamesById: Map<string, string>,
): Promise<SavedViewFacets> {
  const startedAt = performance.now();
  const now = new Date();
  const labelNames = [...labelNamesById.values()];
  const where = buildFocusWhere(workspaceId, definition, labelNames, now);

  const projectRows = await db
    .select({ key: schema.projectTable.id, count: count(schema.taskTable.id) })
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
    .where(where)
    .groupBy(schema.projectTable.id);

  const statusRows = await db
    .select({ key: schema.taskTable.status, count: count(schema.taskTable.id) })
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
    .where(where)
    .groupBy(schema.taskTable.status);

  const priorityKey = sql<string>`coalesce(${schema.taskTable.priority}, 'no-priority')`;
  const priorityRows = await db
    .select({ key: priorityKey, count: count(schema.taskTable.id) })
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
    .where(where)
    .groupBy(priorityKey);

  const assigneeKey = sql<string>`coalesce(${schema.taskTable.userId}, 'unassigned')`;
  const assigneeRows = await db
    .select({ key: assigneeKey, count: count(schema.taskTable.id) })
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
    .where(where)
    .groupBy(assigneeKey);

  const facetTaskLabel = alias(schema.labelTable, "focus_facet_task_label");
  const facetWorkspaceLabel = alias(
    schema.labelTable,
    "focus_facet_workspace_label",
  );
  const labelRows = await db
    .select({
      key: facetWorkspaceLabel.id,
      count: countDistinct(schema.taskTable.id),
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
    .innerJoin(facetTaskLabel, eq(facetTaskLabel.taskId, schema.taskTable.id))
    .innerJoin(
      facetWorkspaceLabel,
      and(
        eq(facetWorkspaceLabel.workspaceId, workspaceId),
        isNull(facetWorkspaceLabel.taskId),
        eq(facetWorkspaceLabel.name, facetTaskLabel.name),
      ),
    )
    .where(where)
    .groupBy(facetWorkspaceLabel.id);

  const [totalRow] = await db
    .select({ count: count(schema.taskTable.id) })
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
    .where(where);

  return {
    total: Number(totalRow?.count ?? 0),
    queryMs: Math.max(0, Math.round(performance.now() - startedAt)),
    facets: {
      projects: toFacetMap(projectRows),
      statuses: toFacetMap(statusRows),
      priorities: toFacetMap(priorityRows),
      assignees: toFacetMap(assigneeRows),
      labels: toFacetMap(labelRows),
    },
  };
}

export async function runFocusQuery(
  workspaceId: string,
  definition: SavedViewDefinition,
  limit: number,
  cursorValue: string | undefined,
  labelNamesById: Map<string, string>,
): Promise<SavedViewPage> {
  const safeLimit = Math.min(
    Math.max(Math.floor(limit || 50), 1),
    SAVED_VIEW_MAX_PAGE_SIZE,
  );
  const cursor = decodeSavedViewCursor(cursorValue);
  const now = new Date();
  const items = await queryTasks(
    workspaceId,
    definition,
    [...labelNamesById.values()],
    safeLimit + 1,
    cursor,
    now,
  );
  const page = items.slice(0, safeLimit);
  const last = page.at(-1);
  const nextCursor =
    items.length > safeLimit && last
      ? encodeSavedViewCursor({
          taskId: last.id,
          position: (cursor?.position ?? -1) + page.length,
          sortKey: sortKey(definition),
          sortValues: definition.sort.map((term) =>
            sortValue(last, term.field),
          ),
        })
      : null;
  return { items: page, nextCursor };
}
