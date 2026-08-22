import { createRoom, hostControl, joinParty, reactToCurrent, readParty, readRoomSummary, submitTrack } from "../../../db/party";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected party error.";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const participantId = url.searchParams.get("participantId");
    if (!code) return Response.json({ error: "Room code is required." }, { status: 400 });
    if (!participantId) return Response.json({ room: await readRoomSummary(code) });
    return Response.json({ party: await readParty(code, participantId) });
  } catch (error) {
    return Response.json({ error: messageFrom(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: "create" | "join" | "react" | "submit" | "skip" | "end";
      code?: string;
      participantId?: string;
      kind?: "up" | "down";
      pin?: string;
      name?: string;
      title?: string;
      track?: { id: string; title: string; artist: string; duration: string; color: string };
    };
    const code = body.code ?? "";
    const participantId = body.participantId ?? "";
    let skipped = false;

    if (body.action === "create" && body.title && body.name) {
      return Response.json({ room: await createRoom(body.title, body.name) }, { status: 201 });
    } else if (body.action === "join" && body.name) {
      await joinParty(code, participantId, body.name);
    } else if (body.action === "react" && body.kind) {
      ({ skipped } = await reactToCurrent(code, participantId, body.kind));
    } else if (body.action === "submit" && body.track) {
      await submitTrack(code, participantId, body.track);
    } else if ((body.action === "skip" || body.action === "end") && body.pin) {
      await hostControl(code, body.pin, body.action);
    } else {
      return Response.json({ error: "Invalid party action." }, { status: 400 });
    }

    return Response.json({ party: await readParty(code, participantId), skipped });
  } catch (error) {
    const message = messageFrom(error);
    const status = message.includes("not the host") ? 403 : message.includes("not found") ? 404 : message.includes("cannot") || message.includes("already") || message.includes("valid") || message.includes("Use a") || message.includes("ended") ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
