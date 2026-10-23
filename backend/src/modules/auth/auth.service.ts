// Owner: TV4 — #6. Replace stubs here; keep public DTO/port contracts.
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthPort } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { IdentityPort } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';
import { ApiError } from '../../common/errors/api-error';
import { AUTH_POLICY } from './auth-policy';

@Injectable()
export class AuthService implements AuthPort, IdentityPort, OnModuleInit {
  private secret!: string;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const envSecret = process.env.JWT_SECRET;
    if (!envSecret || envSecret.length < AUTH_POLICY.minSecretLength) {
      throw new Error(
        `JWT_SECRET must be configured with at least ${AUTH_POLICY.minSecretLength} characters`,
      );
    }
    this.secret = envSecret;
  }

  async register(input: Api.AuthRequest): Promise<Api.AuthResponse> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Email đã được sử dụng');
    }

    const passwordHash = await bcrypt.hash(input.password, AUTH_POLICY.bcryptCost);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          role: 'CUSTOMER',
          loyaltyPoints: 0,
        },
      });

      return this.buildAuthResponse(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Email đã được sử dụng');
      }
      throw error;
    }
  }

  async login(input: Api.LoginRequest): Promise<Api.AuthResponse> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng');
    }

    return this.buildAuthResponse(user);
  }

  async me(user: CurrentUserData): Promise<Api.User> {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập');
    }

    return {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      loyaltyPoints: dbUser.loyaltyPoints,
    };
  }

  async verifyAccessToken(token: string): Promise<CurrentUserData> {
    try {
      const secret = this.secret ?? process.env.JWT_SECRET;
      if (!secret || secret.length < AUTH_POLICY.minSecretLength) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập');
      }

      const decoded = jwt.verify(token, secret, {
        algorithms: [AUTH_POLICY.algorithm as jwt.Algorithm],
        issuer: AUTH_POLICY.issuer,
        audience: AUTH_POLICY.audience,
      }) as jwt.JwtPayload;

      if (!decoded || typeof decoded.sub !== 'string') {
        throw new ApiError(401, 'UNAUTHORIZED', 'Token không hợp lệ');
      }

      const dbUser = await this.prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { id: true, email: true, role: true },
      });

      if (!dbUser) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Người dùng không tồn tại');
      }

      return {
        id: dbUser.id,
        email: dbUser.email,
        role: dbUser.role,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'UNAUTHORIZED', 'Token không hợp lệ hoặc đã hết hạn');
    }
  }

  private buildAuthResponse(user: { id: string; email: string; role: 'CUSTOMER' | 'STAFF'; loyaltyPoints: number }): Api.AuthResponse {
    const secret = this.secret ?? process.env.JWT_SECRET;
    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
      },
      secret,
      {
        algorithm: AUTH_POLICY.algorithm as jwt.Algorithm,
        issuer: AUTH_POLICY.issuer,
        audience: AUTH_POLICY.audience,
        expiresIn: AUTH_POLICY.expiresInSeconds,
      },
    );

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: AUTH_POLICY.expiresInSeconds,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        loyaltyPoints: user.loyaltyPoints,
      },
    };
  }
}
