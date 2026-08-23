import type { Metadata } from "next";

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/admin-favicon.svg?v=2", type: "image/svg+xml", sizes: "any" }],
    shortcut: "/admin-favicon.svg?v=2",
  },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
