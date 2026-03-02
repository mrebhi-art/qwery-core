import { memo, useMemo } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@qwery/ui/shadcn-sidebar';
import { SidebarNavigation } from '@qwery/ui/sidebar-navigation';
import { PanelRightClose } from 'lucide-react';
import { Button } from '@qwery/ui/button';

import { AccountDropdownContainer } from '~/components/account-dropdown-container';
import { AppLogo } from '~/components/app-logo';
import { createNavigationConfig } from '~/config/project.navigation.config';
import { useProject } from '~/lib/context/project-context';
import { useWorkspace } from '~/lib/context/workspace-context';
import { WorkspaceModeEnum } from '@qwery/domain/enums';
import { ProjectChatNotebookSidebarContent } from './project-chat-notebook-sidebar-content';

function ProjectSidebarInner() {
  const { projectSlug } = useProject();
  const { workspace } = useWorkspace();
  const isSimpleMode = workspace.mode === WorkspaceModeEnum.SIMPLE;

  const navigationConfig = useMemo(() => {
    if (!projectSlug) return null;
    const config = createNavigationConfig(projectSlug);
    
    if (isSimpleMode && config.routes[0]?.children) {
      return {
        ...config,
        routes: [
          {
            ...config.routes[0],
            children: config.routes[0].children.filter(
              (child) =>
                child.path &&
                !child.path.includes('/datasources') &&
                !child.path.includes('/notebooks'),
            ),
          },
        ],
      };
    }
    
    return config;
  }, [projectSlug, isSimpleMode]);

  if (!projectSlug || !navigationConfig) {
    return null;
  }

  return (
    <Sidebar
      collapsible="none"
      className="w-[18rem] max-w-[18rem] min-w-[18rem] border-r"
    >
      <SidebarHeader className="flex flex-row items-center justify-between px-6 py-4">
        <AppLogo className="h-7 w-7" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Collapse sidebar"
          disabled
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </SidebarHeader>
      <SidebarContent className="overflow-hidden p-4">
        <SidebarNavigation config={navigationConfig} />
        <ProjectChatNotebookSidebarContent />
      </SidebarContent>

      <SidebarFooter>
        <AccountDropdownContainer />
      </SidebarFooter>
    </Sidebar>
  );
}

export const ProjectSidebar = memo(ProjectSidebarInner);
