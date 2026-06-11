import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { ApiKeyModule } from '../api-key/api-key.module';
import { PageModule } from '../page/page.module';
import { SpaceModule } from '../space/space.module';
import { CommentModule } from '../comment/comment.module';
import { SearchModule } from '../search/search.module';
import { EnvironmentService } from '../../integrations/environment/environment.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (environmentService: EnvironmentService) => ({
        secret: environmentService.getAppSecret(),
        signOptions: {
          expiresIn: environmentService.getJwtTokenExpiresIn() as StringValue,
          issuer: 'Docmost',
        },
      }),
      inject: [EnvironmentService],
    }),
    ApiKeyModule,
    PageModule,
    SpaceModule,
    CommentModule,
    SearchModule,
  ],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
