import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateSavedViewModal from "./create-saved-view-modal";

// The modal seeds selected projects from an effect keyed on the projects query
// result, so every mocked query must return a stable reference or the effect
// re-runs on each render.
const { workspaceLabels, emptyProjects, emptyMembers, focusQueryResult } =
  vi.hoisted(() => ({
    workspaceLabels: vi.fn(),
    emptyProjects: { data: [] as unknown[] },
    emptyMembers: { data: { members: [] as unknown[] } },
    focusQueryResult: { data: undefined, isError: false, isFetching: false },
  }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/mutations/saved-view/use-create-saved-view", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({ data: workspaceLabels() }),
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => emptyProjects,
}));

vi.mock("@/hooks/queries/saved-view/use-run-focus-query", () => ({
  default: () => focusQueryResult,
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => emptyMembers,
  }),
);

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

describe("CreateSavedViewModal label picker", () => {
  it("lists each workspace label once and ignores task-scoped copies", () => {
    workspaceLabels.mockReturnValue([
      { id: "label-1", name: "Bug", color: "red", taskId: null },
      { id: "label-1-task-copy", name: "Bug", color: "red", taskId: "task-1" },
      { id: "label-2", name: "Chore", color: "blue", taskId: null },
    ]);

    render(
      <CreateSavedViewModal open workspaceId="workspace-1" onClose={vi.fn()} />,
    );

    expect(screen.getAllByText("Bug")).toHaveLength(1);
    expect(screen.getAllByText("Chore")).toHaveLength(1);
  });

  it("submits only workspace template label ids", () => {
    workspaceLabels.mockReturnValue([
      { id: "label-1", name: "Bug", color: "red", taskId: null },
      { id: "label-1-task-copy", name: "Bug", color: "red", taskId: "task-1" },
    ]);

    render(
      <CreateSavedViewModal open workspaceId="workspace-1" onClose={vi.fn()} />,
    );

    const checkboxes = screen
      .getAllByRole("checkbox")
      .filter((element) => element.parentElement?.textContent?.includes("Bug"));

    expect(checkboxes).toHaveLength(1);
  });

  it("shows the empty state when only task-scoped labels exist", () => {
    workspaceLabels.mockReturnValue([
      { id: "label-1-task-copy", name: "Bug", color: "red", taskId: "task-1" },
    ]);

    render(
      <CreateSavedViewModal open workspaceId="workspace-1" onClose={vi.fn()} />,
    );

    expect(screen.getByText("workspace:focus.noLabels")).toBeVisible();
  });
});
