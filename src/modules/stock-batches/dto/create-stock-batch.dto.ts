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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class StockBatchLineDto {
  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ minimum: 0, description: 'Base Price — landed unit cost (BDT)' })
  @IsInt()
  @Min(0)
  basePrice!: number;

  // List Price = basePrice + tax% + profit% + others%
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  listTaxPercent?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  listProfitPercent?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  listOthersPercent?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Direct List Price — overrides the percentage inputs above',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  listPrice?: number;

  // Trade Price = listPrice + tax% + profit% + others% — the price actually charged to customers
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  tradeTaxPercent?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  tradeProfitPercent?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  tradeOthersPercent?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Direct Trade Price override (BDT). Falls back to Product.tradePrice when omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  tradePrice?: number;

  // MRP = tradePrice + tax% + profit% + others% — informational/compliance only
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  mrpTaxPercent?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  mrpProfitPercent?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  mrpOthersPercent?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Direct MRP override (BDT)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  mrp?: number;

  @ApiPropertyOptional({ enum: StockCondition, default: StockCondition.FRESH })
  @IsOptional()
  @IsEnum(StockCondition)
  condition?: StockCondition;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateStockBatchDto {
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

  @ApiProperty({ type: [StockBatchLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockBatchLineDto)
  lines!: StockBatchLineDto[];
}
