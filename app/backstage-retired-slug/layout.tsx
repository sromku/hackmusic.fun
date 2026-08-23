import type { Metadata } from "next";
import AdminFavicon from "./admin-favicon";

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/admin-favicon.svg?v=admin-red-3", type: "image/svg+xml", sizes: "any" }],
    shortcut: "/admin-favicon.svg?v=admin-red-3",
  },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><AdminFavicon />{children}</>;
}
