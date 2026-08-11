import { Hono } from "hono";
import { validator } from "hono-openapi";
import * as v from "valibot";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  createSavedView,
  deleteSavedView,
  getSavedView,
  listSavedViews,
  normalizeFocusInput,
  runFocusQuery,
  runSavedView,
  updateSavedView,
} from "./service";

const unknownJson = v.unknown();
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
    validator("param", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromParam(),
    async (c) => {
      return c.json(
        await listSavedViews(c.get("workspaceId"), c.get("userId")),
      );
    },
  )
  .post(
    "/:workspaceId/saved-views",
    validator("param", v.object({ workspaceId: v.string() })),
    validator("json", unknownJson),
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
    validator("param", v.object({ workspaceId: v.string() })),
    validator("query", listQuery),
    validator("json", unknownJson),
    workspaceAccess.fromParam(),
    async (c) => {
      const { limit, cursor } = c.req.valid("query");
      const definition = await normalizeFocusInput(c.req.valid("json"));
      return c.json(
        await runFocusQuery(c.get("workspaceId"), definition, limit, cursor),
      );
    },
  );

const savedView = new Hono<{ Variables: RouteVariables }>()
  .get(
    "/:viewId",
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
    validator("param", v.object({ viewId: v.string() })),
    validator("json", unknownJson),
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
