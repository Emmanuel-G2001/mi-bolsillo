CREATE TABLE "auth_rate_limit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"action" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limit_lookup_idx" ON "auth_rate_limit_events" USING btree ("key_hash","action","created_at");