import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateVanDto {
  @ApiPropertyOptional({ example: 'Van 1 - North' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  vanName?: string;

  @ApiPropertyOptional({ example: 'Karim' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  driver?: string;
}
