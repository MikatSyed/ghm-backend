import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityStatus, ProductUnit } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ description: 'UUID of the category' })
  @IsString()
  categoryId!: string;

  @ApiProperty({ enum: ProductUnit })
  @IsEnum(ProductUnit)
  unit!: ProductUnit;

  @ApiPropertyOptional({ description: 'BDT integer — managed via Purchase module', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  buyPrice?: number;

  @ApiPropertyOptional({ description: 'BDT integer — managed via Purchase module', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sellPrice?: number;

  @ApiPropertyOptional({ enum: EntityStatus, default: EntityStatus.Active })
  @IsOptional()
  @IsEnum(EntityStatus)
  status?: EntityStatus;
}
