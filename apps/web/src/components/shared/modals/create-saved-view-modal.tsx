import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import useCreateSavedView from "@/hooks/mutations/saved-view/use-create-saved-view";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useRunFocusQuery from "@/hooks/queries/saved-view/use-run-focus-query";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { toast } from "@/lib/toast";

type CreateSavedViewModalProps = {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
};

function CreateSavedViewModal({
  open,
  workspaceId,
  onClose,
}: CreateSavedViewModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects } = useGetProjects({ workspaceId });
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const { data: workspaceLabels = [] } = useGetLabelsByWorkspace(workspaceId);
  const { mutateAsync, isPending } = useCreateSavedView();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [state, setState] = useState<"active" | "final" | "any">("active");
  const [priorities, setPriorities] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [due, setDue] = useState<
    "overdue" | "today" | "next-7-days" | "next-30-days" | "no-due-date" | "any"
  >("any");

  const previewInput = useMemo(
    () => ({
      filters: {
        schemaVersion: 1 as const,
        filters: {
          projectIds: selectedProjectIds,
          state,
          priorities,
          assigneeIds,
          labelIds,
          due,
          ...(text.trim() ? { text: text.trim() } : {}),
        },
      },
      sort: [
        { field: "priority" as const, direction: "desc" as const },
        {
          field: "dueDate" as const,
          direction: "asc" as const,
          nulls: "last" as const,
        },
        { field: "updatedAt" as const, direction: "desc" as const },
        { field: "taskId" as const, direction: "asc" as const },
      ],
    }),
    [selectedProjectIds, state, priorities, assigneeIds, labelIds, due, text],
  );
  const {
    data: previewData,
    isError: previewError,
    isFetching: previewLoading,
  } = useRunFocusQuery({
    workspaceId,
    input: previewInput,
    enabled: open && selectedProjectIds.length > 0,
  });

  useEffect(() => {
    if (!open) return;
    setSelectedProjectIds((current) =>
      current.length > 0 ? current : projects?.[0]?.id ? [projects[0].id] : [],
    );
  }, [open, projects]);

  const reset = () => {
    setName("");
    setText("");
    setSelectedProjectIds([]);
    setState("active");
    setPriorities([]);
    setAssigneeIds([]);
    setLabelIds([]);
    setDue("any");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  };

  const priorityLabel = (priority: string) => {
    switch (priority) {
      case "urgent":
        return t("tasks:priority.urgent");
      case "high":
        return t("tasks:priority.high");
      case "medium":
        return t("tasks:priority.medium");
      case "low":
        return t("tasks:priority.low");
      default:
        return t("tasks:priority.no-priority");
    }
  };

  const toggleValue = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
  ) => {
    setter((current) =>
      current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || selectedProjectIds.length === 0) return;

    try {
      const view = await mutateAsync({
        workspaceId,
        input: {
          name: name.trim(),
          ...previewInput,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: ["saved-views", workspaceId],
      });
      navigate({
        to: "/dashboard/workspace/$workspaceId/focus/$viewId",
        params: { workspaceId, viewId: view.id },
      });
      toast.success(t("workspace:focus.created"));
      handleClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("workspace:focus.createError"),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("workspace:focus.newView")}</DialogTitle>
          <DialogDescription>
            {t("workspace:focus.createDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="saved-view-name" className="text-sm font-medium">
              {t("workspace:focus.name")}
            </label>
            <Input
              id="saved-view-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("workspace:focus.namePlaceholder")}
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium">
              {t("workspace:focus.projects")}
            </span>
            <div className="flex flex-wrap gap-2">
              {projects?.map((project) => {
                const selected = selectedProjectIds.includes(project.id);
                return (
                  <Button
                    key={project.id}
                    type="button"
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    aria-pressed={selected}
                    onClick={() => toggleProject(project.id)}
                  >
                    {project.name}
                    <span className="text-xs text-muted-foreground">
                      (
                      {t("workspace:focus.projectTaskCount", {
                        count: project.statistics?.totalTasks ?? 0,
                      })}
                      )
                    </span>
                  </Button>
                );
              })}
              {projects?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("workspace:focus.noProjects")}
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="saved-view-state" className="text-sm font-medium">
                {t("workspace:focus.state")}
              </label>
              <select
                id="saved-view-state"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={state}
                onChange={(event) =>
                  setState(event.target.value as typeof state)
                }
              >
                <option value="active">
                  {t("workspace:focus.stateActive")}
                </option>
                <option value="final">{t("workspace:focus.stateFinal")}</option>
                <option value="any">{t("workspace:focus.stateAny")}</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="saved-view-due" className="text-sm font-medium">
                {t("workspace:focus.due")}
              </label>
              <select
                id="saved-view-due"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={due}
                onChange={(event) => setDue(event.target.value as typeof due)}
              >
                <option value="any">{t("workspace:focus.dueAny")}</option>
                <option value="overdue">
                  {t("workspace:focus.dueOverdue")}
                </option>
                <option value="today">{t("workspace:focus.dueToday")}</option>
                <option value="next-7-days">
                  {t("workspace:focus.dueNext7Days")}
                </option>
                <option value="next-30-days">
                  {t("workspace:focus.dueNext30Days")}
                </option>
                <option value="no-due-date">
                  {t("workspace:focus.dueNoDate")}
                </option>
              </select>
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t("workspace:focus.priorities")}
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(
                ["urgent", "high", "medium", "low", "no-priority"] as const
              ).map((priority) => (
                <label
                  key={priority}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <input
                    type="checkbox"
                    checked={priorities.includes(priority)}
                    onChange={() => toggleValue(setPriorities, priority)}
                  />
                  {priorityLabel(priority)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t("workspace:focus.assignees")}
            </legend>
            <div className="grid max-h-28 gap-2 overflow-y-auto sm:grid-cols-2">
              {(workspaceUsers?.members ?? []).map((member) => {
                const memberId = member.userId;
                if (!memberId) return null;
                return (
                  <label
                    key={memberId}
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={assigneeIds.includes(memberId)}
                      onChange={() => toggleValue(setAssigneeIds, memberId)}
                    />
                    {member.user?.name ?? memberId}
                  </label>
                );
              })}
              {(workspaceUsers?.members ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("workspace:focus.noMembers")}
                </p>
              )}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t("workspace:focus.labels")}
            </legend>
            <div className="grid max-h-28 gap-2 overflow-y-auto sm:grid-cols-2">
              {workspaceLabels.map((label) => (
                <label
                  key={label.id}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <input
                    type="checkbox"
                    checked={labelIds.includes(label.id)}
                    onChange={() => toggleValue(setLabelIds, label.id)}
                  />
                  {label.name}
                </label>
              ))}
              {workspaceLabels.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("workspace:focus.noLabels")}
                </p>
              )}
            </div>
          </fieldset>
          <div
            className="rounded-md border bg-muted/20 p-3 text-sm"
            aria-live="polite"
            data-kaneo-focus-preview=""
          >
            <p className="font-medium">{t("workspace:focus.preview")}</p>
            {previewLoading ? (
              <p className="mt-1 text-muted-foreground">
                {t("workspace:focus.previewLoading")}
              </p>
            ) : previewError ? (
              <p className="mt-1 text-muted-foreground" role="alert">
                {t("workspace:focus.previewError")}
              </p>
            ) : previewData?.items.length === 0 ? (
              <p className="mt-1 text-muted-foreground">
                {t("workspace:focus.previewEmpty")}
              </p>
            ) : previewData ? (
              <>
                <p className="mt-1 text-muted-foreground">
                  {t("workspace:focus.previewCount", {
                    count: previewData.nextCursor
                      ? `first ${previewData.items.length}`
                      : previewData.items.length,
                  })}
                </p>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {previewData.items.slice(0, 5).map((task) => (
                    <li key={task.id} className="truncate">
                      {task.shortId} · {task.title}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <div className="space-y-2">
            <label htmlFor="saved-view-text" className="text-sm font-medium">
              {t("workspace:focus.textFilter")}
            </label>
            <Input
              id="saved-view-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("workspace:focus.textPlaceholder")}
              maxLength={200}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose}>
              {t("workspace:focus.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                isPending || !name.trim() || selectedProjectIds.length === 0
              }
            >
              {t("workspace:focus.createButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateSavedViewModal;
