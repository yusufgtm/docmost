import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { ApiKey, InsertableApiKey } from '@docmost/db/types/entity.types';
import { ApiKeys } from '@docmost/db/types/db';

@Injectable()
export class ApiKeyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private baseFields: Array<keyof ApiKeys> = [
    'id',
    'name',
    'creatorId',
    'workspaceId',
    'expiresAt',
    'lastUsedAt',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];

  async findById(id: string, workspaceId: string): Promise<ApiKey | null> {
    return (
      (await this.db
        .selectFrom('apiKeys')
        .select(this.baseFields)
        .where('id', '=', id)
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst()) ?? null
    );
  }

  async findByWorkspaceId(workspaceId: string): Promise<ApiKey[]> {
    return this.db
      .selectFrom('apiKeys')
      .select(this.baseFields)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  async insert(data: InsertableApiKey): Promise<ApiKey> {
    return this.db
      .insertInto('apiKeys')
      .values(data)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async update(
    id: string,
    workspaceId: string,
    data: { name?: string; lastUsedAt?: Date },
  ): Promise<ApiKey> {
    return this.db
      .updateTable('apiKeys')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async softDelete(id: string, workspaceId: string): Promise<void> {
    await this.db
      .updateTable('apiKeys')
      .set({ deletedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }
}
