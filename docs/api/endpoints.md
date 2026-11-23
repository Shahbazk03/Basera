# API endpoint index

Generated from the live OpenAPI document (Estate Platform API 1.0) — do not edit by hand.
Run `node infrastructure/scripts/generate-api-docs.mjs` after changing controllers. Interactive documentation: `/api/docs`.

Unless marked **public**, every endpoint requires an authenticated session and the permissions documented in the controller.

## Account

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/me/favourites` | authenticated |
| POST | `/api/v1/me/favourites/{propertyId}` | authenticated |
| DELETE | `/api/v1/me/favourites/{propertyId}` | authenticated |

## Administration — users & roles

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/admin/permissions` | authenticated |
| GET | `/api/v1/admin/roles` | authenticated |
| POST | `/api/v1/admin/roles` | authenticated |
| GET | `/api/v1/admin/roles/{id}` | authenticated |
| PATCH | `/api/v1/admin/roles/{id}` | authenticated |
| DELETE | `/api/v1/admin/roles/{id}` | authenticated |
| GET | `/api/v1/admin/users` | authenticated |
| GET | `/api/v1/admin/users/{id}` | authenticated |
| PATCH | `/api/v1/admin/users/{id}` | authenticated |
| POST | `/api/v1/admin/users/{id}/password` | authenticated |
| POST | `/api/v1/admin/users/{id}/password-reset` | authenticated |
| POST | `/api/v1/admin/users/{id}/roles` | authenticated |
| DELETE | `/api/v1/admin/users/{id}/roles/{grantId}` | authenticated |
| PATCH | `/api/v1/admin/users/{id}/status` | authenticated |

## Auth

| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/v1/auth/change-password` | authenticated |
| POST | `/api/v1/auth/forgot-password` | public |
| POST | `/api/v1/auth/login` | public |
| POST | `/api/v1/auth/logout` | public |
| GET | `/api/v1/auth/me` | authenticated |
| PATCH | `/api/v1/auth/me` | authenticated |
| POST | `/api/v1/auth/refresh` | public |
| POST | `/api/v1/auth/register` | public |
| POST | `/api/v1/auth/register/lead-provider` | public |
| POST | `/api/v1/auth/register/partner` | public |
| POST | `/api/v1/auth/resend-verification` | authenticated |
| POST | `/api/v1/auth/reset-password` | public |
| GET | `/api/v1/auth/sessions` | authenticated |
| DELETE | `/api/v1/auth/sessions/{id}` | authenticated |
| POST | `/api/v1/auth/verify-email` | public |

## CMS — administration

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/cms/banners` | authenticated |
| POST | `/api/v1/cms/banners` | authenticated |
| PATCH | `/api/v1/cms/banners/{id}` | authenticated |
| DELETE | `/api/v1/cms/banners/{id}` | authenticated |
| GET | `/api/v1/cms/faqs` | authenticated |
| POST | `/api/v1/cms/faqs` | authenticated |
| PATCH | `/api/v1/cms/faqs/{id}` | authenticated |
| DELETE | `/api/v1/cms/faqs/{id}` | authenticated |
| GET | `/api/v1/cms/home-sections` | authenticated |
| POST | `/api/v1/cms/home-sections` | authenticated |
| PATCH | `/api/v1/cms/home-sections/{id}` | authenticated |
| DELETE | `/api/v1/cms/home-sections/{id}` | authenticated |
| PUT | `/api/v1/cms/home-sections/order` | authenticated |
| GET | `/api/v1/cms/pages` | authenticated |
| POST | `/api/v1/cms/pages` | authenticated |
| GET | `/api/v1/cms/pages/{id}` | authenticated |
| PATCH | `/api/v1/cms/pages/{id}` | authenticated |
| DELETE | `/api/v1/cms/pages/{id}` | authenticated |
| GET | `/api/v1/cms/seo` | authenticated |
| POST | `/api/v1/cms/seo` | authenticated |
| PATCH | `/api/v1/cms/seo/{id}` | authenticated |
| DELETE | `/api/v1/cms/seo/{id}` | authenticated |

