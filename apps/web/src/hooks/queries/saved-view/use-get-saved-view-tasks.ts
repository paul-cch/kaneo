import { useInfiniteQuery } from "@tanstack/react-query";
import getSavedViewTasks from "@/fetchers/saved-view/get-saved-view-tasks";

function useGetSavedViewTasks(viewId: string) {
  return useInfiniteQuery({
    enabled: Boolean(viewId),
    queryKey: ["saved-view-tasks", viewId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getSavedViewTasks({ viewId, limit: 100, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export default useGetSavedViewTasks;
