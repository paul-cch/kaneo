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
});
