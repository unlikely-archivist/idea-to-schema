CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"prompt" text NOT NULL,
	"spec_json" jsonb NOT NULL,
	"restored_from" uuid,
	"idempotency_key" text,
	"attempts" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revisions_spec_id_version_unique" UNIQUE("spec_id","version"),
	CONSTRAINT "revisions_spec_id_idempotency_key_unique" UNIQUE("spec_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_spec_id_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."specs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_restored_from_revisions_id_fk" FOREIGN KEY ("restored_from") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;