import { randomUUID } from 'node:crypto';
import type { Repositories } from '@qwery/domain/repositories';
import type {
  Conversation,
  Datasource,
  Organization,
  Project,
  User,
} from '@qwery/domain/entities';
import {
  ConversationRepository,
  DatasourceRepository,
  MessageRepository,
  NotebookRepository,
  OrganizationRepository,
  ProjectRepository,
  TodoRepository,
  UsageRepository,
  UserRepository,
} from '@qwery/repository-in-memory';
import { Roles } from '@qwery/domain/common';
import type { EnvConfig } from './types';

export function createRepositories(): Repositories {
  return {
    user: new UserRepository(),
    organization: new OrganizationRepository(),
    project: new ProjectRepository(),
    datasource: new DatasourceRepository(),
    notebook: new NotebookRepository(),
    conversation: new ConversationRepository(),
    message: new MessageRepository(),
    usage: new UsageRepository(),
    todo: new TodoRepository(),
  };
}

export async function seedWorkspace(
  repositories: Repositories,
  config: EnvConfig,
): Promise<{
  conversationId: string;
  conversationSlug: string;
}> {
  const now = new Date();
  const userId = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const conversationId = randomUUID();
  const conversationSlug = `internal-single-turn-${Date.now()}`;

  const user: User = {
    id: userId,
    username: 'internal-eval-user',
    role: Roles.USER,
    createdAt: now,
    updatedAt: now,
  };

  const organization: Organization = {
    id: organizationId,
    name: 'Internal Eval Org',
    slug: `internal-org-${Date.now()}`,
    userId,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  const project: Project = {
    id: projectId,
    organizationId,
    name: 'Internal Eval Project',
    slug: `internal-project-${Date.now()}`,
    description: 'Ephemeral project for internal single-turn run',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };

  const datasource: Datasource = {
    id: config.datasourceId,
    projectId,
    name: config.datasourceName,
    description: 'Datasource attached by internal single-turn script',
    slug: `datasource-${config.datasourceId}`,
    datasource_provider: config.datasourceProvider,
    datasource_driver: config.datasourceDriver,
    datasource_kind: config.datasourceKind,
    config: config.datasourceConfig,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
    isPublic: false,
    remixedFrom: null,
  };

  const conversation: Conversation = {
    id: conversationId,
    title: 'Internal single-turn conversation',
    seedMessage: '',
    taskId: randomUUID(),
    projectId,
    slug: conversationSlug,
    datasources: [config.datasourceId],
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
    isPublic: false,
    remixedFrom: null,
  };

  await repositories.user.create(user);
  await repositories.organization.create(organization);
  await repositories.project.create(project);
  await repositories.datasource.create(datasource);
  await repositories.conversation.create(conversation);

  return { conversationId, conversationSlug };
}
