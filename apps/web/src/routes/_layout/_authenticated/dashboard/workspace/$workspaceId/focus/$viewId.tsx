import { createFileRoute } from "@tanstack/react-router";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import useGetSavedViewTasks from "@/hooks/queries/saved-view/use-get-saved-view-tasks";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/focus/$viewId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { viewId } = Route.useParams();
  const { data, isError, isLoading, refetch } = useGetSavedViewTasks(viewId);
  const items = data?.items ?? [];

  return (
    <>
      <PageTitle title="Operator Focus" />
      <WorkspaceLayout title="Operator Focus">
        {isLoading ? (
          <div className="p-6 text-muted-foreground" aria-busy="true">
            Loading focus view…
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 p-6" role="alert">
            <span>Unable to load this focus view.</span>
            <Button variant="outline" size="xs" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="p-6 text-muted-foreground" data-kaneo-empty-state="">
            No tasks match this focus view.
          </div>
        ) : (
          <div className="overflow-x-auto" data-kaneo-focus-results="">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Task</th>
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Priority</th>
                  <th className="px-3 py-2 font-medium">Due</th>
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
                      {task.dueDate
                        ? new Date(task.dueDate).toLocaleDateString()
                        : "—"}
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
