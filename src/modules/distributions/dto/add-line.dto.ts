import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AddDistributionLineDto {
  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  allocated!: number;

  @ApiPropertyOptional({
    example: 'BAT-007',
    description: 'Restrict FIFO allocation to this batch',
  })
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiPropertyOptional({
    example: 'STK-011',
    description: 'Restrict allocation to this exact stock lot',
  })
  @IsOptional()
  @IsString()
  stockEntryId?: string;
}
