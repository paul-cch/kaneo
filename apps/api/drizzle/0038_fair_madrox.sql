CREATE TABLE "saved_view" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"filters" jsonb NOT NULL,
	"sort" jsonb NOT NULL,
	"pinned_position" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_view_workspace_owner_idx" ON "saved_view" USING btree ("workspace_id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_view_workspace_owner_name_idx" ON "saved_view" USING btree ("workspace_id","owner_user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "saved_view_pinned_position_idx" ON "saved_view" USING btree ("workspace_id","owner_user_id","pinned_position") WHERE "saved_view"."pinned_position" is not null;