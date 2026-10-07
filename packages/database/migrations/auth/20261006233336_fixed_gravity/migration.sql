CREATE TABLE "auth"."enrollment_audit" (
	"id" uuid PRIMARY KEY,
	"action" text NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."mfa_assurance" (
	"session_id" uuid PRIMARY KEY,
	"verified_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."mfa_assurance" ADD CONSTRAINT "mfa_assurance_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."session"("id") ON DELETE CASCADE;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "auth"."enrollment_audit" FROM pipong_api;
