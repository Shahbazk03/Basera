# Database

PostgreSQL 17 with the **PostGIS** and **pg_trgm** extensions. Schema source: `backend/prisma/schema.prisma` (≈90 tables). Migrations: `backend/prisma/migrations` (never edit production tables by hand).

## Conventions

| Topic | Rule |
| --- | --- |
| Keys | UUID v7 (`@default(uuid(7))`) — time-ordered for index locality |
| Naming | snake_case plural tables (`@@map`), camelCase columns (quote them in raw SQL: `"createdAt"`) |
| Money | `numeric(14,2)` INR; calculations in integer paise (`@estate/shared/money`) |
| Areas | `numeric`, plus `areaSqft` normalised for search/sort |
| Time | `timestamptz(3)` for instants; `date` for calendar days (attendance, leave, payroll periods) |
| Deletion | Soft delete (`deletedAt`) for users, organisations, listings, projects, leads, customers, employees |
| Tenancy | `organizationId` on every business record |
| Integrity | Foreign keys everywhere; CHECK constraints for prices, areas, coordinates, booking windows, amounts paid ≤ amount, payroll month |
| Concurrency | `version` columns + conditional updates for unit inventory; status-guarded updates for lifecycles |
| Search | GIN trigram indexes on listing titles, project names, cities and localities; composite B-tree indexes for filters; GiST index on `geography` columns |
| Audit | `audit_logs` (actor, action, entity, before/after JSON with secrets redacted) |

### Custom SQL in migrations
- `estate_sync_location()` trigger keeps `properties.location` and `projects.location` (`geography(Point,4326)`) in sync with latitude/longitude.
- CHECK constraints listed above. `prisma migrate dev` was verified to produce an empty diff with these in place.

### Workflow
```bash
# change schema.prisma, then:
npm run db:migrate -- --name describe_change   # creates + applies a migration in development
npm run db:deploy                               # applies pending migrations (CI / staging / production)
```

## Entity-relationship overview

Core entities and their relationships (attributes trimmed for readability).

```mermaid
erDiagram
  ORGANIZATION ||--o{ ORGANIZATION_MEMBER : has
  USER ||--o{ ORGANIZATION_MEMBER : joins
  USER ||--o{ USER_ROLE : granted
  ROLE ||--o{ USER_ROLE : ""
  ROLE ||--o{ ROLE_PERMISSION : ""
  PERMISSION ||--o{ ROLE_PERMISSION : ""
  ORGANIZATION ||--o{ USER_ROLE : "scopes (optional)"
  USER ||--o{ SESSION : "logs in"

  STATE ||--o{ CITY : ""
  CITY ||--o{ LOCALITY : ""

  ORGANIZATION ||--o{ PROPERTY : lists
  PROPERTY_TYPE ||--o{ PROPERTY : categorises
  LOCALITY ||--o{ PROPERTY : located
  PROPERTY ||--o{ PROPERTY_MEDIA : ""
  PROPERTY ||--o{ PROPERTY_DOCUMENT : ""
  PROPERTY ||--o{ PROPERTY_STATUS_HISTORY : ""
  PROPERTY }o--o{ AMENITY : "property_amenities"

  ORGANIZATION ||--o{ PROJECT : manages
  ORGANIZATION ||--o{ PROJECT : develops
  PROJECT ||--o{ PROJECT_BLOCK : ""
  PROJECT ||--o{ PROJECT_UNIT : inventory
  PROJECT_BLOCK ||--o{ PROJECT_UNIT : ""
  PROJECT_UNIT ||--o{ UNIT_STATUS_HISTORY : ""
  PROJECT_UNIT ||--o{ UNIT_RESERVATION : ""
  PROJECT ||--o{ PROJECT_DOMAIN : "served on"
  PROJECT ||--|| PROJECT_PAGE : "page builder"

  ORGANIZATION ||--o{ CUSTOMER : "CRM of"
  CUSTOMER ||--o{ ENQUIRY : submits
  CUSTOMER ||--o{ LEAD : ""
  ENQUIRY }o--|| LEAD : "creates / attaches"
  LEAD ||--o{ LEAD_ASSIGNMENT : ""
  LEAD ||--o{ LEAD_ACTIVITY : timeline
  LEAD ||--o{ LEAD_FOLLOWUP : ""
  LEAD ||--o{ SITE_VISIT : ""
  LEAD ||--o{ DEAL : converts
  SALES_TEAM ||--o{ SALES_TEAM_MEMBER : ""
  ASSIGNMENT_RULE }o--|| SALES_TEAM : routes
  LEAD_PROVIDER ||--o{ LEAD : submits

  DEAL ||--o{ DEAL_PAYMENT : "customer money"
  DEAL ||--o{ COMMISSION_RECORD : ""
  COMMISSION_RULE ||--o{ COMMISSION_RECORD : ""
  COMMISSION_PAYOUT ||--o{ COMMISSION_PAYOUT_ITEM : ""
  COMMISSION_RECORD ||--o{ COMMISSION_PAYOUT_ITEM : ""

  ORGANIZATION ||--o{ EMPLOYEE : employs
  USER ||--o| EMPLOYEE : ""
  DEPARTMENT ||--o{ EMPLOYEE : ""
  DESIGNATION ||--o{ EMPLOYEE : ""
  EMPLOYEE ||--o{ ATTENDANCE_RECORD : ""
  EMPLOYEE ||--o{ LEAVE_REQUEST : ""
  EMPLOYEE ||--o{ SALARY_STRUCTURE : ""
  SALARY_STRUCTURE ||--o{ SALARY_STRUCTURE_LINE : ""
  SALARY_COMPONENT ||--o{ SALARY_STRUCTURE_LINE : ""
  PAYROLL_RUN ||--o{ PAYSLIP : ""
  PAYSLIP ||--o{ PAYSLIP_LINE : ""
  PAYSLIP ||--o{ SALARY_PAYMENT : ""

  INVOICE ||--o{ INVOICE_LINE : ""
  INVOICE ||--o{ TRANSACTION : receipts
  EXPENSE ||--o{ TRANSACTION : payments
  ORGANIZATION ||--o{ TRANSACTION : ledger
```

