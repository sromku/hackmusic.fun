import { readParty, readRoomSummary } from "../../../db/party";
import { readPartyRecap } from "../../../db/party-recap";
import type { PartyAction, PartyRequest } from "../../../lib/party-contract";
import { protectRoomLookup, RoomCreationGuardError } from "../../../lib/room-creation-guard";
import { readBoundedJson, RequestSecurityError } from "../../../lib/request-security";
import { publicErrorDetails } from "../../../lib/public-error";
import { executePartyAction, partyActionFallback } from "./party-actions";

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
    if (url.searchParams.has("recap")) return json({ recap: await readPartyRecap(code, participantId, hostKey) });
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
    const result = await executePartyAction(request, body);
    return json(result.body, result.status);
  } catch (error) {
    if (error instanceof RoomCreationGuardError || error instanceof RequestSecurityError) {
      const headers = error.retryAfter ? { "retry-after": String(error.retryAfter) } : undefined;
      return json({ error: error.message }, error.status, headers);
    }
    const detail = publicErrorDetails(error, partyActionFallback(attemptedAction));
    return json({ error: detail.message }, detail.status);
  }
}
