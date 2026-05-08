import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class SearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'sales', 'stock', 'expenses', 'returns'] })
  @IsOptional()
  @IsIn(['all', 'sales', 'stock', 'expenses', 'returns'])
  kind?: 'all' | 'sales' | 'stock' | 'expenses' | 'returns' = 'all';

  @ApiPropertyOptional({ enum: ['7d', '30d', '90d', 'ytd'] })
  @IsOptional()
  @IsIn(['7d', '30d', '90d', 'ytd'])
  dateRange?: '7d' | '30d' | '90d' | 'ytd';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: ['completed', 'stored', 'processed', 'pending'] })
  @IsOptional()
  @IsIn(['completed', 'stored', 'processed', 'pending'])
  status?: 'completed' | 'stored' | 'processed' | 'pending';
}