## CMS — public

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/public/banners` | public |
| GET | `/api/v1/public/faqs` | public |
| GET | `/api/v1/public/pages` | public |
| GET | `/api/v1/public/pages/{slug}` | public |
| GET | `/api/v1/public/seo` | public |
| GET | `/api/v1/public/sitemap-data` | public |

## CRM — customers

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/crm/customers` | authenticated |
| GET | `/api/v1/crm/customers/{id}` | authenticated |
| PATCH | `/api/v1/crm/customers/{id}` | authenticated |
| POST | `/api/v1/crm/customers/{id}/preferences` | authenticated |
| DELETE | `/api/v1/crm/customers/{id}/preferences/{prefId}` | authenticated |

## CRM — deals

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/crm/deals` | authenticated |
| POST | `/api/v1/crm/deals` | authenticated |
| GET | `/api/v1/crm/deals/{id}` | authenticated |
| POST | `/api/v1/crm/deals/{id}/payments` | authenticated |
| DELETE | `/api/v1/crm/deals/{id}/payments/{paymentId}` | authenticated |
| POST | `/api/v1/crm/deals/{id}/status` | authenticated |

## CRM — follow-ups

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/crm/follow-ups` | authenticated |
| POST | `/api/v1/crm/follow-ups/{id}/complete` | authenticated |
| POST | `/api/v1/crm/follow-ups/{id}/reschedule` | authenticated |
| POST | `/api/v1/crm/follow-ups/run-reminders` | authenticated |

## CRM — leads

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/crm/leads` | authenticated |
| POST | `/api/v1/crm/leads` | authenticated |
| GET | `/api/v1/crm/leads/{id}` | authenticated |
| PATCH | `/api/v1/crm/leads/{id}` | authenticated |
| POST | `/api/v1/crm/leads/{id}/activities` | authenticated |
| POST | `/api/v1/crm/leads/{id}/assign` | authenticated |
| POST | `/api/v1/crm/leads/{id}/follow-ups` | authenticated |
| POST | `/api/v1/crm/leads/{id}/status` | authenticated |
| POST | `/api/v1/crm/leads/bulk-assign` | authenticated |
| GET | `/api/v1/crm/leads/export` | authenticated |
| POST | `/api/v1/crm/leads/import` | authenticated |

## CRM — routing

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/crm/assignees` | authenticated |
| GET | `/api/v1/crm/campaigns` | authenticated |
| POST | `/api/v1/crm/campaigns` | authenticated |
| PATCH | `/api/v1/crm/campaigns/{id}` | authenticated |
| GET | `/api/v1/crm/campaigns/options` | authenticated |
| GET | `/api/v1/crm/lead-sources` | authenticated |
| POST | `/api/v1/crm/lead-sources` | authenticated |
| PATCH | `/api/v1/crm/lead-sources/{id}` | authenticated |
| POST | `/api/v1/crm/routing/test` | authenticated |
| GET | `/api/v1/crm/rules` | authenticated |
| POST | `/api/v1/crm/rules` | authenticated |
| PATCH | `/api/v1/crm/rules/{id}` | authenticated |
| DELETE | `/api/v1/crm/rules/{id}` | authenticated |
| POST | `/api/v1/crm/rules/reorder` | authenticated |
| GET | `/api/v1/crm/teams` | authenticated |
| POST | `/api/v1/crm/teams` | authenticated |
| PATCH | `/api/v1/crm/teams/{id}` | authenticated |
| POST | `/api/v1/crm/teams/{id}/members` | authenticated |
| DELETE | `/api/v1/crm/teams/{id}/members/{userId}` | authenticated |

