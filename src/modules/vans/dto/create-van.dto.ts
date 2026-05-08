import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, Matches } from 'class-validator';

export class CreateVanDto {
  @ApiProperty({ example: 'V1' })
  @IsString()
  @Matches(/^V\d+$/, { message: 'id must look like "V1", "V2", ...' })
  id!: string;

  @ApiProperty({ example: 'Van 1 - North' })
  @IsString()
  @MaxLength(80)
  vanName!: string;

  @ApiProperty({ example: 'Rahim' })
  @IsString()
  @MaxLength(80)
  driver!: string;
}
