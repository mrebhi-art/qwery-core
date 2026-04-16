import type { MessageContentPart } from '@qwery/domain';

export type PersistedMessageLite = {
  role: string;
  content?: {
    parts?: MessageContentPart[];
  };
};