## CRM — site visits

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/crm/site-visits` | authenticated |
| POST | `/api/v1/crm/site-visits` | authenticated |
| PATCH | `/api/v1/crm/site-visits/{id}` | authenticated |

## Commissions

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/commissions` | authenticated |
| POST | `/api/v1/commissions` | authenticated |
| POST | `/api/v1/commissions/{id}/status` | authenticated |
| GET | `/api/v1/commissions/deals` | authenticated |
| POST | `/api/v1/commissions/deals/{dealId}/generate` | authenticated |
| POST | `/api/v1/commissions/pay-via-payroll` | authenticated |
| GET | `/api/v1/commissions/payouts` | authenticated |
| POST | `/api/v1/commissions/payouts` | authenticated |
| POST | `/api/v1/commissions/payouts/{id}/cancel` | authenticated |
| POST | `/api/v1/commissions/payouts/{id}/pay` | authenticated |
| GET | `/api/v1/commissions/rules` | authenticated |
| POST | `/api/v1/commissions/rules` | authenticated |
| PATCH | `/api/v1/commissions/rules/{id}` | authenticated |
| GET | `/api/v1/commissions/statement` | authenticated |

## Enquiries

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/crm/enquiries` | authenticated |
| PATCH | `/api/v1/crm/enquiries/{id}/status` | authenticated |
| GET | `/api/v1/me/enquiries` | authenticated |
| POST | `/api/v1/public/enquiries` | public |

## Files

| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/v1/files` | authenticated |
| GET | `/api/v1/files/{id}/download` | public |
| GET | `/api/v1/files/{id}/url` | public |

## Finance

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/finance/expense-categories` | authenticated |
| POST | `/api/v1/finance/expense-categories` | authenticated |
| PATCH | `/api/v1/finance/expense-categories/{id}` | authenticated |
| GET | `/api/v1/finance/expenses` | authenticated |
| POST | `/api/v1/finance/expenses` | authenticated |
| POST | `/api/v1/finance/expenses/{id}/decision` | authenticated |
| POST | `/api/v1/finance/expenses/{id}/pay` | authenticated |
| GET | `/api/v1/finance/invoices` | authenticated |
| POST | `/api/v1/finance/invoices` | authenticated |
| GET | `/api/v1/finance/invoices/{id}` | authenticated |
| PATCH | `/api/v1/finance/invoices/{id}` | authenticated |
| POST | `/api/v1/finance/invoices/{id}/cancel` | authenticated |
| POST | `/api/v1/finance/invoices/{id}/issue` | authenticated |
| POST | `/api/v1/finance/invoices/{id}/payments` | authenticated |
| GET | `/api/v1/finance/reimbursements` | authenticated |
| POST | `/api/v1/finance/reimbursements/{id}/decision` | authenticated |
| POST | `/api/v1/finance/reimbursements/{id}/pay` | authenticated |
| GET | `/api/v1/finance/reports/monthly` | authenticated |
| GET | `/api/v1/finance/reports/monthly/export` | authenticated |
| GET | `/api/v1/finance/transactions` | authenticated |
| POST | `/api/v1/finance/transactions` | authenticated |
| GET | `/api/v1/finance/transactions/export` | authenticated |

## Finance — self service

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/me/reimbursements` | authenticated |
| POST | `/api/v1/me/reimbursements` | authenticated |
| DELETE | `/api/v1/me/reimbursements/{id}` | authenticated |

