import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { publishEvent } from "../events";
import { assertValidTaskStatus } from "../task/validate-task-fields";

const MAX_PAGE_SIZE = 100;
const PROJECT_HEALTH = ["on-track", "at-risk", "off-track"] as const;
const PROJECT_STATUS = ["active", "paused", "completed"] as const;
const TRIAGE_PRIORITIES = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
const TRIAGE_ACTIONS = [
  "set_status",
  "set_priority",
  "assign_user",
  "add_label",
] as const;
const ANALYTICS_QUESTIONS = {
  workload: "How much work is in the selected window?",
  aging: "How old is the work in the selected window?",
  overdue: "How much work is overdue in the selected window?",
} as const;

type JsonObject = Record<string, unknown>;

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

function notFound(message = "Resource not found"): never {
  throw new HTTPException(404, { message });
}

function conflict(message: string): never {
  throw new HTTPException(409, { message });
}

function asObject(input: unknown, field = "body"): JsonObject {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    badRequest(`${field} must be an object`);
  }
  return input as JsonObject;
}

function stringField(
  input: JsonObject,
  field: string,
  options: { optional?: boolean; nullable?: boolean; max?: number } = {},
): string | null | undefined {
  const value = input[field];
  if (value === undefined && options.optional) return undefined;
  if (value === null && options.nullable) return null;
  if (typeof value !== "string" || value.trim() === "") {
    badRequest(`${field} must be a non-empty string`);
  }
  const result = value.trim();
  if (options.max && result.length > options.max) {
    badRequest(`${field} is too long`);
  }
  return result;
}

function boolField(
  input: JsonObject,
  field: string,
  fallback: boolean,
): boolean {
  const value = input[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") badRequest(`${field} must be boolean`);
  return value;
}

function numberField(
  input: JsonObject,
  field: string,
  fallback: number,
): number {
  const value = input[field];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    badRequest(`${field} must be an integer`);
  }
  return value;
}

function dateField(
  input: JsonObject,
  field: string,
  options: { optional?: boolean; nullable?: boolean } = {},
): Date | null | undefined {
  const value = input[field];
  if (value === undefined && options.optional) return undefined;
  if (value === null && options.nullable) return null;
  if (typeof value !== "string") badRequest(`${field} must be an ISO date`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) badRequest(`${field} must be an ISO date`);
  return date;
}

function objectField(input: JsonObject, field: string): JsonObject {
  return asObject(input[field], field);
}

function boundedLimit(value?: number): number {
  return Math.min(Math.max(value ?? 50, 1), MAX_PAGE_SIZE);
}

function inValues<T extends readonly string[]>(
  value: string,
  values: T,
  field: string,
): T[number] {
  if (!values.includes(value)) badRequest(`${field} is invalid`);
  return value as T[number];
}

type OperatorIntegrationRow =
  typeof schema.operatorIntegrationTable.$inferSelect;

type OperatorIntegrationSummary = Omit<OperatorIntegrationRow, "config">;

function integrationSummary(
  integration: OperatorIntegrationRow,
): OperatorIntegrationSummary {
  const { config: _config, ...summary } = integration;
  return summary;
}

function rejectCredentialKeys(value: unknown, path = "config"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      rejectCredentialKeys(entry, `${path}[${index}]`);
    });
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(token|secret|password|credential)/i.test(key)) {
      badRequest("Integration credentials are not accepted in this phase");
    }
    rejectCredentialKeys(child, `${path}.${key}`);
  }
}

async function assertWorkspaceUser(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const [membership] = await db
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!membership) badRequest("User must belong to the workspace");
}

async function assertProject(
  workspaceId: string,
  projectId: string,
): Promise<typeof schema.projectTable.$inferSelect> {
  const [project] = await db
    .select()
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.workspaceId, workspaceId),
        eq(schema.projectTable.id, projectId),
      ),
    )
    .limit(1);
  if (!project) notFound("Project not found");
  return project;
}

async function assertTaskWorkspace(
  workspaceId: string,
  taskId: string,
): Promise<typeof schema.taskTable.$inferSelect> {
  const [task] = await db
    .select({ task: schema.taskTable })
    .from(schema.taskTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.taskTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.taskTable.id, taskId),
        eq(schema.projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!task) notFound("Task not found");
  return task.task;
}

export type ProjectOperatorInput = {
  leadUserId?: string | null;
  targetDate?: Date | null;
  status?: (typeof PROJECT_STATUS)[number];
  health?: (typeof PROJECT_HEALTH)[number];
};

export function parseProjectOperatorInput(
  input: unknown,
): ProjectOperatorInput {
  const body = asObject(input);
  const result: ProjectOperatorInput = {};
  if ("leadUserId" in body) {
    const value = stringField(body, "leadUserId", { nullable: true });
    result.leadUserId = value;
  }
  if ("targetDate" in body) {
    result.targetDate = dateField(body, "targetDate", { nullable: true });
  }
  if ("status" in body) {
    const status = stringField(body, "status");
    result.status = inValues(status as string, PROJECT_STATUS, "status");
  }
  if ("health" in body) {
    const health = stringField(body, "health");
    result.health = inValues(health as string, PROJECT_HEALTH, "health");
  }
  if (Object.keys(result).length === 0)
    badRequest("At least one project field is required");
  return result;
}

