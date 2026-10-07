ALTER TABLE "auth"."account" RENAME TO "accounts";--> statement-breakpoint
ALTER TABLE "auth"."apikey" RENAME TO "api_keys";--> statement-breakpoint
ALTER TABLE "auth"."enrollment_audit" RENAME TO "enrollment_audits";--> statement-breakpoint
ALTER TABLE "auth"."invitation" RENAME TO "invitations";--> statement-breakpoint
ALTER TABLE "auth"."member" RENAME TO "members";--> statement-breakpoint
ALTER TABLE "auth"."mfa_assurance" RENAME TO "mfa_assurances";--> statement-breakpoint
ALTER TABLE "auth"."organization" RENAME TO "organizations";--> statement-breakpoint
ALTER TABLE "auth"."rate_limit" RENAME TO "rate_limits";--> statement-breakpoint
ALTER TABLE "auth"."session" RENAME TO "sessions";--> statement-breakpoint
ALTER TABLE "auth"."two_factor" RENAME TO "two_factors";--> statement-breakpoint
ALTER TABLE "auth"."user" RENAME TO "users";--> statement-breakpoint
ALTER TABLE "auth"."verification" RENAME TO "verifications";