## HR — attendance, leave & tasks

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/hr/attendance/board` | authenticated |
| POST | `/api/v1/hr/attendance/check-in` | authenticated |
| POST | `/api/v1/hr/attendance/check-out` | authenticated |
| GET | `/api/v1/hr/attendance/corrections` | authenticated |
| POST | `/api/v1/hr/attendance/corrections` | authenticated |
| POST | `/api/v1/hr/attendance/corrections/{id}/cancel` | authenticated |
| POST | `/api/v1/hr/attendance/corrections/{id}/decision` | authenticated |
| GET | `/api/v1/hr/attendance/employees/{employeeId}` | authenticated |
| PUT | `/api/v1/hr/attendance/manual` | authenticated |
| GET | `/api/v1/hr/attendance/me` | authenticated |
| GET | `/api/v1/hr/attendance/me/today` | authenticated |
| GET | `/api/v1/hr/attendance/report` | authenticated |
| GET | `/api/v1/hr/holidays` | authenticated |
| POST | `/api/v1/hr/holidays` | authenticated |
| DELETE | `/api/v1/hr/holidays/{id}` | authenticated |
| GET | `/api/v1/hr/leave/balances` | authenticated |
| PUT | `/api/v1/hr/leave/balances` | authenticated |
| POST | `/api/v1/hr/leave/balances/allocate-year` | authenticated |
| GET | `/api/v1/hr/leave/balances/me` | authenticated |
| GET | `/api/v1/hr/leave/calendar` | authenticated |
| GET | `/api/v1/hr/leave/my-calendar` | authenticated |
| GET | `/api/v1/hr/leave/requests` | authenticated |
| POST | `/api/v1/hr/leave/requests` | authenticated |
| POST | `/api/v1/hr/leave/requests/{id}/cancel` | authenticated |
| POST | `/api/v1/hr/leave/requests/{id}/decision` | authenticated |
| GET | `/api/v1/hr/leave/types` | authenticated |
| POST | `/api/v1/hr/leave/types` | authenticated |
| PATCH | `/api/v1/hr/leave/types/{id}` | authenticated |
| GET | `/api/v1/hr/shifts` | authenticated |
| POST | `/api/v1/hr/shifts` | authenticated |
| PATCH | `/api/v1/hr/shifts/{id}` | authenticated |
| GET | `/api/v1/hr/tasks` | authenticated |
| POST | `/api/v1/hr/tasks` | authenticated |
| PATCH | `/api/v1/hr/tasks/{id}` | authenticated |

## HR — employees

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/hr/departments` | authenticated |
| POST | `/api/v1/hr/departments` | authenticated |
| PATCH | `/api/v1/hr/departments/{id}` | authenticated |
| GET | `/api/v1/hr/designations` | authenticated |
| POST | `/api/v1/hr/designations` | authenticated |
| PATCH | `/api/v1/hr/designations/{id}` | authenticated |
| GET | `/api/v1/hr/employees` | authenticated |
| POST | `/api/v1/hr/employees` | authenticated |
| GET | `/api/v1/hr/employees/{id}` | authenticated |
| PATCH | `/api/v1/hr/employees/{id}` | authenticated |
| POST | `/api/v1/hr/employees/{id}/documents` | authenticated |
| DELETE | `/api/v1/hr/employees/{id}/documents/{docId}` | authenticated |
| POST | `/api/v1/hr/employees/{id}/exit` | authenticated |
| PUT | `/api/v1/hr/employees/{id}/sensitive` | authenticated |
| POST | `/api/v1/hr/employees/{id}/sensitive/reveal` | authenticated |
| GET | `/api/v1/hr/employees/assignable-roles` | authenticated |
| GET | `/api/v1/hr/employees/options` | authenticated |
| GET | `/api/v1/hr/org-chart` | authenticated |

## Lead providers — admin

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/crm/lead-providers` | authenticated |
| GET | `/api/v1/crm/lead-providers/{id}` | authenticated |
| PATCH | `/api/v1/crm/lead-providers/{id}` | authenticated |
| GET | `/api/v1/crm/lead-providers/review` | authenticated |
| POST | `/api/v1/crm/lead-providers/review/{leadId}` | authenticated |

## Lead providers — partner portal

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/provider/leads` | authenticated |
| POST | `/api/v1/provider/leads` | authenticated |
| POST | `/api/v1/provider/leads/import` | authenticated |
| GET | `/api/v1/provider/profile` | authenticated |
| GET | `/api/v1/provider/stats` | authenticated |

