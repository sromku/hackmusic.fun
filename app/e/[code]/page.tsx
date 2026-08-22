import type { Metadata } from "next";
import PartyRoom from "./party-room";

type RoomPageProps = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: RoomPageProps): Promise<Metadata> {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const title = `Join HackMusic room ${roomCode}`;
  const description = `Enter room ${roomCode}, submit a secret song, and vote on what the room hears next.`;
  return {
    title,
    description,
    openGraph: { title, description, images: [] },
    twitter: { title, description, images: [] },
  };
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { code } = await params;
  return <PartyRoom code={code.toUpperCase()} />;
}
