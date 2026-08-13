import { useQuery } from "@tanstack/react-query";
import getSavedViews from "@/fetchers/saved-view/get-saved-views";

function useGetSavedViews(workspaceId: string) {
  return useQuery({
    enabled: Boolean(workspaceId),
    queryKey: ["saved-views", workspaceId],
    queryFn: () => getSavedViews({ workspaceId }),
  });
}

export default useGetSavedViews;
