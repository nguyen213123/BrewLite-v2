import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthPort } from '../../common/contracts/ports';
import { IdentityPort } from '../../common/security/security';
import { JwtAuthGuard, StaffGuard } from '../../common/security/security';

@Global()
@Module({
  imports: [],
  controllers: [AuthController],
  providers: [AuthService, { provide: AuthPort, useExisting: AuthService }, { provide: IdentityPort, useExisting: AuthService }, JwtAuthGuard, StaffGuard],
  exports: [AuthPort, IdentityPort, JwtAuthGuard, StaffGuard]
})
export class AuthModule {}
