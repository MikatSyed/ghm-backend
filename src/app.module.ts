import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { WinstonModule } from 'nest-winston';

import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';

import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

import { HealthModule } from './health/health.module';
import { buildWinstonConfig } from './logger/winston.config';
import { PrismaModule } from './prisma/prisma.module';

import { AccountingModule } from './modules/accounting/accounting.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { BankingModule } from './modules/banking/banking.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DistributionsModule } from './modules/distributions/distributions.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ProductsModule } from './modules/products/products.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SalesModule } from './modules/sales/sales.module';
import { SearchModule } from './modules/search/search.module';
import { StockAdjustmentsModule } from './modules/stock-adjustments/stock-adjustments.module';
import { StockEntriesModule } from './modules/stock-entries/stock-entries.module';
import { VansModule } from './modules/vans/vans.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: true, allowUnknown: true },
    }),
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildWinstonConfig(
          config.get<string>('env') ?? 'development',
          config.get<string>('logger.level') ?? 'info',
        ),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: (config.get<number>('throttle.ttl') ?? 60) * 1000,
          limit: config.get<number>('throttle.limit') ?? 100,
        },
      ],
    }),
    PrismaModule,
    CommonModule,
    HealthModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    PurchasesModule,
    ShipmentsModule,
    BankingModule,
    StockEntriesModule,
    StockAdjustmentsModule,
    VansModule,
    DistributionsModule,
    SalesModule,
    InvoicesModule,
    ExpensesModule,
    DashboardModule,
    AccountingModule,
    ReportsModule,
    SearchModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useFactory: () => new TimeoutInterceptor(20_000) },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, HttpLoggerMiddleware).forRoutes('*');
  }
}
