import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateDistributionLineDto {
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  allocated?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Normal return — goes back to warehouse stock' })
  @IsOptional()
  @IsInt()
  @Min(0)
  returned?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Damaged return — counted as loss/wastage, NOT returned to warehouse' })
  @IsOptional()
  @IsInt()
  @Min(0)
  damageReturned?: number;
}
