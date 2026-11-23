/** Business modules of the modular monolith (registered in AppModule). */
import { CatalogModule } from './catalog/catalog.module';
import { FilesModule } from './files/files.module';
import { PropertiesModule } from './properties/properties.module';
import { HomeModule } from './home/home.controller';
import { ProjectsModule } from './projects/projects.module';
import { HrModule } from './hr/hr.module';
import { PayrollModule } from './payroll/payroll.module';
import { CrmModule } from './crm/crm.module';
import { EnquiriesModule } from './enquiries/enquiries.controller';
import { LeadProvidersModule } from './lead-providers/lead-providers.controller';
import { PartnersModule } from './partners/partners.module';
import { AdminModule } from './admin/admin.controller';
import { CommissionsModule } from './commissions/commissions.controller';
import { FinanceModule } from './finance/finance.controller';
import { CmsModule } from './cms/cms.controller';
import { ReportsModule } from './reports/reports.controller';

export const DOMAIN_MODULES = [FilesModule, CatalogModule, PropertiesModule, HomeModule, ProjectsModule, HrModule, PayrollModule, CrmModule, EnquiriesModule, LeadProvidersModule, PartnersModule, AdminModule, CommissionsModule, FinanceModule, CmsModule, ReportsModule];
