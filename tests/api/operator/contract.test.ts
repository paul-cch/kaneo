import { describe, expect, it } from "vitest";
import {
  matchesTriageConditions,
  parseAttemptInput,
  parseCycleInput,
  parseIntegrationEventInput,
  parseIntegrationInput,
  parseOutboxInput,
  parseProjectOperatorInput,
  parseProposalInput,
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

  it("requires a linked source and explicit proposal evidence", () => {
    expect(
      parseProposalInput({
        source: "https://example.invalid/agent/1",
        ownerUserId: "user-1",
        dedupeKey: "proposal-1",
        evidence: {
          summary: "A bounded operator proposal",
          links: ["https://example.invalid/evidence/1"],
        },
        requestedAction: {
          type: "create-task",
          description: "Ask the operator to review",
          payload: { title: "Review" },
        },
      }),
    ).toMatchObject({ source: "https://example.invalid/agent/1" });
    expect(() =>
      parseProposalInput({
        source: "agent",
        ownerUserId: "user-1",
        dedupeKey: "proposal-2",
        evidence: { summary: "Missing source link" },
        requestedAction: { type: "review" },
      }),
    ).toThrow(/source/);
    expect(() =>
      parseProposalInput({
        source: "https://example.invalid/agent/3",
        ownerUserId: "user-1",
        dedupeKey: "proposal-3",
        evidence: {},
        requestedAction: { type: "review" },
      }),
    ).toThrow(/summary/);
  });

  it("normalizes one-way integration events", () => {
    expect(
      parseIntegrationEventInput({
        externalId: "evt-1",
        externalIdentity: "external-user-1",
        payload: { title: "New" },
        cursor: "2",
      }),
    ).toEqual({
      externalId: "evt-1",
      externalIdentity: "external-user-1",
      payload: { title: "New" },
      cursor: "2",
    });
    expect(parseIntegrationEventInput({ externalId: "evt-2" })).toEqual({
      externalId: "evt-2",
      payload: {},
    });
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
    expect(() =>
      parseIntegrationInput({
        kind: "linear",
        displayName: "Linear mirror",
        config: { oauth: { refreshToken: "redacted" } },
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
