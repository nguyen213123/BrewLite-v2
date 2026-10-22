import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import type { User } from '../contracts/api.generated';
import { ApiError } from '../errors/api-error';

export type CurrentUserData = Pick<User, 'id' | 'email' | 'role'>;
export type AuthenticatedRequest = Request & { user?: CurrentUserData };

export abstract class IdentityPort {
  // TV4 must verify signature/issuer/audience/expiry and load current DB user/role.
  abstract verifyAccessToken(token: string): Promise<CurrentUserData>;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly identity: IdentityPort) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || !/^Bearer \S+$/i.test(header)) throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập');
    // Never decode-and-trust JWT, accept userId headers or enable a dev bypass.
    request.user = await this.identity.verifyAccessToken(header.slice(7));
    return true;
  }
}

@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập');
    if (user.role !== 'STAFF') throw new ApiError(403, 'FORBIDDEN', 'Chức năng yêu cầu STAFF');
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): CurrentUserData => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập');
  return user;
});

export const IdempotencyKey = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const key = context.switchToHttp().getRequest<Request>().headers['idempotency-key'];
  if (typeof key !== 'string' || !isUUID(key)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Idempotency-Key phải là UUID', [{ field: 'Idempotency-Key', message: 'Header bắt buộc có dạng UUID' }]);
  }
  return key.toLowerCase();
});
