import type { Metadata } from "next";
import LabRoom from "./lab-room";

type LabPageProps = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: LabPageProps): Promise<Metadata> {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const title = `Test lab · HackMusic room ${roomCode}`;
  const description = `Host and several test guests for room ${roomCode} in one browser window.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [] },
    twitter: { title, description, images: [] },
  };
}

export default async function LabPage({ params }: LabPageProps) {
  const { code } = await params;
  return <LabRoom code={code.toUpperCase()} />;
}
