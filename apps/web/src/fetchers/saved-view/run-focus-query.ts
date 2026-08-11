import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

const focusQuery = client.workspace[":workspaceId"]["focus-query"];
export type RunFocusQueryRequest = InferRequestType<
  (typeof focusQuery)["$post"]
>["json"];

async function runFocusQuery({
  workspaceId,
  input,
}: {
  workspaceId: string;
  input: RunFocusQueryRequest;
}) {
  const response = await focusQuery.$post({
    param: { workspaceId },
    query: { limit: "10" },
    json: input,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export default runFocusQuery;
