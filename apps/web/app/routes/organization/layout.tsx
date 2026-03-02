import { Outlet } from 'react-router';

import { Page, PageMobileNavigation } from '@qwery/ui/page';
import type { Route } from '~/types/app/routes/organization/+types/layout';

import { LayoutMobileNavigation } from '../layout/_components/layout-mobile-navigation';
import { OrgBreadcrumb } from './_components/org-breadcrumb';

export async function loader(_args: Route.LoaderArgs) {
  return {
    layoutState: {
      open: true,
    },
  };
}

function SidebarLayout(props: Route.ComponentProps & React.PropsWithChildren) {
  return (
    <Page>
      <PageMobileNavigation className={'flex items-center justify-between'}>
        <LayoutMobileNavigation />
      </PageMobileNavigation>
      <div className="flex h-full flex-col">
        <div className="bg-background px-4 pt-4 pb-3 lg:px-12 lg:pt-6">
          <OrgBreadcrumb />
        </div>
        <div className="flex-1 overflow-hidden">
          {props.children}
        </div>
      </div>
    </Page>
  );
}

export default function Layout(props: Route.ComponentProps) {
  return (
    <SidebarLayout {...props}>
      <Outlet />
    </SidebarLayout>
  );
}