## Table map (requested entity → table)

| Requested | Table(s) |
| --- | --- |
| users, sessions | `users`, `sessions`, `verification_tokens` |
| organizations, organization_members | `organizations`, `organization_members` |
| roles, permissions, user_roles | `roles`, `permissions`, `role_permissions`, `user_roles` |
| departments, designations | `departments`, `designations` |
| locations (country/state/city/locality) | `countries`, `states`, `cities`, `localities` (PIN code on locality and listing) |
| broker_profiles, broker_documents, broker_subscriptions | `broker_profiles`, `organization_documents`, `subscription_plans`, `broker_subscriptions` |
| broker_teams | organisation members + `sales_teams` |
| developer_profiles, developer_documents | `developer_profiles`, `organization_documents` |
| properties / property_listings | `properties` (one row per listing; lifecycle in `property_status_history`) |
| property_images, property_documents, property_features | `property_media`, `property_documents`, `property_amenities` + `highlights` |
| property_enquiries / project_enquiries | `enquiries` (one table with property/project/unit references) |
| property_viewings | `site_visits` |
| property_favourites | `property_favourites` |
| projects and children | `projects`, `project_domains`, `project_images`, `project_documents`, `project_amenities`, `project_blocks`, `project_units`, `project_nearby_places`, `project_faqs`, `project_construction_updates`, `project_team_members`, `project_pages`, `project_page_revisions` |
| project_bookings, project_booking_history | `deals` (bookings) and `project_reservations`; `project_booking_history` (unit status history) |
| customers, customer_profiles, customer_preferences | `customers`, `customer_preferences` |
| leads and CRM | `leads`, `lead_sources`, `lead_providers`, `lead_assignments`, `lead_assignment_rules`, `sales_teams`, `sales_team_members`, `lead_activities`, `lead_followups`, `campaigns`, `deal_payments` |
| employees and HR | `employees`, `employee_documents`, `attendance`, `attendance_corrections`, `shifts`, `holidays`, `leave_types`, `leave_balances`, `leave_requests`, `employee_tasks` |
| payroll | `salary_components`, `salary_structures`, `salary_structure_components`, `payroll_runs`, `payslips`, `payslip_lines`, `salary_payments`, `payroll_adjustments` |
| commissions | `commission_rules`, `commission_records`, `commission_payouts`, `commission_payout_items` |
| finance | `transactions`, `expense_categories`, `expenses`, `invoices`, `invoice_lines`, `reimbursements` |
| CMS | `cms_pages`, `cms_sections`, `cms_banners`, `cms_media`, `faqs`, `seo_overrides` |
| notifications | `notifications`, `notification_templates`, `communication_logs` |
| system | `audit_logs`, `system_settings`, `feature_flags`, `reference_counters`, `stored_files` |
