import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

describe("API integration: saved-view focus label resolution", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("matches workspace label ids against task-scoped copies and returns workspace ids", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Focus label task",
        description: "",
        priority: "high",
        status: "to-do",
        columnId: columns.todo.id,
        number: 1,
        position: 1,
      })
      .returning();
    const [workspaceLabel] = await db
      .insert(schema.labelTable)
      .values({
        name: "Incident",
        color: "#ef4444",
        workspaceId: member.workspace.id,
      })
      .returning();
    const [taskLabel] = await db
      .insert(schema.labelTable)
      .values({
        name: workspaceLabel.name,
        color: workspaceLabel.color,
        taskId: task.id,
        workspaceId: member.workspace.id,
      })
      .returning();
    expect(taskLabel.id).not.toBe(workspaceLabel.id);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const body = {
      filters: {
        projectIds: [project.id],
        state: "any",
        due: "any",
        labelIds: [workspaceLabel.id],
      },
    };
    const query = await app.request(
      `/api/workspace/${member.workspace.id}/focus-query?limit=1`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(query.status).toBe(200);
    await expect(query.json()).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: task.id,
          labels: [workspaceLabel.id],
        }),
      ],
    });

    const facets = await app.request(
      `/api/workspace/${member.workspace.id}/focus-facets`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(facets.status).toBe(200);
    await expect(facets.json()).resolves.toMatchObject({
      total: 1,
      facets: { labels: { [workspaceLabel.id]: 1 } },
    });
  });

  it("allows editing a view using the API timestamp", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const definition = {
      filters: {
        projectIds: [project.id],
        state: "any",
        due: "any",
      },
    };
    const createdResponse = await app.request(
      `/api/workspace/${member.workspace.id}/saved-views`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Precision", ...definition }),
      },
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      updatedAt: string;
    };

    const updatedResponse = await app.request(`/api/saved-view/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Precision updated",
        ...definition,
        updatedAt: created.updatedAt,
      }),
    });
    expect(updatedResponse.status).toBe(200);
    await expect(updatedResponse.json()).resolves.toMatchObject({
      id: created.id,
      name: "Precision updated",
    });
  });

  it("matches an explicit no-priority filter", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Unprioritized focus task",
        description: "",
        priority: null,
        status: "to-do",
        columnId: columns.todo.id,
        number: 1,
        position: 1,
      })
      .returning();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/workspace/${member.workspace.id}/focus-query?limit=10`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: {
            projectIds: [project.id],
            state: "any",
            priorities: ["no-priority"],
            due: "any",
          },
        }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: task.id, priority: "no-priority" }),
      ],
    });
  });

  it("rejects a cursor created for a different sort", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db.insert(schema.taskTable).values([
      {
        projectId: project.id,
        title: "Cursor one",
        description: "",
        priority: "high",
        status: "to-do",
        columnId: columns.todo.id,
        number: 1,
        position: 1,
      },
      {
        projectId: project.id,
        title: "Cursor two",
        description: "",
        priority: "low",
        status: "to-do",
        columnId: columns.todo.id,
        number: 2,
        position: 2,
      },
    ]);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const first = await app.request(
      `/api/workspace/${member.workspace.id}/focus-query?limit=1`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: { projectIds: [project.id], state: "any", due: "any" },
        }),
      },
    );
    const firstBody = (await first.json()) as { nextCursor: string | null };
    expect(firstBody.nextCursor).toBeTruthy();

    const changedSort = await app.request(
      `/api/workspace/${member.workspace.id}/focus-query?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: { projectIds: [project.id], state: "any", due: "any" },
          sort: [
            { field: "title", direction: "asc" },
            { field: "dueDate", direction: "asc", nulls: "last" },
            { field: "updatedAt", direction: "desc" },
            { field: "taskId", direction: "asc" },
          ],
        }),
      },
    );
    expect(changedSort.status).toBe(400);
    await expect(changedSort.text()).resolves.toMatch(
      /cursor no longer matches this sort/i,
    );
  });
});