## Locations & catalogue

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/admin/amenities` | authenticated |
| POST | `/api/v1/admin/amenities` | authenticated |
| PATCH | `/api/v1/admin/amenities/{id}` | authenticated |
| DELETE | `/api/v1/admin/amenities/{id}` | authenticated |
| GET | `/api/v1/admin/cities` | authenticated |
| POST | `/api/v1/admin/cities` | authenticated |
| PATCH | `/api/v1/admin/cities/{id}` | authenticated |
| GET | `/api/v1/admin/localities` | authenticated |
| POST | `/api/v1/admin/localities` | authenticated |
| PATCH | `/api/v1/admin/localities/{id}` | authenticated |
| GET | `/api/v1/admin/property-types` | authenticated |
| POST | `/api/v1/admin/property-types` | authenticated |
| PATCH | `/api/v1/admin/property-types/{id}` | authenticated |
| GET | `/api/v1/admin/states` | authenticated |
| POST | `/api/v1/admin/states` | authenticated |
| GET | `/api/v1/public/amenities` | public |
| GET | `/api/v1/public/cities` | public |
| GET | `/api/v1/public/cities/{slug}/localities` | public |
| GET | `/api/v1/public/locations/suggest` | public |
| GET | `/api/v1/public/property-types` | public |

## Notifications

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/notifications` | authenticated |
| POST | `/api/v1/notifications/{id}/read` | authenticated |
| GET | `/api/v1/notifications/admin/integrations` | authenticated |
| GET | `/api/v1/notifications/admin/logs` | authenticated |
| POST | `/api/v1/notifications/admin/logs/{id}/retry` | authenticated |
| GET | `/api/v1/notifications/admin/templates` | authenticated |
| PUT | `/api/v1/notifications/admin/templates` | authenticated |
| POST | `/api/v1/notifications/read-all` | authenticated |
| GET | `/api/v1/notifications/unread-count` | authenticated |

## Organisation — self service

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/organizations/{orgId}` | authenticated |
| PATCH | `/api/v1/organizations/{orgId}` | authenticated |
| PUT | `/api/v1/organizations/{orgId}/broker-profile` | authenticated |
| PUT | `/api/v1/organizations/{orgId}/developer-profile` | authenticated |
| GET | `/api/v1/organizations/{orgId}/documents` | authenticated |
| POST | `/api/v1/organizations/{orgId}/documents` | authenticated |
| DELETE | `/api/v1/organizations/{orgId}/documents/{docId}` | authenticated |
| GET | `/api/v1/organizations/{orgId}/members` | authenticated |
| POST | `/api/v1/organizations/{orgId}/members` | authenticated |
| PATCH | `/api/v1/organizations/{orgId}/members/{userId}` | authenticated |
| DELETE | `/api/v1/organizations/{orgId}/members/{userId}` | authenticated |
| POST | `/api/v1/organizations/{orgId}/resubmit` | authenticated |
| GET | `/api/v1/organizations/{orgId}/subscription` | authenticated |

## Partners — administration

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/partners` | authenticated |
| GET | `/api/v1/partners/{id}` | authenticated |
| POST | `/api/v1/partners/{id}/decision` | authenticated |
| POST | `/api/v1/partners/{id}/documents/{docId}/review` | authenticated |
| PUT | `/api/v1/partners/{id}/publish-mode` | authenticated |
| POST | `/api/v1/partners/{id}/subscriptions` | authenticated |
| GET | `/api/v1/partners/plans` | authenticated |
| POST | `/api/v1/partners/plans` | authenticated |
| PATCH | `/api/v1/partners/plans/{id}` | authenticated |
| POST | `/api/v1/partners/subscriptions/{subId}/activate` | authenticated |
| POST | `/api/v1/partners/subscriptions/{subId}/cancel` | authenticated |

