import type { Metadata } from "next";
import HostRoom from "./host-room";

type HostPageProps = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: HostPageProps): Promise<Metadata> {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const title = `Host HackMusic room ${roomCode}`;
  const description = `Private host controls for HackMusic room ${roomCode}.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [] },
    twitter: { title, description, images: [] },
  };
}

export default async function HostPage({ params }: HostPageProps) {
  const { code } = await params;
  return <HostRoom code={code.toUpperCase()} />;
}
