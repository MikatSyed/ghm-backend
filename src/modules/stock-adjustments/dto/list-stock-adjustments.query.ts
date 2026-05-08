import { ApiPropertyOptional } from '@nestjs/swagger';
import { StockAdjustmentReason, StockLocation } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListStockAdjustmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vanId?: string;

  @ApiPropertyOptional({ enum: StockAdjustmentReason })
  @IsOptional()
  @IsEnum(StockAdjustmentReason)
  reason?: StockAdjustmentReason;

  @ApiPropertyOptional({ enum: StockLocation })
  @IsOptional()
  @IsEnum(StockLocation)
  location?: StockLocation;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
