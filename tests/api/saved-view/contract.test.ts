import { describe, expect, it } from "vitest";
import {
  decodeSavedViewCursor,
  encodeSavedViewCursor,
  normalizeSavedViewDefinition,
} from "../../../apps/api/src/saved-view/contract";

describe("saved-view contract", () => {
  it("normalizes the versioned focus definition and appends taskId ordering", () => {
    const result = normalizeSavedViewDefinition({
      name: "  Focus  ",
      filters: {
        schemaVersion: 1,
        filters: {
          projectIds: ["p1"],
          state: "active",
          priorities: ["urgent"],
          assigneeIds: [],
          labelIds: [],
          due: "any",
          text: "  outage ",
        },
        sort: [{ field: "updatedAt", direction: "desc" }],
      },
    });

    expect(result.name).toBe("Focus");
    expect(result.filters.text).toBe("outage");
    expect(result.sort.at(-1)).toEqual({ field: "taskId", direction: "asc" });
  });

  it("rejects missing projects and duplicate sort terms", () => {
    expect(() =>
      normalizeSavedViewDefinition({
        name: "Empty",
        filters: { projectIds: [], state: "any", due: "any" },
      }),
    ).toThrow(/projectIds/);

    expect(() =>
      normalizeSavedViewDefinition({
        name: "Duplicate",
        filters: { projectIds: ["p1"], state: "any", due: "any" },
        sort: [
          { field: "title", direction: "asc" },
          { field: "title", direction: "asc" },
        ],
      }),
    ).toThrow(/duplicate/);
  });

  it("round-trips an opaque cursor", () => {
    const encoded = encodeSavedViewCursor({
      taskId: "task-1",
      position: 3,
      sortValues: [4, null, 1000, "task-1"],
    });
    expect(encoded).not.toContain("task-1");
    expect(decodeSavedViewCursor(encoded)).toEqual({
      taskId: "task-1",
      position: 3,
      sortValues: [4, null, 1000, "task-1"],
    });
  });
});
