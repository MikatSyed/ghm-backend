import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { StockCondition } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurchaseLineDto {
  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 1, description: 'Quantity bought for this product' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ minimum: 0, description: 'Base price per unit (BDT)' })
  @IsInt()
  @Min(0)
  basePrice!: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  transportCost?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  labourCost?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  otherCost?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Manual sell price (overrides profitPercent)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sellPrice?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Auto-calculate sell price from this %' })
  @IsOptional()
  @IsInt()
  @Min(0)
  profitPercent?: number;

  @ApiPropertyOptional({
    enum: StockCondition,
    default: StockCondition.FRESH,
    description:
      'Condition of this lot at receiving. Non-FRESH lots will not update Product.sellPrice.',
  })
  @IsOptional()
  @IsEnum(StockCondition)
  condition?: StockCondition;
}

export class CreatePurchaseDto {
  @ApiProperty({ example: '2026-06-25' })
  @IsDateString()
  date!: string;

  @ApiProperty({ example: 'Karwan Bazar Market' })
  @IsString()
  @MaxLength(200)
  source!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Bank account UUID to deduct total from' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiProperty({ type: [PurchaseLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];
}
