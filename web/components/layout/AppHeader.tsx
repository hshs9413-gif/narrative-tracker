"use client";

import { CBreadcrumb, CBreadcrumbItem, CContainer, CHeader, CHeaderNav, CHeaderToggler, CNavItem, CNavLink } from "@coreui/react";
import CIcon from "@coreui/icons-react";
import { cibGithub, cilMenu } from "@coreui/icons";
import { ThemeToggle } from "./ThemeToggle";
import { DataStamp } from "./DataStamp";

const REPO_URL = "https://github.com/hshs9413-gif/narrative-tracker";

export function AppHeader({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  return (
    <CHeader position="sticky" className="mb-0 p-0">
      <CContainer className="border-bottom px-4" fluid>
        <CHeaderToggler onClick={onToggleSidebar} aria-label="메뉴 열기·닫기" style={{ marginInlineStart: "-14px" }}>
          <CIcon icon={cilMenu} size="lg" />
        </CHeaderToggler>

        <CHeaderNav className="ms-auto align-items-center gap-2">
          <DataStamp />
          <CNavItem>
            <CNavLink href={REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub 저장소">
              <CIcon icon={cibGithub} size="lg" />
            </CNavLink>
          </CNavItem>
        </CHeaderNav>
        <CHeaderNav>
          <li className="nav-item py-1">
            <div className="vr h-100 mx-2 text-body text-opacity-75" />
          </li>
          <ThemeToggle />
        </CHeaderNav>
      </CContainer>
      <CContainer className="px-4" fluid>
        <CBreadcrumb className="my-0">
          <CBreadcrumbItem href="#overview">홈</CBreadcrumbItem>
          <CBreadcrumbItem active>대시보드</CBreadcrumbItem>
        </CBreadcrumb>
      </CContainer>
    </CHeader>
  );
}
