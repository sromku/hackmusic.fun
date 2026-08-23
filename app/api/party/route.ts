import { createRoom, hostControl, joinParty, reactToCurrent, readParty, readRoomSummary, setQueueMode, submitTrack, type QueueMode } from "../../../db/party";
import { resolveSpotifyTrack, type ResolvedSpotifyTrack } from "../../../lib/spotify-track";
import { protectRoomCreation, RoomCreationGuardError } from "../../../lib/room-creation-guard";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected party error.";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const participantId = url.searchParams.get("participantId");
    const pin = url.searchParams.get("pin") ?? "";
    const activityAfter = url.searchParams.has("activityAfter") ? url.searchParams.get("activityAfter") ?? "" : undefined;
    if (!code) return Response.json({ error: "Room code is required." }, { status: 400 });
    if (!participantId) return Response.json({ room: await readRoomSummary(code) });
    return Response.json({ party: await readParty(code, participantId, pin, activityAfter) });
  } catch (error) {
    return Response.json({ error: messageFrom(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: "create" | "join" | "react" | "submit" | "start" | "skip" | "advance" | "end" | "queueMode";
      code?: string;
      participantId?: string;
      kind?: "up" | "down";
      pin?: string;
      queueMode?: QueueMode;
      name?: string;
      title?: string;
      website?: string;
      preParty?: boolean;
      scheduledFor?: string;
      trackUrl?: string;
      track?: { id: string; title: string; artist: string; duration: string; color: string };
    };
    const code = body.code ?? "";
    const participantId = body.participantId ?? "";
    let skipped = false;
    let submittedTrack: ResolvedSpotifyTrack | undefined;

    if (body.action === "create" && body.title && body.name) {
      await protectRoomCreation(request, body.website);
      return Response.json({ room: await createRoom(body.title, body.name, { preParty: body.preParty, scheduledFor: body.scheduledFor }) }, { status: 201 });
    } else if (body.action === "join" && body.name) {
      await joinParty(code, participantId, body.name);
    } else if (body.action === "react" && body.kind) {
      ({ skipped } = await reactToCurrent(code, participantId, body.kind));
    } else if (body.action === "submit" && (body.trackUrl || body.track?.id)) {
      submittedTrack = await resolveSpotifyTrack(body.trackUrl ?? body.track?.id ?? "");
      await submitTrack(code, participantId, submittedTrack);
    } else if ((body.action === "start" || body.action === "skip" || body.action === "advance" || body.action === "end") && body.pin) {
      await hostControl(code, body.pin, body.action);
    } else if (body.action === "queueMode" && body.queueMode && body.pin) {
      await setQueueMode(code, body.pin, body.queueMode);
    } else {
      return Response.json({ error: "Invalid party action." }, { status: 400 });
    }

    return Response.json({ party: await readParty(code, participantId, body.pin), skipped, submittedTrack });
  } catch (error) {
    if (error instanceof RoomCreationGuardError) {
      const headers = error.retryAfter ? { "retry-after": String(error.retryAfter) } : undefined;
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    const message = messageFrom(error);
    const status = message.includes("not the host") ? 403 : message.includes("Room not found") ? 404 : message.includes("cannot") || message.includes("already") || message.includes("valid") || message.includes("Choose") || message.includes("Nothing") || message.includes("unlock") || message.includes("Start the party") || message.includes("Use a") || message.includes("Spotify") || message.includes("track link") || message.includes("ended") ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
