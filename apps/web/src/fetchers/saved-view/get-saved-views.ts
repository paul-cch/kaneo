import { client } from "@kaneo/libs";

async function getSavedViews({ workspaceId }: { workspaceId: string }) {
  const response = await client.workspace[":workspaceId"]["saved-views"].$get({
    param: { workspaceId },
    query: {},
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export default getSavedViews;
