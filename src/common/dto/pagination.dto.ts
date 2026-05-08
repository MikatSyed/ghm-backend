import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 20;

  @ApiPropertyOptional({ description: 'Sort field, prefix with - for DESC. e.g. -date,name' })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional()
  @IsString()
  q?: string;

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }

  get take(): number {
    return this.pageSize;
  }

  parseSort(allowed: readonly string[]): Record<string, 'asc' | 'desc'> | undefined {
    if (!this.sort) return undefined;
    const order: Record<string, 'asc' | 'desc'> = {};
    for (const raw of this.sort.split(',').map((s) => s.trim()).filter(Boolean)) {
      const desc = raw.startsWith('-');
      const field = desc ? raw.slice(1) : raw;
      if (allowed.includes(field)) {
        order[field] = desc ? 'desc' : 'asc';
      }
    }
    return Object.keys(order).length ? order : undefined;
  }
}

export interface ListResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function listResponse<T>(items: T[], total: number, q: PaginationQueryDto): ListResponse<T> {
  return { data: items, page: q.page, pageSize: q.pageSize, total };
}
