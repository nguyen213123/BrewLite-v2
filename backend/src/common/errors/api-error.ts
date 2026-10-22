import { HttpException } from '@nestjs/common';
import type { Error as ErrorResponse } from '../contracts/api.generated';

export class ApiError extends HttpException {
  constructor(statusCode: number, code: string, message: string, details: ErrorResponse['details'] = []) {
    super({ statusCode, code, message, details } satisfies ErrorResponse, statusCode);
  }
}

export function notImplemented(feature: string): never {
  throw new ApiError(501, 'FEATURE_NOT_IMPLEMENTED', `Chưa triển khai: ${feature}`);
}
