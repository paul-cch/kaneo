import { useQuery } from "@tanstack/react-query";
import getSavedViewTasks from "@/fetchers/saved-view/get-saved-view-tasks";

function useGetSavedViewTasks(viewId: string) {
  return useQuery({
    enabled: Boolean(viewId),
    queryKey: ["saved-view-tasks", viewId],
    queryFn: () => getSavedViewTasks({ viewId, limit: 100 }),
  });
}

export default useGetSavedViewTasks;
