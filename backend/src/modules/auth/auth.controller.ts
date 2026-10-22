import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AuthPort } from '../../common/contracts/ports';
import { CurrentUser, JwtAuthGuard } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';
import { EmptyQueryDto } from '../../common/dto/shared.dto';
import { RegisterDto, LoginDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthPort) {}
  @Post('register')
  register(@Body() input: RegisterDto, @Query() _query: EmptyQueryDto) { return this.auth.register(input); }
  @Post('login') @HttpCode(200)
  login(@Body() input: LoginDto, @Query() _query: EmptyQueryDto) { return this.auth.login(input); }
  @Get('me') @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: CurrentUserData, @Query() _query: EmptyQueryDto) { return this.auth.me(user); }
}
