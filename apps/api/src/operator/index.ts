import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  addCycleTask,
  analytics,
  applyTriageItem,
  createCycle,
  createIntegration,
  createProjectUpdate,
  createProposal,
  createTriageRule,
  enqueueOperatorEvent,
  enqueueTriageItem,
  getCurrentCycle,
  getOperatorEvent,
  getProjectOperator,
  ingestIntegrationEvent,
  listCycles,
  listCycleTasks,
  listIdentityMaps,
  listIntegrations,
  listOperatorEvents,
  listProjectUpdates,
  listProposals,
  listTriageItems,
  listTriageRules,
  recordJobAttempt,
  removeCycleTask,
  replayOperatorEvent,
  reviewProposal,
  updateIntegrationCursor,
  updateProjectOperator,
  upsertIdentityMap,
} from "./service";

const nonEmptyString = v.pipe(v.string(), v.minLength(1));
const limitedString = (max: number) => v.pipe(nonEmptyString, v.maxLength(max));
const jsonObject = v.record(v.string(), v.unknown());
const projectOperatorInputSchema = v.strictObject({
  leadUserId: v.optional(v.nullable(nonEmptyString)),
  targetDate: v.optional(v.nullable(nonEmptyString)),
  status: v.optional(v.picklist(["active", "paused", "completed"])),
  health: v.optional(v.picklist(["on-track", "at-risk", "off-track"])),
});
const projectUpdateInputSchema = v.strictObject({
  body: limitedString(5000),
});
const cycleInputSchema = v.strictObject({
  name: limitedString(120),
  startsAt: nonEmptyString,
  endsAt: nonEmptyString,
  status: v.optional(
    v.picklist(["planned", "active", "completed", "cancelled"]),
  ),
  rolloverPolicy: v.optional(v.picklist(["manual", "carry-over"])),
});
const taskIdInputSchema = v.strictObject({ taskId: nonEmptyString });
const outboxInputSchema = v.strictObject({
  eventType: limitedString(120),
  aggregateType: limitedString(80),
  aggregateId: limitedString(200),
  idempotencyKey: limitedString(240),
  payload: v.optional(jsonObject),
  maxAttempts: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
  ),
});
const attemptInputSchema = v.strictObject({
  status: v.picklist(["running", "succeeded", "failed"]),
  error: v.optional(v.pipe(v.string(), v.maxLength(2000))),
});
const triageActionSchema = v.strictObject({
  type: v.picklist(["set_status", "set_priority", "assign_user", "add_label"]),
  value: nonEmptyString,
});
const triageConditionsSchema = v.strictObject({
  status: v.optional(v.array(nonEmptyString)),
  priority: v.optional(v.array(nonEmptyString)),
  projectId: v.optional(v.array(nonEmptyString)),
  assigneeId: v.optional(v.array(nonEmptyString)),
  labelId: v.optional(v.array(nonEmptyString)),
  titleIncludes: v.optional(v.string()),
});
const triageRuleInputSchema = v.strictObject({
  name: limitedString(120),
  priority: v.optional(v.pipe(v.number(), v.integer())),
  enabled: v.optional(v.boolean()),
  conditions: triageConditionsSchema,
  action: triageActionSchema,
});
const triageItemInputSchema = v.strictObject({
  taskId: nonEmptyString,
  ruleId: v.optional(nonEmptyString),
  source: v.optional(limitedString(80)),
  proposedAction: v.optional(triageActionSchema),
});
const analyticsInputSchema = v.strictObject({
  question: v.optional(v.picklist(["workload", "aging", "overdue"])),
  since: v.optional(nonEmptyString),
  until: v.optional(nonEmptyString),
});
const proposalInputSchema = v.strictObject({
  source: limitedString(500),
  ownerUserId: limitedString(200),
  dedupeKey: limitedString(240),
  evidence: v.strictObject({
    summary: limitedString(5000),
    links: v.optional(v.array(limitedString(500))),
  }),
  requestedAction: v.strictObject({
    type: limitedString(120),
    description: v.optional(v.pipe(v.string(), v.maxLength(2000))),
    payload: v.optional(jsonObject),
  }),
});
const reviewInputSchema = v.strictObject({
  status: v.picklist(["approved", "rejected", "deferred"]),
  reviewNote: v.optional(v.pipe(v.string(), v.maxLength(2000))),
});
const integrationInputSchema = v.strictObject({
  kind: limitedString(80),
  displayName: limitedString(120),
  status: v.optional(v.picklist(["disabled", "ready", "paused"])),
  config: v.optional(jsonObject),
});
const integrationEventInputSchema = v.strictObject({
  externalId: limitedString(240),
  payload: v.optional(jsonObject),
  cursor: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(500)))),
  externalIdentity: v.optional(limitedString(240)),
});
const cursorInputSchema = v.strictObject({
  cursor: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(500)))),
});
const identityMapInputSchema = v.strictObject({
  localUserId: limitedString(200),
  externalIdentity: limitedString(240),
  metadata: v.optional(jsonObject),
});
const describeOperator = (
  operationId: string,
  description: string,
  status: 200 | 201 = 200,
) =>
  describeRoute({
    operationId,
    tags: ["Operator"],
    description,
    responses: {
      [status]: {
        description,
        content: { "application/json": { schema: resolver(v.any()) } },
      },
    },
  });
