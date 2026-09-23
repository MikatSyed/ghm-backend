import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SalvageLineDto {
  @ApiProperty({ minimum: 1, description: 'Damaged units taken off the van' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ minimum: 0, description: 'Reduced per-unit sell price for the salvage lot' })
  @IsInt()
  @Min(0)
  salvagePrice!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
