import type { Metadata } from "next";
import Link from "next/link";
import { adminAccessForEmail } from "../admin-auth";
import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import AdminDashboard from "./admin-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "HackMusic Admin",
  description: "Owner-only HackMusic event database dashboard.",
  robots: { index: false, follow: false, noarchive: true },
  openGraph: { title: "HackMusic Admin", description: "Owner-only HackMusic event database dashboard.", images: [] },
  twitter: { title: "HackMusic Admin", description: "Owner-only HackMusic event database dashboard.", images: [] },
};

export default async function AdminPage() {
  const user = await requireChatGPTUser("/backstage-retired-slug");
  const access = adminAccessForEmail(user.email);
  if (!access.configured || !access.allowed) {
    return <main className="admin-denied"><span className="brand-mark">HM</span><p className="eyebrow">🔒 OWNER ACCESS ONLY</p><h1>{access.configured ? "This account isn’t on the list." : "The owner allowlist isn’t configured yet."}</h1><p>Signed in as <strong>{user.email}</strong>. {access.configured ? "Use the ChatGPT account approved by the site owner." : "Configure ADMIN_ALLOWED_EMAILS before opening the dashboard."}</p><div><a href={chatGPTSignOutPath("/backstage-retired-slug")}>Switch ChatGPT account →</a><Link href="/">Back to HackMusic</Link></div></main>;
  }
  return <AdminDashboard ownerEmail={user.email} signOutPath={chatGPTSignOutPath("/")} />;
}
