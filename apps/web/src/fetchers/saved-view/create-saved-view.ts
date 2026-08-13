import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

const savedViews = client.workspace[":workspaceId"]["saved-views"];
export type CreateSavedViewRequest = InferRequestType<
  (typeof savedViews)["$post"]
>["json"];

async function createSavedView({
  workspaceId,
  input,
}: {
  workspaceId: string;
  input: CreateSavedViewRequest;
}) {
  const response = await savedViews.$post({
    param: { workspaceId },
    json: input,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export default createSavedView;
