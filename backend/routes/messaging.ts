import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "../middleware/supabaseAuth.js";
import { supabase } from "../lib/supabase.js";
import { uploadFile, generateSignedUrl } from "../services/gcs-storage.js";

const router = Router();

// Watchtower task 2f4f06ea: message attachments used to be
// URL.createObjectURL(file) blob URLs (src/utils/messaging.ts), which are
// per-tab and die on refresh. Real files now go through GCS here; only the
// gcsPath is persisted in messages.attachments (never a long-lived signed
// URL), and a fresh short-lived signed URL is minted per authorized request
// via GET /attachments/:attachmentId below. Matches the private-bucket +
// per-request-signed-URL requirement in the task (a public/long-lived URL is
// unacceptable for message attachments).

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
// Matches the file picker's `accept` attribute in CustomerMessages.tsx /
// VendorMessages.tsx (image/*,.pdf,.doc,.docx) -- server enforces what the
// UI already implies, so there's no type the UI offers that the server then
// rejects.
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// POST /api/messaging/attachments/upload
// Body: { conversationId: string, filename: string, file: "data:<mime>;base64,..." }
router.post("/attachments/upload", requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { conversationId, filename, file } = req.body;

    if (!conversationId || typeof conversationId !== "string") {
      return res.status(400).json({ error: "conversationId is required" });
    }
    if (!file || typeof file !== "string" || !file.startsWith("data:")) {
      return res.status(400).json({ error: "Invalid file data" });
    }

    // Only a participant of the conversation may attach a file to it --
    // mirrors the "Participants can send messages" RLS policy on `messages`
    // (see supabase/migrations/20260728_messaging_crm_tables.sql), enforced
    // here too since this route uses the service-role client and RLS never
    // runs for it.
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, participant_one, participant_two")
      .eq("id", conversationId)
      .maybeSingle();

    if (convError) throw convError;
    if (!conversation || (conversation.participant_one !== userId && conversation.participant_two !== userId)) {
      return res.status(403).json({ error: "Not a participant of this conversation" });
    }

    const matches = file.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "Invalid base64 data URL format" });
    }

    const contentType = matches[1];
    if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
      return res.status(400).json({ error: `File type "${contentType}" is not allowed` });
    }

    const buffer = Buffer.from(matches[2], "base64");
    if (buffer.length === 0) {
      return res.status(400).json({ error: "File is empty" });
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      return res.status(400).json({ error: `File exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB attachment limit` });
    }

    const safeName = typeof filename === "string" && filename.trim() ? filename.trim().slice(0, 200) : "attachment";

    // uploadFile() defaults to a hardcoded `.png` extension when no filename
    // is passed (backend/services/gcs-storage.ts) -- matches the extension to
    // the real content type instead, same as backend/routes/user.ts does for
    // avatar/cover uploads.
    const extMap: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    };
    const storedFilename = `${uuidv4()}.${extMap[contentType] || "bin"}`;

    const result = await uploadFile(buffer, {
      userId,
      folder: "message-attachments",
      filename: storedFilename,
      contentType,
    });

    return res.json({
      ok: true,
      id: uuidv4(),
      name: safeName,
      size: buffer.length,
      mimeType: contentType,
      type: contentType.startsWith("image/") ? "image" : "file",
      gcsPath: result.gcsPath,
    });
  } catch (error: any) {
    console.error("[messaging/attachments/upload] Error:", error);
    return res.status(500).json({ error: error.message || "Upload failed" });
  }
});

// GET /api/messaging/attachments/:attachmentId
// Mints a fresh, short-lived signed URL for one attachment -- only if the
// caller is the sender or recipient of the message it belongs to. Never
// returns/stores a durable public URL for message attachments.
router.get("/attachments/:attachmentId", requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { attachmentId } = req.params;

    const { data: rows, error } = await supabase
      .from("messages")
      .select("id, sender_id, recipient_id, attachments")
      .contains("attachments", [{ id: attachmentId }])
      .limit(1);

    if (error) throw error;

    const message = rows?.[0];
    // Same check whether the row is missing or the caller isn't a party to
    // it -- a 404 either way avoids confirming an attachment id exists to a
    // non-participant.
    if (!message || (message.sender_id !== userId && message.recipient_id !== userId)) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    const attachment = (message.attachments || []).find((a: any) => a.id === attachmentId);
    // No gcsPath means this is either a stale pre-fix row (old blob: URL
    // metadata with no real upload) or corrupt metadata -- report it as
    // unavailable rather than error.
    if (!attachment || !attachment.gcsPath) {
      return res.status(410).json({ error: "Attachment unavailable" });
    }

    const url = await generateSignedUrl(attachment.gcsPath, 0.25); // 15 minutes
    return res.json({ ok: true, url, name: attachment.name, mimeType: attachment.mimeType });
  } catch (error: any) {
    console.error("[messaging/attachments/:attachmentId] Error:", error);
    return res.status(500).json({ error: error.message || "Failed to resolve attachment" });
  }
});

export default router;
