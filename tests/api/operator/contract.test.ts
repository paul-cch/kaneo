import { describe, expect, it } from "vitest";
import {
  matchesTriageConditions,
  parseAttemptInput,
  parseCycleInput,
  parseIntegrationEventInput,
  parseIntegrationInput,
  parseOutboxInput,
  parseProjectOperatorInput,
  parseTriageAction,
  parseTriageConditions,
  parseTriageRuleInput,
} from "../../../apps/api/src/operator/service";

describe("operator slice contracts", () => {
  it("accepts bounded project health updates and rejects unknown values", () => {
    const parsed = parseProjectOperatorInput({
      leadUserId: null,
      targetDate: "2026-09-01T00:00:00.000Z",
      health: "at-risk",
    });
    expect(parsed.health).toBe("at-risk");
    expect(parsed.targetDate).toBeInstanceOf(Date);
    expect(() => parseProjectOperatorInput({ health: "green" })).toThrow(
      /health/,
    );
  });

  it("requires an explicit, single triage action", () => {
    expect(
      parseTriageAction({ type: "set_priority", value: "urgent" }),
    ).toEqual({
      type: "set_priority",
      value: "urgent",
    });
    expect(() => parseTriageAction({ type: "unknown", value: "x" })).toThrow(
      /type/,
    );
    expect(parseTriageConditions({ priority: ["urgent"] })).toEqual({
      priority: ["urgent"],
    });
    expect(
      matchesTriageConditions(
        {
          status: "to-do",
          priority: "urgent",
          projectId: "p1",
          userId: null,
          title: "Deploy Kaneo",
          labelIds: [],
        },
        { priority: ["urgent"], titleIncludes: "kaneo" },
      ),
    ).toBe(true);
    expect(() =>
      parseTriageRuleInput({
        name: "Route urgent",
        conditions: { priority: "urgent" },
        action: { type: "set_status", value: "triage" },
      }),
    ).not.toThrow();
  });

  it("keeps outbox and attempts explicit and idempotent", () => {
    expect(
      parseOutboxInput({
        eventType: "proposal.created",
        aggregateType: "proposal",
        aggregateId: "p1",
        idempotencyKey: "proposal:p1",
        payload: { source: "native" },
      }).idempotencyKey,
    ).toBe("proposal:p1");
    expect(
      parseOutboxInput({
        eventType: "x",
        aggregateType: "y",
        aggregateId: "z",
        idempotencyKey: "bounded",
      }).maxAttempts,
    ).toBe(3);
    expect(
      parseAttemptInput({ status: "failed", error: "timeout" }).status,
    ).toBe("failed");
    expect(() =>
      parseOutboxInput({
        eventType: "x",
        aggregateType: "y",
        aggregateId: "z",
        idempotencyKey: "k",
        payload: "secret",
      }),
    ).toThrow(/payload/);
  });

  it("normalizes one-way integration events", () => {
    expect(
      parseIntegrationEventInput({
        externalId: "evt-1",
        payload: { title: "New" },
        cursor: "2",
      }),
    ).toEqual({ externalId: "evt-1", payload: { title: "New" }, cursor: "2" });
  });

  it("rejects credentials at the one-way integration boundary", () => {
    expect(
      parseIntegrationInput({
        kind: "linear",
        displayName: "Linear mirror",
        config: { endpoint: "https://example.invalid" },
      }).status,
    ).toBe("disabled");
    expect(() =>
      parseIntegrationInput({
        kind: "linear",
        displayName: "Linear mirror",
        config: { token: "redacted" },
      }),
    ).toThrow(/credentials/);
  });

  it("requires a real cycle window", () => {
    expect(() =>
      parseCycleInput({
        name: "Cycle 1",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-09-08T00:00:00.000Z",
      }),
    ).not.toThrow();
    expect(
      parseCycleInput({
        name: "Cycle 1",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-09-08T00:00:00.000Z",
      }).rolloverPolicy,
    ).toBe("manual");
    expect(() =>
      parseCycleInput({
        name: "Cycle 1",
        startsAt: "2026-09-08T00:00:00.000Z",
        endsAt: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow(/endsAt/);
  });
});
