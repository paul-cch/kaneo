import { client } from "@kaneo/libs";

type Request = {
  viewId: string;
  limit?: number;
  cursor?: string;
};

async function getSavedViewTasks({ viewId, limit, cursor }: Request) {
  const response = await client["saved-view"][":viewId"].tasks.$get({
    param: { viewId },
    query: {
      limit: limit?.toString(),
      cursor,
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export default getSavedViewTasks;
