import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SavedViewRequestError } from "@/fetchers/saved-view/get-saved-view-tasks";
import useGetSavedViewTasks from "@/hooks/queries/saved-view/use-get-saved-view-tasks";
import { formatDateMedium } from "@/lib/format";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/focus/$viewId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { viewId } = Route.useParams();
  const { data, error, isError, isLoading, refetch } =
    useGetSavedViewTasks(viewId);
  const items = data?.items ?? [];
  const errorCopy = (() => {
    if (!(error instanceof SavedViewRequestError)) {
      return t("workspace:focus.loadError");
    }
    if ([401, 403, 404].includes(error.status)) {
      return t("workspace:focus.authorizationError");
    }
    if (
      error.status === 409 ||
      error.body.toLowerCase().includes("stale") ||
      error.body.toLowerCase().includes("updatedat")
    ) {
      return t("workspace:focus.staleUpdateError");
    }
    if (error.status === 400 && error.body.toLowerCase().includes("schema")) {
      return t("workspace:focus.invalidFilterError");
    }
    return t("workspace:focus.loadError");
  })();

  return (
    <>
      <PageTitle title={t("workspace:focus.pageTitle")} />
      <WorkspaceLayout title={t("workspace:focus.pageTitle")}>
        {isLoading ? (
          <div className="p-6 text-muted-foreground" aria-busy="true">
            {t("workspace:focus.loading")}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 p-6" role="alert">
            <span>{errorCopy}</span>
            <Button variant="outline" size="xs" onClick={() => refetch()}>
              {t("workspace:focus.retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="p-6 text-muted-foreground" data-kaneo-empty-state="">
            {t("workspace:focus.empty")}
          </div>
        ) : (
          <div className="overflow-x-auto" data-kaneo-focus-results="">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">
                    {t("workspace:focus.task")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("workspace:focus.project")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("workspace:focus.status")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("workspace:focus.priority")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("workspace:focus.assignee")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("workspace:focus.due")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((task) => (
                  <tr key={task.id} className="border-b last:border-0">
                    <td className="px-3 py-3">
                      <a
                        className="font-medium hover:underline"
                        href={task.url}
                      >
                        {task.shortId} · {task.title}
                      </a>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {task.project.name}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="outline">{task.status}</Badge>
                    </td>
                    <td className="px-3 py-3">{task.priority}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {task.assignee?.name ?? t("workspace:focus.unassigned")}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {task.dueDate
                        ? formatDateMedium(task.dueDate)
                        : t("workspace:focus.noDueDate")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WorkspaceLayout>
    </>
  );
}
