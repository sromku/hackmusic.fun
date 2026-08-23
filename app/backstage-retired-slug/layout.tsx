import type { Metadata } from "next";

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/admin-favicon.svg", type: "image/svg+xml" }],
    shortcut: "/admin-favicon.svg",
  },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
