import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: `https://s3.${process.env.S3_REGION}.scw.cloud`,
  credentials: {
    accessKeyId: process.env.SCW_ACCESS_KEY,
    secretAccessKey: process.env.SCW_SECRET_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET;
const PRESIGN_EXPIRY = 900; // 15 minutes

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function handle(event, context, cb) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  return handleRequest(event);
}

async function handleRequest(event) {
  try {
    const body = JSON.parse(event.body);
    const { action } = body;

    if (action === "get-presigned-urls") {
      return handlePresignedUrls(body);
    }

    // Legacy: direct upload via JSON body (questionnaire only now)
    return handleDirectUpload(body);
  } catch (err) {
    return respond(500, { error: "Request failed", details: err.message });
  }
}

/**
 * Generate presigned PUT URLs for the client to upload directly to S3.
 * Body: { action: "get-presigned-urls", sessionId, files: [{ filename, contentType }] }
 * Returns: { urls: [{ filename, uploadUrl }] }
 */
async function handlePresignedUrls(body) {
  const { sessionId, files } = body;

  if (!sessionId || !Array.isArray(files) || files.length === 0) {
    return respond(400, { error: "Missing sessionId or files array" });
  }

  const urls = await Promise.all(
    files.map(async ({ filename, contentType }) => {
      const key = `${sessionId}/${filename}`;
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType || "application/octet-stream",
      });
      const uploadUrl = await getSignedUrl(s3, command, {
        expiresIn: PRESIGN_EXPIRY,
      });
      return { filename, uploadUrl, key };
    })
  );

  return respond(200, { urls });
}

/**
 * Direct upload for small payloads (questionnaire JSON).
 * Body: { sessionId, type: "questionnaire", data: { ... } }
 */
async function handleDirectUpload(body) {
  const { sessionId, type, data } = body;

  if (!sessionId || !type || !data) {
    return respond(400, { error: "Missing sessionId, type, or data" });
  }

  if (type !== "questionnaire") {
    return respond(400, {
      error:
        "Direct upload only supports 'questionnaire'. Use 'get-presigned-urls' for PDFs.",
    });
  }

  const key = `${sessionId}/questionnaire.json`;
  const buffer = Buffer.from(JSON.stringify(data, null, 2));

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "application/json",
    })
  );

  return respond(200, { success: true, key });
}
