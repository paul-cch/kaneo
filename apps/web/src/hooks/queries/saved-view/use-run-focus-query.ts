import { useQuery } from "@tanstack/react-query";
import runFocusQuery, {
  type RunFocusQueryRequest,
} from "@/fetchers/saved-view/run-focus-query";

function useRunFocusQuery({
  workspaceId,
  input,
  enabled,
}: {
  workspaceId: string;
  input: RunFocusQueryRequest;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ["focus-query", workspaceId, input],
    queryFn: () => runFocusQuery({ workspaceId, input }),
    enabled,
  });
}

export default useRunFocusQuery;
