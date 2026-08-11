CREATE TABLE "cycle" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_task" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"task_id" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_task_cycle_task_unique" UNIQUE("cycle_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "operator_identity_map" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"local_user_id" text NOT NULL,
	"external_identity" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "operator_identity_map_integration_external_unique" UNIQUE("integration_id","external_identity"),
	CONSTRAINT "operator_identity_map_integration_local_unique" UNIQUE("integration_id","local_user_id")
);
--> statement-breakpoint
CREATE TABLE "operator_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"config" jsonb NOT NULL,
	"cursor" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "operator_integration_workspace_kind_unique" UNIQUE("workspace_id","kind")
);
--> statement-breakpoint
CREATE TABLE "operator_job_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"outbox_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"error" text,
	CONSTRAINT "operator_job_attempt_outbox_attempt_unique" UNIQUE("outbox_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "operator_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "operator_outbox_workspace_idempotency_unique" UNIQUE("workspace_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "operator_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"requested_action" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "operator_proposal_workspace_dedupe_unique" UNIQUE("workspace_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "project_status_update" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triage_item" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"rule_id" text,
	"source" text DEFAULT 'native' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_action" jsonb NOT NULL,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triage_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "lead_user_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "target_date" timestamp;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "health" text DEFAULT 'on-track' NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_task" ADD CONSTRAINT "cycle_task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_task" ADD CONSTRAINT "cycle_task_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_task" ADD CONSTRAINT "cycle_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_identity_map" ADD CONSTRAINT "operator_identity_map_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_identity_map" ADD CONSTRAINT "operator_identity_map_integration_id_operator_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."operator_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_identity_map" ADD CONSTRAINT "operator_identity_map_local_user_id_user_id_fk" FOREIGN KEY ("local_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_integration" ADD CONSTRAINT "operator_integration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_job_attempt" ADD CONSTRAINT "operator_job_attempt_outbox_id_operator_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."operator_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_outbox" ADD CONSTRAINT "operator_outbox_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_proposal" ADD CONSTRAINT "operator_proposal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_proposal" ADD CONSTRAINT "operator_proposal_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_proposal" ADD CONSTRAINT "operator_proposal_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_update" ADD CONSTRAINT "project_status_update_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_update" ADD CONSTRAINT "project_status_update_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_update" ADD CONSTRAINT "project_status_update_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_item" ADD CONSTRAINT "triage_item_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_item" ADD CONSTRAINT "triage_item_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_item" ADD CONSTRAINT "triage_item_rule_id_triage_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."triage_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rule" ADD CONSTRAINT "triage_rule_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rule" ADD CONSTRAINT "triage_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_workspace_idx" ON "cycle" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "cycle_workspace_dates_idx" ON "cycle" USING btree ("workspace_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "cycle_task_workspace_idx" ON "cycle_task" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "cycle_task_task_idx" ON "cycle_task" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "operator_identity_map_workspace_idx" ON "operator_identity_map" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "operator_integration_workspace_status_idx" ON "operator_integration" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "operator_job_attempt_outbox_idx" ON "operator_job_attempt" USING btree ("outbox_id");--> statement-breakpoint
CREATE INDEX "operator_outbox_status_idx" ON "operator_outbox" USING btree ("workspace_id","status","available_at");--> statement-breakpoint
CREATE INDEX "operator_proposal_workspace_status_idx" ON "operator_proposal" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "project_status_update_workspace_idx" ON "project_status_update" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "project_status_update_project_idx" ON "project_status_update" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "triage_item_workspace_status_idx" ON "triage_item" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "triage_item_task_idx" ON "triage_item" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "triage_rule_workspace_idx" ON "triage_rule" USING btree ("workspace_id","enabled","priority");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_lead_user_id_user_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;