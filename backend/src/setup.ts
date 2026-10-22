import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ApiError } from './common/errors/api-error';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { validationDetails } from './common/dto/shared.dto';

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: false,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Idempotency-Replayed', 'Retry-After'],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // EmptyQueryDto intentionally has no fields; whitelist still rejects unknown query keys.
    forbidUnknownValues: false,
    validationError: { target: false, value: false },
    exceptionFactory: errors => new ApiError(400, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ', validationDetails(errors)),
  }));
}
