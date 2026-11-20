CREATE TABLE "savings_goal_operations" (
	"user_id" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"goal_id" integer NOT NULL,
	"destination_goal_id" integer,
	"amount" numeric(14, 2),
	"reason" varchar(300),
	"economic_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"original_operation_id" uuid,
	"legacy_contribution_id" integer,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "savings_goal_operations_user_id_operation_id_pk" PRIMARY KEY("user_id","operation_id"),
	CONSTRAINT "goal_operations_kind_valid" CHECK ("savings_goal_operations"."kind" IN ('fund','release','transfer','archive','restore','close','reclassify','reverse')),
	CONSTRAINT "goal_operations_amount_valid" CHECK (
    CASE WHEN "savings_goal_operations"."kind" IN ('fund','release','transfer','reclassify')
      THEN "savings_goal_operations"."amount" IS NOT NULL AND "savings_goal_operations"."amount" > 0
      WHEN "savings_goal_operations"."kind" = 'reverse' THEN "savings_goal_operations"."amount" IS NULL OR "savings_goal_operations"."amount" > 0
      ELSE "savings_goal_operations"."amount" IS NULL END),
	CONSTRAINT "goal_operations_destination_valid" CHECK (
    CASE WHEN "savings_goal_operations"."kind" = 'transfer' THEN "savings_goal_operations"."destination_goal_id" IS NOT NULL AND "savings_goal_operations"."destination_goal_id" <> "savings_goal_operations"."goal_id"
      WHEN "savings_goal_operations"."kind" = 'reverse' THEN "savings_goal_operations"."destination_goal_id" IS NULL OR "savings_goal_operations"."destination_goal_id" <> "savings_goal_operations"."goal_id"
      ELSE "savings_goal_operations"."destination_goal_id" IS NULL END),
	CONSTRAINT "goal_operations_original_valid" CHECK (("savings_goal_operations"."kind" = 'reverse') = ("savings_goal_operations"."original_operation_id" IS NOT NULL) AND "savings_goal_operations"."original_operation_id" IS DISTINCT FROM "savings_goal_operations"."operation_id"),
	CONSTRAINT "goal_operations_legacy_valid" CHECK (("savings_goal_operations"."kind" = 'reclassify') = ("savings_goal_operations"."legacy_contribution_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "savings_goals" ADD COLUMN "initial_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "savings_goals" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "savings_contributions" ADD CONSTRAINT "savings_contributions_owner_goal_id_unique" UNIQUE("user_id","goal_id","id");--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_owner_id_unique" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "savings_goal_operations" ADD CONSTRAINT "goal_operations_owner_goal_fk" FOREIGN KEY ("user_id","goal_id") REFERENCES "public"."savings_goals"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal_operations" ADD CONSTRAINT "goal_operations_owner_destination_fk" FOREIGN KEY ("user_id","destination_goal_id") REFERENCES "public"."savings_goals"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal_operations" ADD CONSTRAINT "goal_operations_owner_original_fk" FOREIGN KEY ("user_id","original_operation_id") REFERENCES "public"."savings_goal_operations"("user_id","operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal_operations" ADD CONSTRAINT "goal_operations_owner_legacy_fk" FOREIGN KEY ("user_id","goal_id","legacy_contribution_id") REFERENCES "public"."savings_contributions"("user_id","goal_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_operations_reversal_unique" ON "savings_goal_operations" USING btree ("user_id","original_operation_id") WHERE "savings_goal_operations"."kind" = 'reverse';--> statement-breakpoint
CREATE INDEX "goal_operations_owner_date_idx" ON "savings_goal_operations" USING btree ("user_id","economic_date");--> statement-breakpoint
CREATE INDEX "goal_operations_owner_goal_idx" ON "savings_goal_operations" USING btree ("user_id","goal_id","created_at");--> statement-breakpoint
CREATE INDEX "goal_operations_owner_destination_idx" ON "savings_goal_operations" USING btree ("user_id","destination_goal_id","created_at");--> statement-breakpoint
CREATE INDEX "goal_operations_owner_legacy_idx" ON "savings_goal_operations" USING btree ("user_id","legacy_contribution_id") WHERE "savings_goal_operations"."kind" = 'reclassify';--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_initial_range" CHECK ("savings_goals"."initial_amount" >= 0 AND "savings_goals"."initial_amount" <= "savings_goals"."target_amount");
--> statement-breakpoint
CREATE FUNCTION reject_savings_goal_operation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Savings goal operations are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER savings_goal_operations_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON savings_goal_operations
FOR EACH STATEMENT EXECUTE FUNCTION reject_savings_goal_operation_mutation();
--> statement-breakpoint
CREATE FUNCTION enforce_single_active_goal_reclassification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.savings_contributions
    WHERE user_id = NEW.user_id AND goal_id = NEW.goal_id AND id = NEW.legacy_contribution_id
    FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.savings_goal_operations AS correction
    WHERE correction.user_id = NEW.user_id
      AND correction.legacy_contribution_id = NEW.legacy_contribution_id
      AND correction.kind = 'reclassify'
      AND NOT EXISTS (
        SELECT 1 FROM public.savings_goal_operations AS reversal
        WHERE reversal.user_id = correction.user_id
          AND reversal.original_operation_id = correction.operation_id AND reversal.kind = 'reverse'
      )
  ) THEN
    RAISE EXCEPTION 'Savings contribution already classified' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER savings_goal_operations_active_reclassification
BEFORE INSERT ON savings_goal_operations
FOR EACH ROW WHEN (NEW.kind = 'reclassify')
EXECUTE FUNCTION enforce_single_active_goal_reclassification();
