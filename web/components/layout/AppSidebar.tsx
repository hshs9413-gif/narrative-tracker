"use client";

import { Fragment } from "react";
import { CCloseButton, CNavItem, CNavLink, CNavTitle, CSidebar, CSidebarBrand, CSidebarFooter, CSidebarHeader, CSidebarNav, CSidebarToggler } from "@coreui/react";
import CIcon from "@coreui/icons-react";
import { NAV_GROUPS, SECTION_IDS } from "@/lib/nav";
import { useScrollSpy } from "@/lib/hooks/use-scroll-spy";

interface Props {
  show: boolean;
  onShowChange: (show: boolean) => void;
  unfoldable: boolean;
  onUnfoldableChange: (unfoldable: boolean) => void;
}

export function AppSidebar({ show, onShowChange, unfoldable, onUnfoldableChange }: Props) {
  const active = useScrollSpy(SECTION_IDS);

  return (
    <CSidebar className="border-end" colorScheme="dark" position="fixed" unfoldable={unfoldable} visible={show} onVisibleChange={onShowChange}>
      <CSidebarHeader className="border-bottom">
        <CSidebarBrand href="#overview" className="text-decoration-none">
          <span className="sidebar-brand-full nt-brand">
            <span className="nt-brand-mark" aria-hidden>N</span>
            내러티브 트래커
          </span>
          <span className="sidebar-brand-narrow nt-brand">
            <span className="nt-brand-mark" aria-hidden>N</span>
          </span>
        </CSidebarBrand>
        <CCloseButton className="d-lg-none" dark onClick={() => onShowChange(false)} />
      </CSidebarHeader>

      <CSidebarNav>
        {NAV_GROUPS.map((group) => (
          <Fragment key={group.title}>
            <CNavTitle>{group.title}</CNavTitle>
            {group.items.map((item) => (
              <CNavItem key={item.id}>
                <CNavLink href={`#${item.id}`} active={active === item.id}>
                  <CIcon customClassName="nav-icon" icon={item.icon} />
                  {item.label}
                </CNavLink>
              </CNavItem>
            ))}
          </Fragment>
        ))}
      </CSidebarNav>

      <CSidebarFooter className="border-top d-none d-lg-flex">
        <CSidebarToggler onClick={() => onUnfoldableChange(!unfoldable)} />
      </CSidebarFooter>
    </CSidebar>
  );
}
