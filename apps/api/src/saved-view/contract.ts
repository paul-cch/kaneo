import { HTTPException } from "hono/http-exception";

export const SAVED_VIEW_SCHEMA_VERSION = 1 as const;
export const SAVED_VIEW_MAX_PAGE_SIZE = 100;
export const SAVED_VIEW_MAX_NAME_LENGTH = 80;
export const SAVED_VIEW_MAX_TEXT_LENGTH = 200;

export const SAVED_VIEW_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "no-priority",
] as const;

export type SavedViewPriority = (typeof SAVED_VIEW_PRIORITIES)[number];
export type SavedViewState = "active" | "final" | "any";
export type SavedViewDue =
  | "overdue"
  | "today"
  | "next-7-days"
  | "next-30-days"
  | "no-due-date"
  | "any";
export type SavedViewSortField =
  | "priority"
  | "dueDate"
  | "updatedAt"
  | "createdAt"
  | "title"
  | "taskId";
export type SavedViewSortDirection = "asc" | "desc";

export type SavedViewSortTerm = {
  field: SavedViewSortField;
  direction: SavedViewSortDirection;
  nulls?: "first" | "last";
};

export type SavedViewFilterValues = {
  projectIds: string[];
  state: SavedViewState;
  priorities: SavedViewPriority[];
  assigneeIds: string[];
  labelIds: string[];
  due: SavedViewDue;
  text?: string;
};

export type SavedViewFilterDocument = {
  schemaVersion: typeof SAVED_VIEW_SCHEMA_VERSION;
  filters: SavedViewFilterValues;
};

export type SavedViewDefinition = SavedViewFilterDocument & {
  sort: SavedViewSortTerm[];
};

export type SavedViewInput = {
  name: string;
  filters:
    | SavedViewFilterValues
    | (Partial<SavedViewFilterValues> & {
        schemaVersion?: number;
        filters?: Partial<SavedViewFilterValues>;
        sort?: SavedViewSortTerm[];
      });
  sort?: SavedViewSortTerm[];
  pinnedPosition?: number | null;
  updatedAt?: string;
};

export type SavedViewCursor = {
  taskId: string;
  position: number;
};

const DEFAULT_SORT: SavedViewSortTerm[] = [
  { field: "priority", direction: "desc" },
  { field: "dueDate", direction: "asc", nulls: "last" },
  { field: "updatedAt", direction: "desc" },
];

const SORT_FIELDS = new Set<SavedViewSortField>([
  "priority",
  "dueDate",
  "updatedAt",
  "createdAt",
  "title",
  "taskId",
]);

const STATES = new Set<SavedViewState>(["active", "final", "any"]);
const DUE_VALUES = new Set<SavedViewDue>([
  "overdue",
  "today",
  "next-7-days",
  "next-30-days",
  "no-due-date",
  "any",
]);
const PRIORITIES = new Set<string>(SAVED_VIEW_PRIORITIES);

function fail(message: string): never {
  throw new HTTPException(400, { message });
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const values = value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      fail(`${label} must contain non-empty strings`);
    }
    return entry.trim();
  });
  if (new Set(values).size !== values.length) {
    fail(`${label} must not contain duplicates`);
  }
  return values;
}

function sortTerms(value: unknown): SavedViewSortTerm[] {
  const terms = value === undefined ? DEFAULT_SORT : value;
  if (!Array.isArray(terms) || terms.length === 0 || terms.length > 4) {
    fail("sort must contain between 1 and 4 terms");
  }

  const seen = new Set<string>();
  const normalized = terms.map((entry) => {
    const raw = objectValue(entry, "sort term");
    if (
      typeof raw.field !== "string" ||
      !SORT_FIELDS.has(raw.field as SavedViewSortField)
    ) {
      fail("sort contains an unsupported field");
    }
    if (raw.direction !== "asc" && raw.direction !== "desc") {
      fail("sort direction must be asc or desc");
    }
    const key = `${raw.field}:${raw.direction}`;
    if (seen.has(key)) fail("sort must not contain duplicate terms");
    seen.add(key);
    const nulls = raw.nulls;
    if (nulls !== undefined && nulls !== "first" && nulls !== "last") {
      fail("sort nulls must be first or last");
    }
    const nullsValue: "first" | "last" | undefined =
      nulls === "first" || nulls === "last"
        ? (nulls as "first" | "last")
        : undefined;
    return {
      field: raw.field as SavedViewSortField,
      direction: raw.direction as SavedViewSortDirection,
      ...(nullsValue === undefined ? {} : { nulls: nullsValue }),
    };
  });

  if (!normalized.some((term) => term.field === "taskId")) {
    normalized.push({ field: "taskId", direction: "asc" });
  }
  return normalized.slice(0, 4);
}

