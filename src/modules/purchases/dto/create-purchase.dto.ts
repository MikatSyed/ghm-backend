import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreatePurchaseDto {
  @ApiProperty({ example: '2026-05-03' })
  @IsDateString()
  date!: string;

  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 1, description: 'Total quantity purchased' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ minimum: 0, description: 'Base price per unit in BDT' })
  @IsInt()
  @Min(0)
  basePrice!: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Total transport cost' })
  @IsOptional()
  @IsInt()
  @Min(0)
  transportCost?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Total labour cost' })
  @IsOptional()
  @IsInt()
  @Min(0)
  labourCost?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Other miscellaneous costs' })
  @IsOptional()
  @IsInt()
  @Min(0)
  otherCost?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Manually set sell price (if not using profit %)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sellPrice?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Profit percentage to auto-calculate sell price' })
  @IsOptional()
  @IsInt()
  @Min(0)
  profitPercent?: number;

  @ApiProperty({ example: 'Karwan Bazar Market' })
  @IsString()
  @MaxLength(200)
  source!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Bank account UUID to deduct from' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}
