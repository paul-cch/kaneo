ALTER TABLE "cycle" ADD COLUMN "rollover_policy" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "operator_outbox" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "operator_outbox" ADD COLUMN "replay_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "operator_outbox" ADD CONSTRAINT "operator_outbox_replay_owner_user_id_user_id_fk" FOREIGN KEY ("replay_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;