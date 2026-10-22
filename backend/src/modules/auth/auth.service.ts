// Owner: TV4 — #6. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { AuthPort } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { IdentityPort } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class AuthService implements AuthPort, IdentityPort {
  register(_input: Api.AuthRequest): Promise<Api.AuthResponse> {
    return notImplemented('auth.register');
  }
  login(_input: Api.LoginRequest): Promise<Api.AuthResponse> {
    return notImplemented('auth.login');
  }
  me(_user: CurrentUserData): Promise<Api.User> {
    return notImplemented('auth.me');
  }
  verifyAccessToken(_token: string): Promise<CurrentUserData> {
    return notImplemented('auth.verifyAccessToken');
  }
}
