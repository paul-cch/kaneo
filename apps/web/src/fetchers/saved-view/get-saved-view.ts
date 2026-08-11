import { client } from "@kaneo/libs";

async function getSavedView({ viewId }: { viewId: string }) {
  const response = await client["saved-view"][":viewId"].$get({
    param: { viewId },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export default getSavedView;
