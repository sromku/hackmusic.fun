import { assertPartyParticipant, createRoom, hostControl, joinParty, reactToCurrent, readParty, readRoomSummary, setQueueMode, setRoomPasscode, submitTrack, type QueueMode } from "../../../db/party";
import { resolveSpotifyTrack, type ResolvedSpotifyTrack } from "../../../lib/spotify-track";
import { protectPartyAction, protectRoomCreation, protectRoomLookup, RoomCreationGuardError } from "../../../lib/room-creation-guard";
import { readBoundedJson, RequestSecurityError } from "../../../lib/request-security";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected party error.";
}

function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...extraHeaders } });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const participantId = request.headers.get("x-hackmusic-participant");
    const hostKey = request.headers.get("x-hackmusic-host-key") ?? "";
    const activityAfter = url.searchParams.has("activityAfter") ? url.searchParams.get("activityAfter") ?? "" : undefined;
    if (!code) return json({ error: "Room code is required." }, 400);
    if (!participantId) {
      await protectRoomLookup(request);
      return json({ room: await readRoomSummary(code) });
    }
    return json({ party: await readParty(code, participantId, hostKey, activityAfter) });
  } catch (error) {
    if (error instanceof RequestSecurityError) return json({ error: error.message }, error.status, error.retryAfter ? { "retry-after": String(error.retryAfter) } : undefined);
    const message = messageFrom(error);
    return json({ error: message }, message.includes("Room not found") ? 404 : message.includes("Join this room") ? 401 : 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readBoundedJson<{
      action?: "create" | "join" | "react" | "submit" | "start" | "skip" | "advance" | "end" | "queueMode" | "passcode";
      code?: string;
      participantId?: string;
      kind?: "up" | "down";
      pin?: string;
      queueMode?: QueueMode;
      name?: string;
      title?: string;
      passcode?: string;
      website?: string;
      preParty?: boolean;
      scheduledFor?: string;
      trackUrl?: string;
      track?: { id: string; title: string; artist: string; duration: string; color: string };
    }>(request);
    const code = body.code ?? "";
    const participantId = body.participantId ?? "";
    let skipped = false;
    let submittedTrack: ResolvedSpotifyTrack | undefined;

    if (body.action === "create" && body.title && body.name && body.passcode) {
      await protectRoomCreation(request, body.website);
      return json({ room: await createRoom(body.title, body.name, { passcode: body.passcode, preParty: body.preParty, scheduledFor: body.scheduledFor }) }, 201);
    } else if (body.action === "join" && body.name) {
      await protectPartyAction(request, body.action, code);
      await joinParty(code, participantId, body.name, body.passcode ?? "");
    } else if (body.action === "react" && body.kind) {
      await protectPartyAction(request, body.action, code, participantId);
      ({ skipped } = await reactToCurrent(code, participantId, body.kind));
    } else if (body.action === "submit" && (body.trackUrl || body.track?.id)) {
      await protectPartyAction(request, body.action, code, participantId);
      await assertPartyParticipant(code, participantId);
      const trackReference = body.trackUrl ?? body.track?.id ?? "";
      if (trackReference.length > 512) throw new Error("That Spotify link is too long.");
      submittedTrack = await resolveSpotifyTrack(trackReference);
      await submitTrack(code, participantId, submittedTrack);
    } else if ((body.action === "start" || body.action === "skip" || body.action === "advance" || body.action === "end") && body.pin) {
      await protectPartyAction(request, body.action, code);
      await hostControl(code, body.pin, body.action);
    } else if (body.action === "queueMode" && body.queueMode && body.pin) {
      await protectPartyAction(request, body.action, code);
      await setQueueMode(code, body.pin, body.queueMode);
    } else if (body.action === "passcode" && body.passcode && body.pin) {
      await protectPartyAction(request, body.action, code);
      await setRoomPasscode(code, body.pin, body.passcode);
    } else {
      return json({ error: "Invalid party action." }, 400);
    }

    return json({ party: await readParty(code, participantId, body.pin), skipped, submittedTrack });
  } catch (error) {
    if (error instanceof RoomCreationGuardError || error instanceof RequestSecurityError) {
      const headers = error.retryAfter ? { "retry-after": String(error.retryAfter) } : undefined;
      return json({ error: error.message }, error.status, headers);
    }
    const message = messageFrom(error);
    const status = message.includes("not the host") ? 403 : message.includes("passcode is incorrect") || message.includes("Join this room") ? 401 : message.includes("Room not found") ? 404 : message.includes("cannot") || message.includes("already") || message.includes("valid") || message.includes("Choose") || message.includes("Nothing") || message.includes("unlock") || message.includes("Start the party") || message.includes("Use a") || message.includes("Spotify") || message.includes("track link") || message.includes("too long") || message.includes("ended") || message.includes("people") ? 400 : 500;
    return json({ error: message }, status);
  }
}
