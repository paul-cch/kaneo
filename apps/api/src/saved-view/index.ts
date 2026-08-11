import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  createSavedView,
  deleteSavedView,
  getSavedView,
  listSavedViews,
  normalizeFocusInput,
  runFocusFacets,
  runFocusQuery,
  runSavedView,
  updateSavedView,
} from "./service";

const nonEmptyString = v.pipe(v.string(), v.minLength(1));
const sortTermSchema = v.strictObject({
  field: v.picklist([
    "priority",
    "dueDate",
    "updatedAt",
    "createdAt",
    "title",
    "taskId",
  ]),
  direction: v.picklist(["asc", "desc"]),
  nulls: v.optional(v.picklist(["first", "last"])),
});
const savedFilterFields = {
  projectIds: v.optional(v.array(nonEmptyString)),
  state: v.optional(v.picklist(["active", "final", "any"])),
  priorities: v.optional(
    v.array(v.picklist(["urgent", "high", "medium", "low", "no-priority"])),
  ),
  assigneeIds: v.optional(v.array(nonEmptyString)),
  labelIds: v.optional(v.array(nonEmptyString)),
  due: v.optional(
    v.picklist([
      "overdue",
      "today",
      "next-7-days",
      "next-30-days",
      "no-due-date",
      "any",
    ]),
  ),
  text: v.optional(v.pipe(v.string(), v.maxLength(200))),
};
const savedFilterValuesSchema = v.strictObject(savedFilterFields);
const savedFiltersSchema = v.union([
  savedFilterValuesSchema,
  v.strictObject({
    schemaVersion: v.optional(v.pipe(v.number(), v.integer())),
    filters: savedFilterValuesSchema,
    sort: v.optional(v.array(sortTermSchema)),
  }),
  v.strictObject({
    schemaVersion: v.optional(v.pipe(v.number(), v.integer())),
    sort: v.optional(v.array(sortTermSchema)),
    ...savedFilterFields,
  }),
]);
const savedViewInputSchema = v.strictObject({
  name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(80))),
  filters: savedFiltersSchema,
  sort: v.optional(v.array(sortTermSchema)),
  pinnedPosition: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
  ),
  updatedAt: v.optional(nonEmptyString),
});
const describeSavedView = (
  operationId: string,
  description: string,
  status: 200 | 201 = 200,
) =>
  describeRoute({
    operationId,
    tags: ["Saved Views"],
    description,
    responses: {
      [status]: {
        description,
        content: { "application/json": { schema: resolver(v.any()) } },
      },
    },
  });

const listQuery = v.object({
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
  cursor: v.optional(v.string()),
});

type RouteVariables = {
  userId: string;
  workspaceId: string;
};

export const savedViewWorkspace = new Hono<{ Variables: RouteVariables }>()
  .get(
    "/:workspaceId/saved-views",
    describeSavedView("listSavedViews", "List the current user's saved views."),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", listQuery),
    workspaceAccess.fromParam(),
    async (c) => {
      return c.json(
        await listSavedViews(
          c.get("workspaceId"),
          c.get("userId"),
          c.req.valid("query").limit,
        ),
      );
    },
  )
  .post(
    "/:workspaceId/saved-views",
    describeSavedView("createSavedView", "Create a saved view.", 201),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", savedViewInputSchema),
    workspaceAccess.fromParam(),
    async (c) => {
      const view = await createSavedView(
        c.get("workspaceId"),
        c.get("userId"),
        c.req.valid("json"),
      );
      return c.json(view, 201);
    },
  )
  .post(
    "/:workspaceId/focus-query",
    describeSavedView(
      "runFocusQuery",
      "Run a focus query and return its task page.",
    ),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", listQuery),
    validator("json", savedViewInputSchema),
    workspaceAccess.fromParam(),
    async (c) => {
      const { limit, cursor } = c.req.valid("query");
      const definition = await normalizeFocusInput(c.req.valid("json"));
      return c.json(
        await runFocusQuery(c.get("workspaceId"), definition, limit, cursor),
      );
    },
  )
  .post(
    "/:workspaceId/focus-facets",
    describeSavedView("runFocusFacets", "Compute facets for a focus query."),
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", savedViewInputSchema),
    workspaceAccess.fromParam(),
    async (c) => {
      const definition = await normalizeFocusInput(c.req.valid("json"));
      return c.json(await runFocusFacets(c.get("workspaceId"), definition));
    },
  );

const savedView = new Hono<{ Variables: RouteVariables }>()
  .get(
    "/:viewId",
    describeSavedView("getSavedView", "Get a saved view."),
    validator("param", v.object({ viewId: v.string() })),
    workspaceAccess.fromSavedView(),
    async (c) => {
      return c.json(
        await getSavedView(
          c.req.param("viewId"),
          c.get("workspaceId"),
          c.get("userId"),
        ),
      );
    },
  )
  .put(
    "/:viewId",
    describeSavedView("updateSavedView", "Update a saved view."),
    validator("param", v.object({ viewId: v.string() })),
    validator("json", savedViewInputSchema),
    workspaceAccess.fromSavedView(),
    async (c) => {
      return c.json(
        await updateSavedView(
          c.req.param("viewId"),
          c.get("workspaceId"),
          c.get("userId"),
          c.req.valid("json"),
        ),
      );
    },
  )
  .delete(
    "/:viewId",
    describeSavedView("deleteSavedView", "Delete a saved view."),
    validator("param", v.object({ viewId: v.string() })),
    workspaceAccess.fromSavedView(),
    async (c) => {
      return c.json(
        await deleteSavedView(
          c.req.param("viewId"),
          c.get("workspaceId"),
          c.get("userId"),
        ),
      );
    },
  )
  .get(
    "/:viewId/tasks",
    describeSavedView(
      "runSavedView",
      "Run a saved view and return its task page.",
    ),
    validator("param", v.object({ viewId: v.string() })),
    validator("query", listQuery),
    workspaceAccess.fromSavedView(),
    async (c) => {
      const { limit, cursor } = c.req.valid("query");
      return c.json(
        await runSavedView(
          c.req.param("viewId"),
          c.get("workspaceId"),
          c.get("userId"),
          limit,
          cursor,
        ),
      );
    },
  );

export default savedView;
