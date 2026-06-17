import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class UpdateApiKeyDto {
  @IsUUID()
  apiKeyId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class RevokeApiKeyDto {
  @IsUUID()
  apiKeyId: string;
}
