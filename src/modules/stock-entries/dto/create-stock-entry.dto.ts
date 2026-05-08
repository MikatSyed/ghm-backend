import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateStockEntryDto {
  @ApiProperty({ example: '2026-04-18' })
  @IsDateString()
  date!: string;

  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  buyingRate!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  source!: string;

  @ApiPropertyOptional({ example: '2026-06-15', description: 'Optional expiry date (perishable)' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
