import { useQuery } from "@tanstack/react-query";
import getSavedView from "@/fetchers/saved-view/get-saved-view";

function useGetSavedView(viewId: string) {
  return useQuery({
    enabled: Boolean(viewId),
    queryKey: ["saved-view", viewId],
    queryFn: () => getSavedView({ viewId }),
  });
}

export default useGetSavedView;
