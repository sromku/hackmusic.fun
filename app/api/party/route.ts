import { assertPartyParticipant, createRoom, hostControl, joinParty, reactToCurrent, readParty, readRoomSummary, recordBooSkipProgress, removePendingTrack, setParticipantAvatar, setQueueMode, setRoomPasscode, submitTrack, type QueueMode } from "../../../db/party";
import { resolveSpotifyTrack, type ResolvedSpotifyTrack } from "../../../lib/spotify-track";
import { protectPartyAction, protectRoomCreation, protectRoomLookup, RoomCreationGuardError } from "../../../lib/room-creation-guard";
import { readBoundedJson, RequestSecurityError } from "../../../lib/request-security";
import { PublicError, publicErrorDetails } from "../../../lib/public-error";

type PartyAction = "create" | "join" | "react" | "submit" | "remove" | "avatar" | "start" | "skip" | "advance" | "end" | "queueMode" | "passcode" | "skipProgress";

type PartyRequest = {
  action?: PartyAction;
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
  trackId?: string;
  submissionId?: string;
  avatarEmoji?: string;
  skipPercent?: number;
  track?: { id: string; title: string; artist: string; duration: string; color: string };
};

function actionFallback(action?: PartyAction) {
  if (action === "create") return "We could not create the room right now. Wait a moment and try again.";
  if (action === "join") return "We could not join the room. Check the room code and passcode, then try again.";
  if (action === "submit") return "We could not check that Spotify song right now. Check the link and try again in a moment.";
  if (action === "react") return "Your reaction did not go through. Check your connection and try again.";
  if (action === "remove") return "We could not remove that song. Refresh your list and try again.";
  if (action === "avatar") return "Your party face did not change. Try another emoji.";
  if (action === "passcode") return "We could not update the room passcode. Try again—the current passcode is still active.";
  if (action === "queueMode") return "We could not change the queue mode. Refresh the host page and try again.";
  return "That host action did not finish. Refresh the host page and try again.";
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
    const detail = publicErrorDetails(error, "We could not load this room right now. Refresh the page and try again.");
    return json({ error: detail.message }, detail.status);
  }
}

export async function POST(request: Request) {
  let attemptedAction: PartyAction | undefined;
  try {
    const body = await readBoundedJson<PartyRequest>(request);
    attemptedAction = body.action;
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
      if (trackReference.length > 512) throw new PublicError("That Spotify link is too long. Copy the track link directly from Spotify and try again.");
      submittedTrack = await resolveSpotifyTrack(trackReference);
      await submitTrack(code, participantId, submittedTrack);
    } else if (body.action === "remove" && body.submissionId) {
      await protectPartyAction(request, body.action, code, participantId);
      await removePendingTrack(code, participantId, body.submissionId);
    } else if (body.action === "avatar" && body.avatarEmoji) {
      await protectPartyAction(request, body.action, code, participantId);
      await setParticipantAvatar(code, participantId, body.avatarEmoji);
    } else if ((body.action === "start" || body.action === "skip" || body.action === "advance" || body.action === "end") && body.pin) {
      await protectPartyAction(request, body.action, code);
      await hostControl(code, body.pin, body.action);
    } else if (body.action === "queueMode" && body.queueMode && body.pin) {
      await protectPartyAction(request, body.action, code);
      await setQueueMode(code, body.pin, body.queueMode);
    } else if (body.action === "passcode" && body.passcode && body.pin) {
      await protectPartyAction(request, body.action, code);
      await setRoomPasscode(code, body.pin, body.passcode);
    } else if (body.action === "skipProgress" && body.trackId && typeof body.skipPercent === "number" && body.pin) {
      await protectPartyAction(request, body.action, code);
      await recordBooSkipProgress(code, body.pin, body.trackId, body.skipPercent);
    } else {
      return json({ error: "Invalid party action." }, 400);
    }

    return json({ party: await readParty(code, participantId, body.pin), skipped, submittedTrack });
  } catch (error) {
    if (error instanceof RoomCreationGuardError || error instanceof RequestSecurityError) {
      const headers = error.retryAfter ? { "retry-after": String(error.retryAfter) } : undefined;
      return json({ error: error.message }, error.status, headers);
    }
    const detail = publicErrorDetails(error, actionFallback(attemptedAction));
    return json({ error: detail.message }, detail.status);
  }
}