export function normalizeSavedViewDefinition(
  input: unknown,
): SavedViewDefinition & {
  name: string;
  pinnedPosition: number | null;
} {
  const raw = objectValue(input, "saved view");
  if (typeof raw.name !== "string") fail("name is required");
  const name = raw.name.trim();
  if (name.length === 0 || name.length > SAVED_VIEW_MAX_NAME_LENGTH) {
    fail(`name must be between 1 and ${SAVED_VIEW_MAX_NAME_LENGTH} characters`);
  }

  const filterDocument = objectValue(raw.filters, "filters");
  const nested = filterDocument.filters;
  const values = objectValue(
    nested === undefined ? filterDocument : nested,
    "filters",
  );
  const schemaVersion =
    filterDocument.schemaVersion ?? SAVED_VIEW_SCHEMA_VERSION;
  if (schemaVersion !== SAVED_VIEW_SCHEMA_VERSION) {
    fail(`unsupported saved view schema version: ${String(schemaVersion)}`);
  }

  const projectIds = stringArray(values.projectIds, "projectIds");
  if (projectIds.length === 0)
    fail("projectIds must contain at least one project");

  const state = values.state === undefined ? "active" : values.state;
  if (typeof state !== "string" || !STATES.has(state as SavedViewState)) {
    fail("state must be active, final, or any");
  }
  const due = values.due === undefined ? "any" : values.due;
  if (typeof due !== "string" || !DUE_VALUES.has(due as SavedViewDue)) {
    fail("due contains an unsupported value");
  }

  const priorities = stringArray(values.priorities, "priorities");
  if (priorities.some((priority) => !PRIORITIES.has(priority))) {
    fail("priorities contains an unsupported value");
  }
  const text = values.text;
  if (text !== undefined && typeof text !== "string")
    fail("text must be a string");
  const normalizedText = typeof text === "string" ? text.trim() : undefined;
  if (normalizedText && normalizedText.length > SAVED_VIEW_MAX_TEXT_LENGTH) {
    fail(`text must not exceed ${SAVED_VIEW_MAX_TEXT_LENGTH} characters`);
  }

  const sort = sortTerms(raw.sort ?? filterDocument.sort);
  const pinnedPosition = raw.pinnedPosition;
  if (
    pinnedPosition !== undefined &&
    pinnedPosition !== null &&
    (typeof pinnedPosition !== "number" ||
      !Number.isInteger(pinnedPosition) ||
      pinnedPosition < 0)
  ) {
    fail("pinnedPosition must be a non-negative integer or null");
  }

  return {
    name,
    schemaVersion: SAVED_VIEW_SCHEMA_VERSION,
    filters: {
      projectIds,
      state: state as SavedViewState,
      priorities: priorities as SavedViewPriority[],
      assigneeIds: stringArray(values.assigneeIds, "assigneeIds"),
      labelIds: stringArray(values.labelIds, "labelIds"),
      due: due as SavedViewDue,
      ...(normalizedText ? { text: normalizedText } : {}),
    },
    sort,
    pinnedPosition: pinnedPosition === undefined ? null : pinnedPosition,
  };
}

export function storageDocuments(definition: SavedViewDefinition) {
  return {
    filters: {
      schemaVersion: definition.schemaVersion,
      filters: definition.filters,
    },
    sort: definition.sort,
  };
}

export function encodeSavedViewCursor(cursor: SavedViewCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeSavedViewCursor(
  value: string | undefined,
): SavedViewCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.taskId !== "string" ||
      !Number.isInteger(parsed.position) ||
      parsed.position < 0
    ) {
      throw new Error("invalid cursor");
    }
    return { taskId: parsed.taskId, position: parsed.position };
  } catch {
    throw new HTTPException(400, { message: "Invalid saved view cursor" });
  }
}
