import { client } from "@kaneo/libs";

export class SavedViewRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(body || `Saved view request failed with status ${status}`);
    this.name = "SavedViewRequestError";
  }
}

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
  if (!response.ok) {
    throw new SavedViewRequestError(response.status, await response.text());
  }
  return response.json();
}

export default getSavedViewTasks;
