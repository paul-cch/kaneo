import { Hono } from "hono";
import { validator } from "hono-openapi";
import * as v from "valibot";
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
  getOperatorEvent,
  getProjectOperator,
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

const unknownJson = v.unknown();
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
    validator("param", v.object({ projectId: v.string() })),
    validator("json", unknownJson),
    workspaceAccess.fromProject("projectId"),
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
    validator("param", v.object({ projectId: v.string() })),
    validator("json", unknownJson),
    workspaceAccess.fromProject("projectId"),
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
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await listCycles(c.get("workspaceId"), c.req.valid("query").limit),
      ),
  )
  .post(
    "/workspace/:workspaceId/cycles",
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(await createCycle(c.get("workspaceId"), c.req.valid("json")), 201),
  )
  .get(
    "/workspace/:workspaceId/cycles/:cycleId/tasks",
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
    validator(
      "param",
      v.object({ workspaceId: v.string(), cycleId: v.string() }),
    ),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
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
    validator(
      "param",
      v.object({
        workspaceId: v.string(),
        cycleId: v.string(),
        taskId: v.string(),
      }),
    ),
    workspaceAccess.fromParam(),
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
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
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
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await enqueueOperatorEvent(c.get("workspaceId"), c.req.valid("json")),
        201,
      ),
  )
  .get(
    "/workspace/:workspaceId/outbox/:eventId",
    validator(
      "param",
      v.object({ workspaceId: v.string(), eventId: v.string() }),
    ),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await getOperatorEvent(c.get("workspaceId"), c.req.param("eventId")),
      ),
  )
  .post(
    "/workspace/:workspaceId/outbox/:eventId/attempts",
    validator(
      "param",
      v.object({ workspaceId: v.string(), eventId: v.string() }),
    ),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
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
    validator(
      "param",
      v.object({ workspaceId: v.string(), eventId: v.string() }),
    ),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await replayOperatorEvent(c.get("workspaceId"), c.req.param("eventId")),
      ),
  )
  .get(
    "/workspace/:workspaceId/triage-rules",
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
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
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
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await enqueueTriageItem(c.get("workspaceId"), c.req.valid("json")),
        201,
      ),
  )
  .post(
    "/workspace/:workspaceId/triage-items/:itemId/apply",
    validator(
      "param",
      v.object({ workspaceId: v.string(), itemId: v.string() }),
    ),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await applyTriageItem(c.get("workspaceId"), c.req.param("itemId")),
      ),
  )
  .post(
    "/workspace/:workspaceId/analytics",
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(await analytics(c.get("workspaceId"), c.req.valid("json"))),
  )
  .get(
    "/workspace/:workspaceId/proposals",
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await listProposals(c.get("workspaceId"), c.req.valid("query").limit),
      ),
  )
  .post(
    "/workspace/:workspaceId/proposals",
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await createProposal(c.get("workspaceId"), c.req.valid("json")),
        201,
      ),
  )
  .post(
    "/workspace/:workspaceId/proposals/:proposalId/review",
    validator(
      "param",
      v.object({ workspaceId: v.string(), proposalId: v.string() }),
    ),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
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
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
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
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
    async (c) =>
      c.json(
        await createIntegration(c.get("workspaceId"), c.req.valid("json")),
        201,
      ),
  )
  .patch(
    "/workspace/:workspaceId/integrations/:integrationId/cursor",
    validator(
      "param",
      v.object({ workspaceId: v.string(), integrationId: v.string() }),
    ),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
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
    validator(
      "param",
      v.object({ workspaceId: v.string(), integrationId: v.string() }),
    ),
    validator("query", limitQuery),
    workspaceAccess.fromParam(),
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
    validator(
      "param",
      v.object({ workspaceId: v.string(), integrationId: v.string() }),
    ),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
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
