"use client";

import { CDropdown, CDropdownItem, CDropdownMenu, CDropdownToggle } from "@coreui/react";
import CIcon from "@coreui/icons-react";
import { cilContrast, cilMoon, cilSun } from "@coreui/icons";
import { useColorMode, type ColorMode } from "@/lib/hooks/use-color-mode";

const OPTIONS: { mode: ColorMode; label: string; icon: string[] }[] = [
  { mode: "light", label: "라이트", icon: cilSun },
  { mode: "dark", label: "다크", icon: cilMoon },
  { mode: "auto", label: "시스템 설정", icon: cilContrast },
];

export function ThemeToggle() {
  const { mode, choose } = useColorMode();
  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[2];

  return (
    <CDropdown variant="nav-item" placement="bottom-end">
      <CDropdownToggle caret={false} aria-label={`화면 테마: ${current.label}`}>
        <CIcon icon={current.icon} size="lg" />
      </CDropdownToggle>
      <CDropdownMenu>
        {OPTIONS.map((o) => (
          <CDropdownItem key={o.mode} as="button" type="button" active={o.mode === mode} className="d-flex align-items-center" onClick={() => choose(o.mode)}>
            <CIcon className="me-2" icon={o.icon} size="lg" /> {o.label}
          </CDropdownItem>
        ))}
      </CDropdownMenu>
    </CDropdown>
  );
}
