import { useMutation } from "@tanstack/react-query";
import createSavedView, {
  type CreateSavedViewRequest,
} from "@/fetchers/saved-view/create-saved-view";

function useCreateSavedView() {
  return useMutation({
    mutationFn: ({
      workspaceId,
      input,
    }: {
      workspaceId: string;
      input: CreateSavedViewRequest;
    }) => createSavedView({ workspaceId, input }),
  });
}

export default useCreateSavedView;