## Payroll

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/payroll/adjustments` | authenticated |
| POST | `/api/v1/payroll/adjustments` | authenticated |
| POST | `/api/v1/payroll/adjustments/{id}/cancel` | authenticated |
| GET | `/api/v1/payroll/components` | authenticated |
| POST | `/api/v1/payroll/components` | authenticated |
| PATCH | `/api/v1/payroll/components/{id}` | authenticated |
| GET | `/api/v1/payroll/me/payslips` | authenticated |
| GET | `/api/v1/payroll/payslips/{id}` | authenticated |
| GET | `/api/v1/payroll/runs` | authenticated |
| POST | `/api/v1/payroll/runs` | authenticated |
| GET | `/api/v1/payroll/runs/{id}` | authenticated |
| POST | `/api/v1/payroll/runs/{id}/approve` | authenticated |
| POST | `/api/v1/payroll/runs/{id}/calculate` | authenticated |
| POST | `/api/v1/payroll/runs/{id}/cancel` | authenticated |
| POST | `/api/v1/payroll/runs/{id}/payments` | authenticated |
| GET | `/api/v1/payroll/structures` | authenticated |
| GET | `/api/v1/payroll/structures/{employeeId}` | authenticated |
| POST | `/api/v1/payroll/structures/{employeeId}` | authenticated |

## Projects — domains

| Method | Path | Access |
| --- | --- | --- |
| DELETE | `/api/v1/project-domains/{domainId}` | authenticated |
| POST | `/api/v1/project-domains/{domainId}/check-ssl` | authenticated |
| POST | `/api/v1/project-domains/{domainId}/disable` | authenticated |
| POST | `/api/v1/project-domains/{domainId}/enable` | authenticated |
| POST | `/api/v1/project-domains/{domainId}/primary` | authenticated |
| POST | `/api/v1/project-domains/{domainId}/verify` | authenticated |
| GET | `/api/v1/projects/{id}/domains` | authenticated |
| POST | `/api/v1/projects/{id}/domains` | authenticated |
| GET | `/api/v1/public/domains/resolve` | public |
| GET | `/api/v1/public/domains/tls-check` | public |

## Projects — inventory

| Method | Path | Access |
| --- | --- | --- |
| PATCH | `/api/v1/project-units/{unitId}` | authenticated |
| DELETE | `/api/v1/project-units/{unitId}` | authenticated |
| GET | `/api/v1/project-units/{unitId}/history` | authenticated |
| POST | `/api/v1/project-units/{unitId}/release` | authenticated |
| POST | `/api/v1/project-units/{unitId}/reserve` | authenticated |
| POST | `/api/v1/project-units/{unitId}/status` | authenticated |
| GET | `/api/v1/projects/{id}/blocks` | authenticated |
| POST | `/api/v1/projects/{id}/blocks` | authenticated |
| PATCH | `/api/v1/projects/{id}/blocks/{blockId}` | authenticated |
| DELETE | `/api/v1/projects/{id}/blocks/{blockId}` | authenticated |
| GET | `/api/v1/projects/{id}/inventory/summary` | authenticated |
| GET | `/api/v1/projects/{id}/units` | authenticated |
| POST | `/api/v1/projects/{id}/units` | authenticated |
| POST | `/api/v1/projects/{id}/units/bulk` | authenticated |

## Projects — manage

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/projects` | authenticated |
| POST | `/api/v1/projects` | authenticated |
| GET | `/api/v1/projects/{id}` | authenticated |
| PATCH | `/api/v1/projects/{id}` | authenticated |
| DELETE | `/api/v1/projects/{id}` | authenticated |
| POST | `/api/v1/projects/{id}/construction-updates` | authenticated |
| PATCH | `/api/v1/projects/{id}/construction-updates/{itemId}` | authenticated |
| DELETE | `/api/v1/projects/{id}/construction-updates/{itemId}` | authenticated |
| POST | `/api/v1/projects/{id}/documents` | authenticated |
| PATCH | `/api/v1/projects/{id}/documents/{docId}` | authenticated |
| DELETE | `/api/v1/projects/{id}/documents/{docId}` | authenticated |
| POST | `/api/v1/projects/{id}/faqs` | authenticated |
| PATCH | `/api/v1/projects/{id}/faqs/{itemId}` | authenticated |
| DELETE | `/api/v1/projects/{id}/faqs/{itemId}` | authenticated |
| POST | `/api/v1/projects/{id}/feature` | authenticated |
| GET | `/api/v1/projects/{id}/history` | authenticated |
| PUT | `/api/v1/projects/{id}/media` | authenticated |
| POST | `/api/v1/projects/{id}/nearby` | authenticated |
| PATCH | `/api/v1/projects/{id}/nearby/{itemId}` | authenticated |
| DELETE | `/api/v1/projects/{id}/nearby/{itemId}` | authenticated |
| POST | `/api/v1/projects/{id}/publish` | authenticated |
| POST | `/api/v1/projects/{id}/review/decision` | authenticated |
| POST | `/api/v1/projects/{id}/review/submit` | authenticated |
| POST | `/api/v1/projects/{id}/status` | authenticated |
| POST | `/api/v1/projects/{id}/team` | authenticated |
| PATCH | `/api/v1/projects/{id}/team/{memberId}` | authenticated |
| DELETE | `/api/v1/projects/{id}/team/{memberId}` | authenticated |
| GET | `/api/v1/projects/{id}/team/candidates` | authenticated |
| POST | `/api/v1/projects/{id}/unpublish` | authenticated |
| POST | `/api/v1/projects/jobs/sync-status` | authenticated |
| GET | `/api/v1/projects/options/developers` | authenticated |