const limitQuery = v.object({
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform(Number),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(100),
    ),
    "50",
  ),
});
type RouteVariables = { userId: string; workspaceId: string };

const operator = new Hono<{ Variables: RouteVariables }>()
  .get(
    "/projects/:projectId/operator",
    describeOperator("getProjectOperator", "Get project operator metadata."),
    validator("param", v.object({ projectId: v.string() })),
    workspaceAccess.fromProject("projectId"),
    async (c) =>
      c.json(
        await getProjectOperator(
          c.req.param("projectId"),
          c.get("workspaceId"),
        ),
      ),
  )
  .put(
    "/projects/:projectId/operator",
    describeOperator(
      "updateProjectOperator",
      "Update project operator metadata.",
    ),
    validator("param", v.object({ projectId: v.string() })),
    validator("json", projectOperatorInputSchema),
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
    async (c) =>
      c.json(
        await updateProjectOperator(
          c.req.param("projectId"),
          c.get("workspaceId"),
          c.req.valid("json"),
        ),
      ),
  )
  .get(
    "/projects/:projectId/status-updates",
    describeOperator(
      "listProjectStatusUpdates",
      "List project status updates.",
    ),
    validator("param", v.object({ projectId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromProject("projectId"),
    async (c) =>
      c.json(
        await listProjectUpdates(
          c.req.param("projectId"),
          c.get("workspaceId"),
          c.req.valid("query").limit,
        ),
      ),
  )
  .post(
    "/projects/:projectId/status-updates",
    describeOperator(
      "createProjectStatusUpdate",
      "Create a project status update.",
      201,
    ),
    validator("param", v.object({ projectId: v.string() })),
    validator("json", projectUpdateInputSchema),
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
    async (c) =>
      c.json(
        await createProjectUpdate(
          c.req.param("projectId"),
          c.get("workspaceId"),
          c.get("userId"),
          c.req.valid("json"),
        ),
        201,
      ),
  )
  .get(
    "/workspace/:workspaceId/cycles",
    describeOperator("listCycles", "List workspace cycles."),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await listCycles(c.get("workspaceId"), c.req.valid("query").limit),
      ),
  )
  .get(
    "/workspace/:workspaceId/cycles/current",
    describeOperator("getCurrentCycle", "Get the current cycle."),
    validator("param", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromParam(),
    async (c) => c.json(await getCurrentCycle(c.get("workspaceId"))),
  )
  .post(
    "/workspace/:workspaceId/cycles",
    describeOperator("createCycle", "Create a cycle.", 201),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", cycleInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(await createCycle(c.get("workspaceId"), c.req.valid("json")), 201),
  )
  .get(
    "/workspace/:workspaceId/cycles/:cycleId/tasks",
    describeOperator("listCycleTasks", "List tasks assigned to a cycle."),
    validator(
      "param",
      v.object({ workspaceId: v.string(), cycleId: v.string() }),
    ),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await listCycleTasks(c.get("workspaceId"), c.req.param("cycleId")),
      ),
  )
  .post(
    "/workspace/:workspaceId/cycles/:cycleId/tasks",
    describeOperator("addCycleTask", "Add a task to a cycle.", 201),
    validator(
      "param",
      v.object({ workspaceId: v.string(), cycleId: v.string() }),
    ),
    validator("json", taskIdInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) =>
      c.json(
        await addCycleTask(
          c.get("workspaceId"),
          c.req.param("cycleId"),
          c.req.valid("json"),
        ),
        201,
      ),
  )
  .delete(
    "/workspace/:workspaceId/cycles/:cycleId/tasks/:taskId",
    describeOperator("removeCycleTask", "Remove a task from a cycle."),
    validator(
      "param",
      v.object({
        workspaceId: v.string(),
        cycleId: v.string(),
        taskId: v.string(),
      }),
    ),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) =>
      c.json(
        await removeCycleTask(
          c.get("workspaceId"),
          c.req.param("cycleId"),
          c.req.param("taskId"),
        ),
      ),
  )
  .get(
    "/workspace/:workspaceId/outbox",
    describeOperator("listOperatorEvents", "List operator outbox events."),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await listOperatorEvents(
          c.get("workspaceId"),
          c.req.valid("query").limit,
        ),
      ),
  )
  .post(
    "/workspace/:workspaceId/outbox",
    describeOperator(
      "enqueueOperatorEvent",
      "Enqueue an operator outbox event.",
      201,
    ),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", outboxInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await enqueueOperatorEvent(
          c.get("workspaceId"),
          c.req.valid("json"),
          c.get("userId"),
        ),
        201,
      ),
  )
  .get(
    "/workspace/:workspaceId/outbox/:eventId",
    describeOperator(
      "getOperatorEvent",
      "Get an operator outbox event and attempts.",
    ),
    validator(
      "param",
      v.object({ workspaceId: v.string(), eventId: v.string() }),
    ),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await getOperatorEvent(c.get("workspaceId"), c.req.param("eventId")),
      ),
  )
  .post(
    "/workspace/:workspaceId/outbox/:eventId/attempts",
    describeOperator(
      "recordOperatorJobAttempt",
      "Record an operator job attempt.",
      201,
    ),
    validator(
      "param",
      v.object({ workspaceId: v.string(), eventId: v.string() }),
    ),
    validator("json", attemptInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await recordJobAttempt(
          c.get("workspaceId"),
          c.req.param("eventId"),
          c.req.valid("json"),
        ),
        201,
      ),
  )
  .post(
    "/workspace/:workspaceId/outbox/:eventId/replay",
    describeOperator(
      "replayOperatorEvent",
      "Replay a failed operator outbox event.",
    ),
    validator(
      "param",
      v.object({ workspaceId: v.string(), eventId: v.string() }),
    ),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await replayOperatorEvent(c.get("workspaceId"), c.req.param("eventId")),
      ),
  )
  .get(
    "/workspace/:workspaceId/triage-rules",
    describeOperator("listTriageRules", "List workspace triage rules."),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await listTriageRules(c.get("workspaceId"), c.req.valid("query").limit),
      ),
  )
  .post(
    "/workspace/:workspaceId/triage-rules",
    describeOperator("createTriageRule", "Create a triage rule.", 201),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", triageRuleInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await createTriageRule(
          c.get("workspaceId"),
          c.get("userId"),
          c.req.valid("json"),
        ),
        201,
      ),
  )
  .get(
    "/workspace/:workspaceId/triage-items",
    describeOperator("listTriageItems", "List pending triage items."),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await listTriageItems(c.get("workspaceId"), c.req.valid("query").limit),
      ),
  )
  .post(
    "/workspace/:workspaceId/triage-items",
    describeOperator(
      "enqueueTriageItem",
      "Create a triage item for a task.",
      201,
    ),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", triageItemInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await enqueueTriageItem(c.get("workspaceId"), c.req.valid("json")),
        201,
      ),
  )
  .post(
    "/workspace/:workspaceId/triage-items/:itemId/apply",
    describeOperator("applyTriageItem", "Apply a pending triage item."),
    validator(
      "param",
      v.object({ workspaceId: v.string(), itemId: v.string() }),
    ),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) =>
      c.json(
        await applyTriageItem(
          c.get("workspaceId"),
          c.req.param("itemId"),
          c.get("userId"),
        ),
      ),
  )
  .post(
    "/workspace/:workspaceId/analytics",
    describeOperator(
      "getOperatorAnalytics",
      "Compute workspace operator analytics.",
    ),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", analyticsInputSchema),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(await analytics(c.get("workspaceId"), c.req.valid("json"))),
  )
  .get(
    "/workspace/:workspaceId/proposals",
    describeOperator("listOperatorProposals", "List operator proposals."),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await listProposals(c.get("workspaceId"), c.req.valid("query").limit),
      ),
  )
  .post(
    "/workspace/:workspaceId/proposals",
    describeOperator(
      "createOperatorProposal",
      "Create an operator proposal.",
      201,
    ),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", proposalInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await createProposal(c.get("workspaceId"), c.req.valid("json")),
        201,
      ),
  )
  .post(
    "/workspace/:workspaceId/proposals/:proposalId/review",
    describeOperator("reviewOperatorProposal", "Review an operator proposal."),
    validator(
      "param",
      v.object({ workspaceId: v.string(), proposalId: v.string() }),
    ),
    validator("json", reviewInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await reviewProposal(
          c.get("workspaceId"),
          c.req.param("proposalId"),
          c.get("userId"),
          c.req.valid("json"),
        ),
      ),
  )
  .get(
    "/workspace/:workspaceId/integrations",
    describeOperator("listOperatorIntegrations", "List operator integrations."),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await listIntegrations(
          c.get("workspaceId"),
          c.req.valid("query").limit,
        ),
      ),
  )
  .post(
    "/workspace/:workspaceId/integrations",
    describeOperator(
      "createOperatorIntegration",
      "Create an operator integration.",
      201,
    ),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", integrationInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await createIntegration(c.get("workspaceId"), c.req.valid("json")),
        201,
      ),
  )
  .post(
    "/workspace/:workspaceId/integrations/:integrationId/events",
    describeOperator(
      "ingestIntegrationEvent",
      "Ingest an external integration event.",
      201,
    ),
    validator(
      "param",
      v.object({ workspaceId: v.string(), integrationId: v.string() }),
    ),
    validator("json", integrationEventInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await ingestIntegrationEvent(
          c.get("workspaceId"),
          c.req.param("integrationId"),
          c.get("userId"),
          c.req.valid("json"),
        ),
        201,
      ),
  )
  .patch(
    "/workspace/:workspaceId/integrations/:integrationId/cursor",
    describeOperator(
      "updateIntegrationCursor",
      "Update an integration cursor.",
    ),
    validator(
      "param",
      v.object({ workspaceId: v.string(), integrationId: v.string() }),
    ),
    validator("json", cursorInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await updateIntegrationCursor(
          c.get("workspaceId"),
          c.req.param("integrationId"),
          c.req.valid("json"),
        ),
      ),
  )
  .get(
    "/workspace/:workspaceId/integrations/:integrationId/identity-maps",
    describeOperator(
      "listIdentityMaps",
      "List external identity mappings for an integration.",
    ),
    validator(
      "param",
      v.object({ workspaceId: v.string(), integrationId: v.string() }),
    ),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await listIdentityMaps(
          c.get("workspaceId"),
          c.req.param("integrationId"),
          c.req.valid("query").limit,
        ),
      ),
  )
  .post(
    "/workspace/:workspaceId/integrations/:integrationId/identity-maps",
    describeOperator(
      "upsertIdentityMap",
      "Create or replace an external identity mapping.",
      201,
    ),
    validator(
      "param",
      v.object({ workspaceId: v.string(), integrationId: v.string() }),
    ),
    validator("json", identityMapInputSchema),
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
    async (c) =>
      c.json(
        await upsertIdentityMap(
          c.get("workspaceId"),
          c.req.param("integrationId"),
          c.req.valid("json"),
        ),
        201,
      ),
  );

export default operator;
