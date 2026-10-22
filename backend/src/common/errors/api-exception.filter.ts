import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from './api-error';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiError) {
      if (exception.getStatus() >= 500 && exception.getStatus() !== 501) {
        this.internalError(response);
        return;
      }
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      // Preserve the existing health/readiness NestJS response contract.
      const status = exception.getStatus();
      const error = exception.getResponse();
      const request = host.switchToHttp().getRequest<Request>();
      if (status === 503 && request.path === '/api/health/ready') {
        response.status(status).json(error);
        return;
      }
      if (status >= 500) {
        this.internalError(response);
        return;
      }
      const codes: Record<number, string> = { 400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND' };
      response.status(status).json({ statusCode: status, code: codes[status] ?? 'HTTP_ERROR', message: exception.message, details: [] });
      return;
    }
    this.internalError(response);
  }

  private internalError(response: Response) {
    // Do not log exception.message/stack: a driver error can contain secrets.
    this.logger.error('Unhandled request exception; investigate server-side with sanitized context.');
    response.status(500).json({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Lỗi nội bộ', details: [] });
  }
}