## Projects — page builder

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/projects/{id}/page` | authenticated |
| PUT | `/api/v1/projects/{id}/page/draft` | authenticated |
| POST | `/api/v1/projects/{id}/page/preview-token` | authenticated |
| POST | `/api/v1/projects/{id}/page/publish` | authenticated |
| GET | `/api/v1/projects/{id}/page/revisions` | authenticated |
| POST | `/api/v1/projects/{id}/page/revisions/{revision}/restore` | authenticated |

## Projects — public

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/public/projects` | public |
| GET | `/api/v1/public/projects/{slug}` | public |
| GET | `/api/v1/public/projects/{slug}/documents/{docId}/url` | public |
| GET | `/api/v1/public/projects/{slug}/related` | public |

## Properties — manage

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/properties` | authenticated |
| POST | `/api/v1/properties` | authenticated |
| GET | `/api/v1/properties/{id}` | authenticated |
| PATCH | `/api/v1/properties/{id}` | authenticated |
| DELETE | `/api/v1/properties/{id}` | authenticated |
| PATCH | `/api/v1/properties/{id}/availability` | authenticated |
| POST | `/api/v1/properties/{id}/documents` | authenticated |
| DELETE | `/api/v1/properties/{id}/documents/{docId}` | authenticated |
| POST | `/api/v1/properties/{id}/feature` | authenticated |
| PUT | `/api/v1/properties/{id}/media` | authenticated |
| POST | `/api/v1/properties/{id}/transition` | authenticated |
| POST | `/api/v1/properties/{id}/verification` | authenticated |

## Properties — public

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/public/properties` | public |
| POST | `/api/v1/public/properties/{id}/report` | public |
| GET | `/api/v1/public/properties/{slug}` | public |
| GET | `/api/v1/public/properties/{slug}/similar` | public |

## Properties — reports

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/admin/property-reports` | authenticated |
| POST | `/api/v1/admin/property-reports/{id}/resolve` | authenticated |

## Public — home

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/public/home` | public |
| GET | `/api/v1/public/home/categories` | public |

## Reports & dashboards

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/reports/dashboard` | authenticated |
| GET | `/api/v1/reports/lead-sources` | authenticated |
| GET | `/api/v1/reports/listings` | authenticated |
| GET | `/api/v1/reports/projects` | authenticated |
| GET | `/api/v1/reports/team` | authenticated |

## System

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/admin/audit-logs` | authenticated |
| GET | `/api/v1/admin/feature-flags` | authenticated |
| PUT | `/api/v1/admin/feature-flags/{key}` | authenticated |
| GET | `/api/v1/admin/settings` | authenticated |
| PUT | `/api/v1/admin/settings/{key}` | authenticated |
| GET | `/api/v1/health` | public |
| GET | `/api/v1/health/ready` | public |
| GET | `/api/v1/public/settings` | public |