export async function getProjectOperator(
  projectId: string,
  workspaceId: string,
) {
  const project = await assertProject(workspaceId, projectId);
  let lead: { id: string; name: string; email: string } | null = null;
  if (project.leadUserId) {
    const [user] = await db
      .select({
        id: schema.userTable.id,
        name: schema.userTable.name,
        email: schema.userTable.email,
      })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, project.leadUserId))
      .limit(1);
    lead = user ?? null;
  }
  return {
    projectId: project.id,
    lead,
    targetDate: project.targetDate,
    status: project.status,
    health: project.health,
  };
}

export async function updateProjectOperator(
  projectId: string,
  workspaceId: string,
  input: unknown,
) {
  const project = await assertProject(workspaceId, projectId);
  const parsed = parseProjectOperatorInput(input);
  if (parsed.leadUserId)
    await assertWorkspaceUser(workspaceId, parsed.leadUserId);
  const values: {
    leadUserId?: string | null;
    targetDate?: Date | null;
    status?: string;
    health?: string;
  } = {};
  if ("leadUserId" in parsed) values.leadUserId = parsed.leadUserId;
  if ("targetDate" in parsed) values.targetDate = parsed.targetDate;
  if (parsed.status) values.status = parsed.status;
  if (parsed.health) values.health = parsed.health;
  const [updated] = await db
    .update(schema.projectTable)
    .set(values)
    .where(
      and(
        eq(schema.projectTable.id, project.id),
        eq(schema.projectTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  if (!updated) notFound("Project not found");
  return getProjectOperator(projectId, workspaceId);
}

export async function listProjectUpdates(
  projectId: string,
  workspaceId: string,
  limit?: number,
) {
  await assertProject(workspaceId, projectId);
  return db
    .select()
    .from(schema.projectStatusUpdateTable)
    .where(
      and(
        eq(schema.projectStatusUpdateTable.projectId, projectId),
        eq(schema.projectStatusUpdateTable.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(schema.projectStatusUpdateTable.createdAt))
    .limit(boundedLimit(limit));
}

export async function createProjectUpdate(
  projectId: string,
  workspaceId: string,
  authorUserId: string,
  input: unknown,
) {
  await assertProject(workspaceId, projectId);
  const body = asObject(input);
  const content = stringField(body, "body", { max: 5000 });
  const [created] = await db
    .insert(schema.projectStatusUpdateTable)
    .values({
      id: createId(),
      workspaceId,
      projectId,
      authorUserId,
      body: content as string,
    })
    .returning();
  return created;
}

export function parseCycleInput(input: unknown) {
  const body = asObject(input);
  const name = stringField(body, "name", { max: 120 }) as string;
  const startsAt = dateField(body, "startsAt") as Date;
  const endsAt = dateField(body, "endsAt") as Date;
  if (endsAt <= startsAt) badRequest("endsAt must be after startsAt");
  const rolloverPolicy = inValues(
    (stringField(body, "rolloverPolicy", { optional: true }) as
      | string
      | undefined) ?? "manual",
    ["manual", "carry-over"] as const,
    "rolloverPolicy",
  );
  const status = inValues(
    (stringField(body, "status", { optional: true }) as string | undefined) ??
      "planned",
    ["planned", "active", "completed", "cancelled"] as const,
    "status",
  );
  return { name, startsAt, endsAt, status, rolloverPolicy };
}

export async function listCycles(workspaceId: string, limit?: number) {
  const rows = await db
    .select()
    .from(schema.cycleTable)
    .where(eq(schema.cycleTable.workspaceId, workspaceId))
    .orderBy(desc(schema.cycleTable.startsAt))
    .limit(boundedLimit(limit));
  const now = new Date();
  return rows.map((cycle) => ({
    ...cycle,
    isCurrent:
      cycle.status !== "cancelled" &&
      cycle.startsAt <= now &&
      cycle.endsAt >= now,
  }));
}

export async function getCurrentCycle(workspaceId: string) {
  const now = new Date();
  const [cycle] = await db
    .select()
    .from(schema.cycleTable)
    .where(
      and(
        eq(schema.cycleTable.workspaceId, workspaceId),
        ne(schema.cycleTable.status, "cancelled"),
        lte(schema.cycleTable.startsAt, now),
        gte(schema.cycleTable.endsAt, now),
      ),
    )
    .orderBy(desc(schema.cycleTable.startsAt))
    .limit(1);
  if (!cycle) return { cycle: null, tasks: [] };
  return {
    cycle: { ...cycle, isCurrent: true },
    tasks: await listCycleTasks(workspaceId, cycle.id),
  };
}

export async function createCycle(workspaceId: string, input: unknown) {
  const parsed = parseCycleInput(input);
  const [created] = await db
    .insert(schema.cycleTable)
    .values({ id: createId(), workspaceId, ...parsed })
    .returning();
  return created;
}

async function assertCycle(workspaceId: string, cycleId: string) {
  const [cycle] = await db
    .select()
    .from(schema.cycleTable)
    .where(
      and(
        eq(schema.cycleTable.id, cycleId),
        eq(schema.cycleTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!cycle) notFound("Cycle not found");
  return cycle;
}

export async function listCycleTasks(workspaceId: string, cycleId: string) {
  await assertCycle(workspaceId, cycleId);
  return db
    .select({
      assignment: schema.cycleTaskTable,
      task: schema.taskTable,
      project: { id: schema.projectTable.id, name: schema.projectTable.name },
    })
    .from(schema.cycleTaskTable)
    .innerJoin(
      schema.taskTable,
      eq(schema.cycleTaskTable.taskId, schema.taskTable.id),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.taskTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.cycleTaskTable.workspaceId, workspaceId),
        eq(schema.cycleTaskTable.cycleId, cycleId),
      ),
    )
    .orderBy(asc(schema.cycleTaskTable.addedAt));
}

export async function addCycleTask(
  workspaceId: string,
  cycleId: string,
  input: unknown,
) {
  await assertCycle(workspaceId, cycleId);
  const body = asObject(input);
  const taskId = stringField(body, "taskId") as string;
  await assertTaskWorkspace(workspaceId, taskId);
  const [existing] = await db
    .select()
    .from(schema.cycleTaskTable)
    .where(
      and(
        eq(schema.cycleTaskTable.cycleId, cycleId),
        eq(schema.cycleTaskTable.taskId, taskId),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(schema.cycleTaskTable)
    .values({ id: createId(), workspaceId, cycleId, taskId })
    .returning();
  return created;
}

export async function removeCycleTask(
  workspaceId: string,
  cycleId: string,
  taskId: string,
) {
  await assertCycle(workspaceId, cycleId);
  const [deleted] = await db
    .delete(schema.cycleTaskTable)
    .where(
      and(
        eq(schema.cycleTaskTable.workspaceId, workspaceId),
        eq(schema.cycleTaskTable.cycleId, cycleId),
        eq(schema.cycleTaskTable.taskId, taskId),
      ),
    )
    .returning();
  if (!deleted) notFound("Cycle task assignment not found");
  return deleted;
}

export function parseOutboxInput(input: unknown) {
  const body = asObject(input);
  const eventType = stringField(body, "eventType", { max: 120 }) as string;
  const aggregateType = stringField(body, "aggregateType", {
    max: 80,
  }) as string;
  const aggregateId = stringField(body, "aggregateId", { max: 200 }) as string;
  const idempotencyKey = stringField(body, "idempotencyKey", {
    max: 240,
  }) as string;
  const payload =
    body.payload === undefined ? {} : asObject(body.payload, "payload");
  const maxAttempts = numberField(body, "maxAttempts", 3);
  if (maxAttempts < 1 || maxAttempts > 5) {
    badRequest("maxAttempts must be between 1 and 5");
  }
  return {
    eventType,
    aggregateType,
    aggregateId,
    idempotencyKey,
    payload,
    maxAttempts,
  };
}

export async function enqueueOperatorEvent(
  workspaceId: string,
  input: unknown,
  replayOwnerUserId: string,
) {
  const parsed = parseOutboxInput(input);
  const [created] = await db
    .insert(schema.operatorOutboxTable)
    .values({ id: createId(), workspaceId, replayOwnerUserId, ...parsed })
    .onConflictDoNothing({
      target: [
        schema.operatorOutboxTable.workspaceId,
        schema.operatorOutboxTable.idempotencyKey,
      ],
    })
    .returning();
  if (created) return created;
  const [existing] = await db
    .select()
    .from(schema.operatorOutboxTable)
    .where(
      and(
        eq(schema.operatorOutboxTable.workspaceId, workspaceId),
        eq(schema.operatorOutboxTable.idempotencyKey, parsed.idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing) conflict("Idempotency key was concurrently claimed");
  return existing;
}

export async function listOperatorEvents(workspaceId: string, limit?: number) {
  return db
    .select()
    .from(schema.operatorOutboxTable)
    .where(eq(schema.operatorOutboxTable.workspaceId, workspaceId))
    .orderBy(desc(schema.operatorOutboxTable.createdAt))
    .limit(boundedLimit(limit));
}

export async function getOperatorEvent(workspaceId: string, eventId: string) {
  const [event] = await db
    .select()
    .from(schema.operatorOutboxTable)
    .where(
      and(
        eq(schema.operatorOutboxTable.id, eventId),
        eq(schema.operatorOutboxTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!event) notFound("Operator event not found");
  const attempts = await db
    .select()
    .from(schema.operatorJobAttemptTable)
    .where(eq(schema.operatorJobAttemptTable.outboxId, event.id))
    .orderBy(asc(schema.operatorJobAttemptTable.attempt));
  return { event, attempts };
}

export function parseAttemptInput(input: unknown) {
  const body = asObject(input);
  const status = inValues(
    stringField(body, "status") as string,
    ["running", "succeeded", "failed"] as const,
    "status",
  );
  const error = stringField(body, "error", { optional: true, max: 2000 });
  return { status, error: error ?? null };
}

export async function recordJobAttempt(
  workspaceId: string,
  eventId: string,
  input: unknown,
) {
  const { status, error } = parseAttemptInput(input);
  const [event] = await db
    .select()
    .from(schema.operatorOutboxTable)
    .where(
      and(
        eq(schema.operatorOutboxTable.id, eventId),
        eq(schema.operatorOutboxTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!event) notFound("Operator event not found");
  const attempts = await db
    .select({ attempt: schema.operatorJobAttemptTable.attempt })
    .from(schema.operatorJobAttemptTable)
    .where(eq(schema.operatorJobAttemptTable.outboxId, event.id))
    .orderBy(desc(schema.operatorJobAttemptTable.attempt))
    .limit(1);
  const attempt = (attempts[0]?.attempt ?? 0) + 1;
  const [created] = await db
    .insert(schema.operatorJobAttemptTable)
    .values({
      id: createId(),
      outboxId: event.id,
      attempt,
      status,
      finishedAt: status === "running" ? null : new Date(),
      error,
    })
    .returning();
  const exhausted = status === "failed" && attempt >= event.maxAttempts;
  const nextStatus =
    status === "succeeded"
      ? "completed"
      : status === "failed"
        ? exhausted
          ? "failed"
          : "pending"
        : "running";
  const retryDelayMs =
    status === "failed" && !exhausted
      ? Math.min(60_000, 1_000 * 2 ** (attempt - 1))
      : 0;
  await db
    .update(schema.operatorOutboxTable)
    .set({
      status: nextStatus,
      availableAt: new Date(Date.now() + retryDelayMs),
      lastError: error,
      updatedAt: new Date(),
    })
    .where(eq(schema.operatorOutboxTable.id, event.id));
  return { eventId: event.id, attempt: created };
}

export async function replayOperatorEvent(
  workspaceId: string,
  eventId: string,
  replayOwnerUserId: string,
) {
  const [event] = await db
    .select()
    .from(schema.operatorOutboxTable)
    .where(
      and(
        eq(schema.operatorOutboxTable.id, eventId),
        eq(schema.operatorOutboxTable.workspaceId, workspaceId),
        eq(schema.operatorOutboxTable.replayOwnerUserId, replayOwnerUserId),
      ),
    )
    .limit(1);
  if (!event) notFound("Operator event not found");
  if (event.status !== "failed") {
    conflict("Only failed events can be replayed");
  }
  const [replayed] = await db
    .update(schema.operatorOutboxTable)
    .set({
      status: "pending",
      availableAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.operatorOutboxTable.id, event.id),
        eq(schema.operatorOutboxTable.status, "failed"),
      ),
    )
    .returning();
  if (!replayed) conflict("Event changed before replay");
  return replayed;
}

export function parseTriageAction(input: unknown) {
  const body = asObject(input);
  const type = inValues(
    stringField(body, "type") as string,
    TRIAGE_ACTIONS,
    "type",
  );
  const value = body.value;
  if (type === "assign_user") {
    if (typeof value !== "string" || value.trim() === "") {
      badRequest("assign_user requires a user id");
    }
    return { type, value: value.trim() };
  }
  if (typeof value !== "string" || value.trim() === "") {
    badRequest(`${type} requires a string value`);
  }
  return { type, value: value.trim() };
}

export type TriageConditions = {
  status?: string[];
  priority?: string[];
  projectId?: string[];
  assigneeId?: string[];
  labelId?: string[];
  titleIncludes?: string;
};

function conditionValues(
  body: JsonObject,
  field: string,
): string[] | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  if (
    values.length === 0 ||
    values.length > 20 ||
    values.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    badRequest(`conditions.${field} must contain between 1 and 20 strings`);
  }
  return values.map((entry) => (entry as string).trim());
}

export function parseTriageConditions(input: unknown): TriageConditions {
  const body = asObject(input, "conditions");
  const allowed = new Set([
    "status",
    "priority",
    "projectId",
    "assigneeId",
    "labelId",
    "titleIncludes",
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) badRequest(`conditions.${key} is unsupported`);
  }
  const titleIncludes = body.titleIncludes;
  if (titleIncludes !== undefined && typeof titleIncludes !== "string") {
    badRequest("conditions.titleIncludes must be a string");
  }
  const normalizedTitle =
    typeof titleIncludes === "string" ? titleIncludes.trim() : undefined;
  if (normalizedTitle !== undefined && normalizedTitle.length > 120) {
    badRequest("conditions.titleIncludes is too long");
  }
  const status = conditionValues(body, "status");
  const priority = conditionValues(body, "priority");
  const projectId = conditionValues(body, "projectId");
  const assigneeId = conditionValues(body, "assigneeId");
  const labelId = conditionValues(body, "labelId");
  return {
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(projectId ? { projectId } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(labelId ? { labelId } : {}),
    ...(normalizedTitle ? { titleIncludes: normalizedTitle } : {}),
  };
}

type TriageTask = {
  status: string;
  priority: string | null;
  projectId: string;
  userId: string | null;
  title: string;
  labelIds: string[];
};

export function matchesTriageConditions(
  task: TriageTask,
  conditions: TriageConditions,
): boolean {
  const matches = (values: string[] | undefined, value: string | null) =>
    values === undefined || (value !== null && values.includes(value));
  return (
    matches(conditions.status, task.status) &&
    matches(conditions.priority, task.priority) &&
    matches(conditions.projectId, task.projectId) &&
    matches(conditions.assigneeId, task.userId) &&
    (conditions.labelId === undefined ||
      conditions.labelId.some((labelId) => task.labelIds.includes(labelId))) &&
    (conditions.titleIncludes === undefined ||
      task.title
        .toLocaleLowerCase()
        .includes(conditions.titleIncludes.toLocaleLowerCase()))
  );
}

export function parseTriageRuleInput(input: unknown) {
  const body = asObject(input);
  const name = stringField(body, "name", { max: 120 }) as string;
  const priority = numberField(body, "priority", 0);
  const enabled = boolField(body, "enabled", true);
  const conditions = parseTriageConditions(body.conditions);
  const action = parseTriageAction(body.action);
  return { name, priority, enabled, conditions, action };
}

export async function listTriageRules(workspaceId: string, limit?: number) {
  return db
    .select()
    .from(schema.triageRuleTable)
    .where(eq(schema.triageRuleTable.workspaceId, workspaceId))
    .orderBy(
      asc(schema.triageRuleTable.priority),
      asc(schema.triageRuleTable.createdAt),
    )
    .limit(boundedLimit(limit));
}

export async function createTriageRule(
  workspaceId: string,
  createdBy: string,
  input: unknown,
) {
  const parsed = parseTriageRuleInput(input);
  if (parsed.action.type === "assign_user") {
    await assertWorkspaceUser(workspaceId, parsed.action.value);
  }
  if (parsed.action.type === "set_priority") {
    inValues(parsed.action.value, TRIAGE_PRIORITIES, "action.value");
  }
  const [created] = await db
    .insert(schema.triageRuleTable)
    .values({
      id: createId(),
      workspaceId,
      createdBy,
      name: parsed.name,
      priority: parsed.priority,
      enabled: parsed.enabled,
      conditions: parsed.conditions,
      action: parsed.action,
    })
    .returning();
  return created;
}

export async function enqueueTriageItem(workspaceId: string, input: unknown) {
  const body = asObject(input);
  const taskId = stringField(body, "taskId") as string;
  const task = await assertTaskWorkspace(workspaceId, taskId);
  const labels = await db
    .select({ id: schema.labelTable.id })
    .from(schema.labelTable)
    .where(eq(schema.labelTable.taskId, taskId));
  const triageTask: TriageTask = {
    status: task.status,
    priority: task.priority,
    projectId: task.projectId,
    userId: task.userId,
    title: task.title,
    labelIds: labels.map((label) => label.id),
  };
  const requestedRuleId = stringField(body, "ruleId", { optional: true });
  const suppliedAction =
    body.proposedAction === undefined
      ? undefined
      : parseTriageAction(body.proposedAction);
  let selectedRule: typeof schema.triageRuleTable.$inferSelect | undefined;
  if (requestedRuleId) {
    const [rule] = await db
      .select()
      .from(schema.triageRuleTable)
      .where(
        and(
          eq(schema.triageRuleTable.id, requestedRuleId),
          eq(schema.triageRuleTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!rule) notFound("Triage rule not found");
    selectedRule = rule;
  } else if (suppliedAction === undefined) {
    const rules = await db
      .select()
      .from(schema.triageRuleTable)
      .where(
        and(
          eq(schema.triageRuleTable.workspaceId, workspaceId),
          eq(schema.triageRuleTable.enabled, true),
        ),
      )
      .orderBy(
        asc(schema.triageRuleTable.priority),
        asc(schema.triageRuleTable.createdAt),
      );
    selectedRule = rules.find((rule) =>
      matchesTriageConditions(
        triageTask,
        parseTriageConditions(rule.conditions),
      ),
    );
    if (!selectedRule) badRequest("No enabled triage rule matched task");
  }
  if (selectedRule) {
    if (!selectedRule.enabled) conflict("Triage rule is disabled");
    if (
      !matchesTriageConditions(
        triageTask,
        parseTriageConditions(selectedRule.conditions),
      )
    ) {
      conflict("Triage rule does not match task");
    }
  }
  const proposedAction = selectedRule
    ? parseTriageAction(selectedRule.action)
    : suppliedAction;
  if (!proposedAction) badRequest("proposedAction is required without a rule");
  const [created] = await db
    .insert(schema.triageItemTable)
    .values({
      id: createId(),
      workspaceId,
      taskId,
      ruleId: selectedRule?.id ?? null,
      source:
        stringField(body, "source", { optional: true, max: 80 }) ?? "native",
      proposedAction,
    })
    .returning();
  return created;
}

export async function listTriageItems(workspaceId: string, limit?: number) {
  return db
    .select()
    .from(schema.triageItemTable)
    .where(
      and(
        eq(schema.triageItemTable.workspaceId, workspaceId),
        eq(schema.triageItemTable.status, "pending"),
      ),
    )
    .orderBy(asc(schema.triageItemTable.createdAt))
    .limit(boundedLimit(limit));
}

export async function applyTriageItem(
  workspaceId: string,
  itemId: string,
  currentUserId: string,
) {
  const [item] = await db
    .select()
    .from(schema.triageItemTable)
    .where(
      and(
        eq(schema.triageItemTable.id, itemId),
        eq(schema.triageItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!item) notFound("Triage item not found");
  if (item.status !== "pending") conflict("Triage item is not pending");
  const task = await assertTaskWorkspace(workspaceId, item.taskId);
  const action = parseTriageAction(item.proposedAction);
  const taskUpdate: {
    status?: string;
    columnId?: string | null;
    priority?: string;
    userId?: string | null;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };
  if (action.type === "set_status") {
    await assertValidTaskStatus(action.value, task.projectId);
    const [column] = await db
      .select({ id: schema.columnTable.id })
      .from(schema.columnTable)
      .where(
        and(
          eq(schema.columnTable.projectId, task.projectId),
          eq(schema.columnTable.slug, action.value),
        ),
      )
      .limit(1);
    taskUpdate.status = action.value;
    taskUpdate.columnId = column?.id ?? null;
  }
  if (action.type === "set_priority") {
    taskUpdate.priority = inValues(
      action.value,
      TRIAGE_PRIORITIES,
      "action.value",
    );
  }
  if (action.type === "assign_user") {
    await assertWorkspaceUser(workspaceId, action.value);
    taskUpdate.userId = action.value;
  }
  if (action.type === "add_label") {
    const [label] = await db
      .select()
      .from(schema.labelTable)
      .where(
        and(
          eq(schema.labelTable.id, action.value),
          eq(schema.labelTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!label) badRequest("Label must be a workspace label");
    const [existingLabel] = await db
      .select({ id: schema.labelTable.id })
      .from(schema.labelTable)
      .where(
        and(
          eq(schema.labelTable.taskId, task.id),
          eq(schema.labelTable.name, label.name),
        ),
      )
      .limit(1);
    if (!existingLabel) {
      await db.insert(schema.labelTable).values({
        id: createId(),
        taskId: task.id,
        name: label.name,
        color: label.color,
      });
    }
  }
  const delivery = await enqueueOperatorEvent(
    workspaceId,
    {
      eventType: "triage.item.apply",
      aggregateType: "triage-item",
      aggregateId: item.id,
      idempotencyKey: `triage:${item.id}:apply`,
      payload: { taskId: item.taskId, action },
    },
    currentUserId,
  );
  const [updatedTask] = await db
    .update(schema.taskTable)
    .set(taskUpdate)
    .where(eq(schema.taskTable.id, task.id))
    .returning();
  if (!updatedTask) notFound("Task not found");
  const [updated] = await db
    .update(schema.triageItemTable)
    .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.triageItemTable.id, item.id),
        eq(schema.triageItemTable.workspaceId, workspaceId),
        eq(schema.triageItemTable.status, "pending"),
      ),
    )
    .returning();
  if (!updated) conflict("Triage item is no longer pending");
  await recordJobAttempt(workspaceId, delivery.id, { status: "succeeded" });
  if (task.status !== updatedTask.status) {
    await publishEvent("task.status_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldStatus: task.status,
      newStatus: updatedTask.status,
      title: updatedTask.title,
      assigneeId: updatedTask.userId,
      type: "status_changed",
    });
    await publishEvent("task-relation.refresh", {
      projectId: updatedTask.projectId,
      userId: currentUserId,
    });
  }
  await publishEvent("task.updated", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    title: updatedTask.title,
    status: updatedTask.status,
    userId: currentUserId,
  });
  return updated;
}

export async function analytics(workspaceId: string, input: unknown) {
  const body = asObject(input);
  const question = inValues(
    (stringField(body, "question", { optional: true }) as string | undefined) ??
      "workload",
    Object.keys(ANALYTICS_QUESTIONS) as (keyof typeof ANALYTICS_QUESTIONS)[],
    "question",
  );
  const since = dateField(body, "since", { optional: true });
  const until = dateField(body, "until", { optional: true });
  if (since && until && until < since) badRequest("until must be after since");
  const predicates = [eq(schema.projectTable.workspaceId, workspaceId)];
  if (since) predicates.push(gte(schema.taskTable.createdAt, since));
  if (until) predicates.push(lte(schema.taskTable.createdAt, until));
  const tasks = await db
    .select({
      id: schema.taskTable.id,
      status: schema.taskTable.status,
      priority: schema.taskTable.priority,
      dueDate: schema.taskTable.dueDate,
      projectStatus: schema.projectTable.status,
      projectHealth: schema.projectTable.health,
      createdAt: schema.taskTable.createdAt,
    })
    .from(schema.taskTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.taskTable.projectId, schema.projectTable.id),
    )
    .where(and(...predicates));
  const statusCounts: Record<string, number> = {};
  const priorityCounts: Record<string, number> = {};
  const projectHealthCounts: Record<string, number> = {};
  const now = new Date();
  let overdue = 0;
  let ageHoursTotal = 0;
  let oldestTaskAgeHours = 0;
  for (const task of tasks) {
    const ageHours = Math.max(
      0,
      (now.getTime() - task.createdAt.getTime()) / 3_600_000,
    );
    ageHoursTotal += ageHours;
    oldestTaskAgeHours = Math.max(oldestTaskAgeHours, ageHours);
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    const priority = task.priority ?? "no-priority";
    priorityCounts[priority] = (priorityCounts[priority] ?? 0) + 1;
    projectHealthCounts[task.projectHealth] =
      (projectHealthCounts[task.projectHealth] ?? 0) + 1;
    if (task.dueDate && task.dueDate < now) overdue += 1;
  }
  return {
    question,
    window: { since: since ?? null, until: until ?? null },
    tasks: {
      total: tasks.length,
      overdue,
      byStatus: statusCounts,
      byPriority: priorityCounts,
    },
    projects: { byHealth: projectHealthCounts },
    elapsed: {
      averageTaskAgeHours:
        tasks.length === 0 ? 0 : ageHoursTotal / tasks.length,
      oldestTaskAgeHours,
    },
    definitions: {
      question: ANALYTICS_QUESTIONS[question],
      total: "tasks created in the selected window",
      overdue: "tasks with dueDate before the request time",
      byStatus: "task.status grouped exactly as stored",
      byPriority: "task.priority grouped exactly as stored",
      projectHealth: "project health repeated per matching task",
      averageTaskAgeHours: "mean hours since task.createdAt",
      oldestTaskAgeHours: "maximum hours since task.createdAt",
    },
  };
}

function requiredUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    badRequest(`${field} must be an http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    badRequest(`${field} must be an http(s) URL`);
  }
  return value;
}

export function parseProposalInput(input: unknown) {
  const body = asObject(input);
  const source = requiredUrl(
    stringField(body, "source", { max: 500 }) as string,
    "source",
  );
  const ownerUserId = stringField(body, "ownerUserId", { max: 200 }) as string;
  const dedupeKey = stringField(body, "dedupeKey", { max: 240 }) as string;
  const rawEvidence = objectField(body, "evidence");
  const summary = stringField(rawEvidence, "summary", { max: 5000 });
  const rawLinks = rawEvidence.links;
  if (rawLinks !== undefined && !Array.isArray(rawLinks)) {
    badRequest("evidence.links must be an array");
  }
  const links = (rawLinks ?? []).map((link, index) =>
    requiredUrl(
      typeof link === "string"
        ? link.trim()
        : badRequest(`evidence.links[${index}] must be a URL`),
      `evidence.links[${index}]`,
    ),
  );
  const rawAction = objectField(body, "requestedAction");
  const type = stringField(rawAction, "type", { max: 120 }) as string;
  const description = stringField(rawAction, "description", {
    optional: true,
    max: 2000,
  });
  const payload =
    rawAction.payload === undefined ? {} : objectField(rawAction, "payload");
  return {
    source,
    ownerUserId,
    dedupeKey,
    evidence: { summary, ...(links.length > 0 ? { links } : {}) },
    requestedAction: {
      type,
      ...(description === undefined ? {} : { description }),
      payload,
    },
  };
}

export async function createProposal(workspaceId: string, input: unknown) {
  const parsed = parseProposalInput(input);
  await assertWorkspaceUser(workspaceId, parsed.ownerUserId);
  const [created] = await db
    .insert(schema.operatorProposalTable)
    .values({ id: createId(), workspaceId, ...parsed })
    .onConflictDoNothing({
      target: [
        schema.operatorProposalTable.workspaceId,
        schema.operatorProposalTable.dedupeKey,
      ],
    })
    .returning();
  if (created) {
    const delivery = await enqueueOperatorEvent(
      workspaceId,
      {
        eventType: "proposal.received",
        aggregateType: "proposal",
        aggregateId: created.id,
        idempotencyKey: `proposal:${workspaceId}:${created.dedupeKey}`,
        payload: {
          proposalId: created.id,
          source: created.source,
          requestedAction: created.requestedAction,
        },
      },
      created.ownerUserId,
    );
    await recordJobAttempt(workspaceId, delivery.id, { status: "succeeded" });
    return created;
  }
  const [existing] = await db
    .select()
    .from(schema.operatorProposalTable)
    .where(
      and(
        eq(schema.operatorProposalTable.workspaceId, workspaceId),
        eq(schema.operatorProposalTable.dedupeKey, parsed.dedupeKey),
      ),
    )
    .limit(1);
  if (!existing) conflict("Dedupe key was concurrently claimed");
  return existing;
}

export async function listProposals(workspaceId: string, limit?: number) {
  return db
    .select()
    .from(schema.operatorProposalTable)
    .where(eq(schema.operatorProposalTable.workspaceId, workspaceId))
    .orderBy(desc(schema.operatorProposalTable.createdAt))
    .limit(boundedLimit(limit));
}

export async function reviewProposal(
  workspaceId: string,
  proposalId: string,
  reviewerId: string,
  input: unknown,
) {
  const body = asObject(input);
  const status = inValues(
    stringField(body, "status") as string,
    ["approved", "rejected", "deferred"] as const,
    "status",
  );
  const reviewNote = stringField(body, "reviewNote", {
    optional: true,
    max: 2000,
  });
  const [proposal] = await db
    .update(schema.operatorProposalTable)
    .set({
      status,
      reviewedBy: reviewerId,
      reviewNote: reviewNote ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.operatorProposalTable.id, proposalId),
        eq(schema.operatorProposalTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  if (!proposal) notFound("Proposal not found");
  return proposal;
}

export function parseIntegrationInput(input: unknown) {
  const body = asObject(input);
  const kind = stringField(body, "kind", { max: 80 }) as string;
  const displayName = stringField(body, "displayName", { max: 120 }) as string;
  const status = inValues(
    (stringField(body, "status", { optional: true }) as string | undefined) ??
      "disabled",
    ["disabled", "ready", "paused"] as const,
    "status",
  );
  const config = body.config === undefined ? {} : objectField(body, "config");
  rejectCredentialKeys(config);
  return { kind, displayName, status, config };
}

export async function createIntegration(workspaceId: string, input: unknown) {
  const parsed = parseIntegrationInput(input);
  const [created] = await db
    .insert(schema.operatorIntegrationTable)
    .values({ id: createId(), workspaceId, ...parsed })
    .onConflictDoNothing({
      target: [
        schema.operatorIntegrationTable.workspaceId,
        schema.operatorIntegrationTable.kind,
      ],
    })
    .returning();
  if (created) return integrationSummary(created);
  const [existing] = await db
    .select()
    .from(schema.operatorIntegrationTable)
    .where(
      and(
        eq(schema.operatorIntegrationTable.workspaceId, workspaceId),
        eq(schema.operatorIntegrationTable.kind, parsed.kind),
      ),
    )
    .limit(1);
  if (!existing) conflict("Integration kind was concurrently claimed");
  return integrationSummary(existing);
}

export async function listIntegrations(workspaceId: string, limit?: number) {
  const rows = await db
    .select()
    .from(schema.operatorIntegrationTable)
    .where(eq(schema.operatorIntegrationTable.workspaceId, workspaceId))
    .orderBy(asc(schema.operatorIntegrationTable.createdAt))
    .limit(boundedLimit(limit));
  return rows.map(integrationSummary);
}

export function parseIntegrationEventInput(input: unknown) {
  const body = asObject(input);
  const externalId = stringField(body, "externalId", { max: 240 }) as string;
  const payload =
    body.payload === undefined ? {} : asObject(body.payload, "payload");
  const cursor = stringField(body, "cursor", {
    optional: true,
    nullable: true,
    max: 500,
  });
  const externalIdentity = stringField(body, "externalIdentity", {
    optional: true,
    max: 240,
  });
  return {
    externalId,
    payload,
    ...(cursor === undefined ? {} : { cursor }),
    ...(externalIdentity === undefined ? {} : { externalIdentity }),
  };
}

export async function ingestIntegrationEvent(
  workspaceId: string,
  integrationId: string,
  replayOwnerUserId: string,
  input: unknown,
) {
  const integration = await assertIntegration(workspaceId, integrationId);
  if (integration.status !== "ready") {
    conflict("Integration must be ready before receiving events");
  }
  const parsed = parseIntegrationEventInput(input);
  const idempotencyKey = `integration:${integrationId}:${parsed.externalId}`;
  let localUserId: string | null = null;
  if (parsed.externalIdentity) {
    const [mapping] = await db
      .select({ localUserId: schema.operatorIdentityMapTable.localUserId })
      .from(schema.operatorIdentityMapTable)
      .where(
        and(
          eq(schema.operatorIdentityMapTable.integrationId, integrationId),
          eq(
            schema.operatorIdentityMapTable.externalIdentity,
            parsed.externalIdentity,
          ),
        ),
      )
      .limit(1);
    localUserId = mapping?.localUserId ?? null;
  }
  const [existing] = await db
    .select({ id: schema.operatorOutboxTable.id })
    .from(schema.operatorOutboxTable)
    .where(
      and(
        eq(schema.operatorOutboxTable.workspaceId, workspaceId),
        eq(schema.operatorOutboxTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  const event = await enqueueOperatorEvent(
    workspaceId,
    {
      eventType: `integration.${integration.kind}.received`,
      aggregateType: "integration",
      aggregateId: integration.id,
      idempotencyKey,
      payload: {
        ...parsed.payload,
        externalId: parsed.externalId,
        ...(parsed.externalIdentity
          ? { externalIdentity: parsed.externalIdentity }
          : {}),
        ...(localUserId ? { localUserId } : {}),
      },
    },
    replayOwnerUserId,
  );
  if (parsed.cursor !== undefined) {
    await db
      .update(schema.operatorIntegrationTable)
      .set({ cursor: parsed.cursor, updatedAt: new Date() })
      .where(eq(schema.operatorIntegrationTable.id, integration.id));
  }
  return {
    integrationId: integration.id,
    externalId: parsed.externalId,
    eventId: event.id,
    deduplicated: Boolean(existing),
    localUserId,
    cursor: parsed.cursor === undefined ? integration.cursor : parsed.cursor,
  };
}

export async function updateIntegrationCursor(
  workspaceId: string,
  integrationId: string,
  input: unknown,
) {
  const body = asObject(input);
  const cursor = stringField(body, "cursor", {
    optional: true,
    nullable: true,
    max: 500,
  });
  const [updated] = await db
    .update(schema.operatorIntegrationTable)
    .set({ cursor: cursor ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.operatorIntegrationTable.id, integrationId),
        eq(schema.operatorIntegrationTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  if (!updated) notFound("Integration not found");
  return integrationSummary(updated);
}

export async function listIdentityMaps(
  workspaceId: string,
  integrationId: string,
  limit?: number,
) {
  await assertIntegration(workspaceId, integrationId);
  return db
    .select()
    .from(schema.operatorIdentityMapTable)
    .where(
      and(
        eq(schema.operatorIdentityMapTable.workspaceId, workspaceId),
        eq(schema.operatorIdentityMapTable.integrationId, integrationId),
      ),
    )
    .orderBy(asc(schema.operatorIdentityMapTable.externalIdentity))
    .limit(boundedLimit(limit));
}

async function assertIntegration(workspaceId: string, integrationId: string) {
  const [integration] = await db
    .select()
    .from(schema.operatorIntegrationTable)
    .where(
      and(
        eq(schema.operatorIntegrationTable.id, integrationId),
        eq(schema.operatorIntegrationTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!integration) notFound("Integration not found");
  return integration;
}

export async function upsertIdentityMap(
  workspaceId: string,
  integrationId: string,
  input: unknown,
) {
  await assertIntegration(workspaceId, integrationId);
  const body = asObject(input);
  const localUserId = stringField(body, "localUserId", { max: 200 }) as string;
  const externalIdentity = stringField(body, "externalIdentity", {
    max: 240,
  }) as string;
  const metadata =
    body.metadata === undefined ? {} : objectField(body, "metadata");
  rejectCredentialKeys(metadata, "metadata");
  await assertWorkspaceUser(workspaceId, localUserId);
  const [mapped] = await db
    .insert(schema.operatorIdentityMapTable)
    .values({
      id: createId(),
      workspaceId,
      integrationId,
      localUserId,
      externalIdentity,
      metadata,
    })
    .onConflictDoUpdate({
      target: [
        schema.operatorIdentityMapTable.integrationId,
        schema.operatorIdentityMapTable.externalIdentity,
      ],
      set: { localUserId, metadata, updatedAt: new Date() },
    })
    .returning();
  return mapped;
}
