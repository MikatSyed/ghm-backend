import { ConflictException } from '@nestjs/common';

export class InsufficientStockException extends ConflictException {
  constructor(productIds: string[], message = 'Insufficient stock for one or more products.') {
    super({
      code: 'INSUFFICIENT_STOCK',
      message,
      productIds,
    });
  }
}
