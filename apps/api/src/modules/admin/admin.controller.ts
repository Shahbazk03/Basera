import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ACCOUNT_TYPES, adminSetPasswordSchema, adminUserUpdateSchema, roleSchema, roleUpdateSchema, USER_STATUSES, userRoleGrantSchema, userStatusChangeSchema } from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { AuthModule } from '../auth/auth.module';
import { AdminService } from './admin.service';

const usersQuery = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  accountType: z.enum(ACCOUNT_TYPES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  roleKey: z.string().trim().max(40).optional(),
  organizationId: z.uuid().optional(),
});

@ApiTags('Administration — users & roles')
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @RequirePermissions('user.manage')
  users(@Query(new ZodPipe(usersQuery)) q: z.output<typeof usersQuery>) {
    return this.admin.listUsers(q);
  }

  @Get('users/:id')
  @RequirePermissions('user.manage')
  user(@Param('id', UuidParam) id: string) {
    return this.admin.userDetail(id);
  }

  @Patch('users/:id')
  @RequirePermissions('user.manage')
  @ApiZodBody(adminUserUpdateSchema)
  updateUser(@CurrentUser() actor: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(adminUserUpdateSchema)) body: z.output<typeof adminUserUpdateSchema>) {
    return this.admin.updateUser(actor, id, body);
  }

  @Post('users/:id/password')
  @RequirePermissions('user.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiZodBody(adminSetPasswordSchema)
  setPassword(@CurrentUser() actor: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(adminSetPasswordSchema)) body: z.output<typeof adminSetPasswordSchema>, @ReqMeta() meta: RequestMeta) {
    return this.admin.setPassword(actor, id, body, meta);
  }

  @Post('users/:id/password-reset')
  @RequirePermissions('user.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  passwordReset(@CurrentUser() actor: AuthUser, @Param('id', UuidParam) id: string, @ReqMeta() meta: RequestMeta) {
    return this.admin.sendPasswordReset(actor, id, meta);
  }

  @Patch('users/:id/status')
  @RequirePermissions('user.manage')
  @ApiZodBody(userStatusChangeSchema)
  status(@CurrentUser() actor: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(userStatusChangeSchema)) body: z.output<typeof userStatusChangeSchema>) {
    return this.admin.setStatus(actor, id, body);
  }

  @Post('users/:id/roles')
  @RequirePermissions('user.manage')
  @ApiZodBody(userRoleGrantSchema)
  grant(@CurrentUser() actor: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(userRoleGrantSchema)) body: z.output<typeof userRoleGrantSchema>) {
    return this.admin.grantRole(actor, id, body);
  }

  @Delete('users/:id/roles/:grantId')
  @RequirePermissions('user.manage')
  revoke(@CurrentUser() actor: AuthUser, @Param('id', UuidParam) id: string, @Param('grantId', UuidParam) grantId: string) {
    return this.admin.revokeRole(actor, id, grantId);
  }

  @Get('permissions')
  @RequirePermissions('user.manage')
  permissions() {
    return this.admin.permissionCatalog();
  }

  @Get('roles')
  @RequirePermissions('user.manage')
  roles() {
    return this.admin.roles();
  }

  @Get('roles/:id')
  @RequirePermissions('user.manage')
  role(@Param('id', UuidParam) id: string) {
    return this.admin.role(id);
  }

  @Post('roles')
  @RequirePermissions('role.manage')
  @ApiZodBody(roleSchema)
  createRole(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(roleSchema)) body: z.output<typeof roleSchema>) {
    return this.admin.createRole(actor, body);
  }

  @Patch('roles/:id')
  @RequirePermissions('role.manage')
  @ApiZodBody(roleUpdateSchema)
  updateRole(@CurrentUser() actor: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(roleUpdateSchema)) body: z.output<typeof roleUpdateSchema>) {
    return this.admin.updateRole(actor, id, body);
  }

  @Delete('roles/:id')
  @RequirePermissions('role.manage')
  deleteRole(@CurrentUser() actor: AuthUser, @Param('id', UuidParam) id: string) {
    return this.admin.deleteRole(actor, id);
  }
}

@Module({ imports: [AuthModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
