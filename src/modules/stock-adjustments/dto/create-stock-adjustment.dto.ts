import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockAdjustmentReason, StockLocation } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateStockAdjustmentDto {
  @ApiProperty({ example: '2026-04-21' })
  @IsDateString()
  date!: string;

  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiPropertyOptional({
    example: 'STK-004',
    description:
      'Optional. If given, deducts only from this specific warehouse lot (e.g. expired batch write-off). Must belong to productId and location must be WAREHOUSE. If omitted, FIFO across all lots.',
  })
  @IsOptional()
  @IsString()
  stockEntryId?: string;

  @ApiProperty({ minimum: 1, description: 'Units to deduct (positive integer)' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ enum: StockAdjustmentReason })
  @IsEnum(StockAdjustmentReason)
  reason!: StockAdjustmentReason;

  @ApiProperty({ enum: StockLocation })
  @IsEnum(StockLocation)
  location!: StockLocation;

  @ApiPropertyOptional({ example: 'V1', description: 'Required when location = VAN' })
  @ValidateIf((o: CreateStockAdjustmentDto) => o.location === StockLocation.VAN)
  @IsString()
  vanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
